const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePermission('advances'));

/** 仮組のサイクル境界（後で差し替え可） */
function cycleRange(ym, cycle) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (cycle === 1) return { start: `${ym}-01`, end: `${ym}-10` };
  if (cycle === 2) return { start: `${ym}-11`, end: `${ym}-20` };
  return { start: `${ym}-21`, end: `${ym}-${String(last).padStart(2, '0')}` };
}

async function countWorkDays(projectId, ym, cycle) {
  const { start, end } = cycleRange(ym, cycle);
  const rows = await query(
    `SELECT COUNT(DISTINCT work_date) AS cnt
     FROM daily_reports
     WHERE project_id = ? AND is_deleted = 0
       AND work_date BETWEEN ? AND ?
       AND status IN ('confirmed', 'approved', 'draft', 'rejected')`,
    [projectId, start, end]
  );
  return Number(rows[0]?.cnt || 0);
}

router.get('/', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    if (!ym) {
      return res.status(400).json({ ok: false, message: '対象年月は必須です' });
    }
    const q = String(req.query.q || '').trim();
    const where = [`p.is_deleted = 0`, `p.payment_type = 'installment'`];
    const params = [];
    if (q) {
      where.push('(c.company_name LIKE ? OR pt.partner_name LIKE ? OR CAST(p.project_id AS CHAR) LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const projects = await query(
      `SELECT p.project_id, p.company_id, p.partner_id, p.installment_amount, p.closing_date,
              c.company_name, pt.partner_name, b.template_name
       FROM projects p
       LEFT JOIN companies c ON c.company_id = p.company_id
       LEFT JOIN partners pt ON pt.partner_id = p.partner_id
       LEFT JOIN base_projects b ON b.base_project_id = p.base_project_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.project_id ASC`,
      params
    );

    const existing = await query(
      `SELECT * FROM advance_payments
       WHERE target_year_month = ? AND is_deleted = 0`,
      [ym]
    );
    const byKey = new Map(
      existing.map((r) => [`${r.project_id}:${r.cycle_number}`, r])
    );

    const rows = [];
    for (const p of projects) {
      const cycles = [];
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        const key = `${p.project_id}:${cycle}`;
        const saved = byKey.get(key);
        const workDays = await countWorkDays(p.project_id, ym, cycle);
        const unitPrice = saved
          ? Number(saved.unit_price)
          : Number(p.installment_amount || 0);
        const isTarget = saved ? !!saved.is_target : false;
        const total = isTarget ? unitPrice * workDays : 0;
        cycles.push({
          cycle_number: cycle,
          advance_payment_id: saved?.advance_payment_id || null,
          is_target: isTarget,
          unit_price: unitPrice,
          is_price_overridden: saved ? !!saved.is_price_overridden : false,
          work_days: workDays,
          total_amount: saved && saved.is_target ? Number(saved.total_amount) : total,
          applied_transfer_fee: saved ? Number(saved.applied_transfer_fee) : 0,
          version: saved?.version || null,
        });
      }
      rows.push({
        project_id: p.project_id,
        company_id: p.company_id,
        partner_id: p.partner_id,
        company_name: p.company_name,
        partner_name: p.partner_name,
        template_name: p.template_name,
        installment_amount: p.installment_amount,
        closing_date: p.closing_date,
        cycles,
      });
    }

    return res.json({ ok: true, target_year_month: ym, rows });
  } catch (err) {
    console.error('[advances/list]', err);
    return res.status(500).json({ ok: false, message: '先払い一覧の取得に失敗しました' });
  }
});

router.put('/upsert', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const ym = String(req.body.target_year_month || '').trim();
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!ym) {
      return res.status(400).json({ ok: false, message: '対象年月は必須です' });
    }

    await conn.beginTransaction();
    for (const item of items) {
      const projectId = Number(item.project_id);
      const cycle = Number(item.cycle_number);
      if (!projectId || ![1, 2, 3].includes(cycle)) continue;

      const [projects] = await conn.query(
        `SELECT project_id, company_id, partner_id, installment_amount
         FROM projects WHERE project_id = ? AND is_deleted = 0 LIMIT 1`,
        [projectId]
      );
      if (!projects.length) continue;
      const project = projects[0];

      const workDays = await countWorkDays(projectId, ym, cycle);
      const isTarget = item.is_target === true || item.is_target === 1 || item.is_target === '1';
      const defaultPrice = Number(project.installment_amount || 0);
      let unitPrice = item.unit_price != null && item.unit_price !== ''
        ? Number(item.unit_price)
        : defaultPrice;
      const overridden =
        item.is_price_overridden === true ||
        item.is_price_overridden === 1 ||
        Number(unitPrice) !== Number(defaultPrice);
      const fee = Number(item.applied_transfer_fee || 0);
      const total = isTarget ? unitPrice * workDays : 0;

      await conn.query(
        `INSERT INTO advance_payments
          (project_id, partner_id, company_id, target_year_month, cycle_number,
           is_target, unit_price, is_price_overridden, work_days, total_amount, applied_transfer_fee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           partner_id = VALUES(partner_id),
           company_id = VALUES(company_id),
           is_target = VALUES(is_target),
           unit_price = VALUES(unit_price),
           is_price_overridden = VALUES(is_price_overridden),
           work_days = VALUES(work_days),
           total_amount = VALUES(total_amount),
           applied_transfer_fee = VALUES(applied_transfer_fee),
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP,
           is_deleted = 0`,
        [
          projectId,
          project.partner_id,
          project.company_id,
          ym,
          cycle,
          isTarget ? 1 : 0,
          unitPrice,
          overridden ? 1 : 0,
          workDays,
          total,
          fee,
        ]
      );
    }
    await conn.commit();
    return res.json({ ok: true, message: '先払いを保存しました' });
  } catch (err) {
    await conn.rollback();
    console.error('[advances/upsert]', err);
    return res.status(500).json({ ok: false, message: '先払いの保存に失敗しました' });
  } finally {
    conn.release();
  }
});

module.exports = router;
