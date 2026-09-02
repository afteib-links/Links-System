const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ensureCycles } = require('./cash_management');

const router = express.Router();
router.use(requireAuth, requirePermission('advances'));

// 本実装: 案件別の有効期間付き前払条件。旧 advance_payments は参照しない。
router.get('/terms', async (_req, res) => {
  try {
    const terms = await query(`SELECT t.*, p.project_id, c.company_name, pt.partner_name
      FROM project_advance_terms t JOIN projects p ON p.project_id=t.project_id
      LEFT JOIN companies c ON c.company_id=p.company_id LEFT JOIN partners pt ON pt.partner_id=p.partner_id
      WHERE t.is_deleted=0 ORDER BY t.project_id, t.valid_from DESC`);
    return res.json({ ok: true, terms });
  } catch (err) { return res.status(500).json({ ok:false, message:'前払条件の取得に失敗しました' }); }
});
router.post('/terms', async (req, res) => {
  try {
    const b=req.body || {}; const projectId=Number(b.project_id); const unit=Number(b.unit_price);
    if (!projectId || !b.valid_from || unit < 0) throw new Error('案件、適用開始日、前払単価は必須です');
    const [result]=await getPool().query(`INSERT INTO project_advance_terms (project_id,valid_from,valid_to,is_enabled,unit_price) VALUES (?,?,?,?,?)`,[projectId,b.valid_from || null,b.valid_to || null,b.is_enabled ? 1 : 0,unit]);
    return res.status(201).json({ok:true,project_advance_term_id:result.insertId});
  } catch(err) { return res.status(400).json({ok:false,message:err.message}); }
});
router.post('/records', async (req, res) => {
  const pool=getPool(); const conn=await pool.getConnection();
  try {
    const b=req.body || {}; const projectId=Number(b.project_id); const cycleId=Number(b.cash_cycle_id);
    if(!projectId || !cycleId || !b.period_start || !b.period_end) throw new Error('案件、管理回、対象期間は必須です');
    const [projects]=await conn.query('SELECT project_id,company_id,partner_id FROM projects WHERE project_id=? AND is_deleted=0',[projectId]); if(!projects.length || !projects[0].partner_id) throw new Error('前払対象の案件またはパートナーが見つかりません');
    const [terms]=await conn.query(`SELECT * FROM project_advance_terms WHERE project_id=? AND is_enabled=1 AND is_deleted=0 AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?) ORDER BY valid_from DESC, project_advance_term_id DESC LIMIT 1`,[projectId,b.period_end,b.period_start]); if(!terms.length) throw new Error('対象期間に有効な前払条件がありません');
    const [daysRows]=await conn.query(`SELECT COUNT(DISTINCT work_date) cnt FROM daily_reports WHERE project_id=? AND work_date BETWEEN ? AND ? AND status='confirmed' AND is_deleted=0`,[projectId,b.period_start,b.period_end]);
    const workDays=Number(daysRows[0].cnt || 0); const calculated=workDays * Number(terms[0].unit_price); const requested=b.advance_amount == null || b.advance_amount === '' ? calculated : Number(b.advance_amount);
    if(requested < 0 || requested > calculated) throw new Error('前払額は算定額以下で指定してください');
    if(requested !== calculated && !String(b.adjustment_reason || '').trim()) throw new Error('減額する場合は理由を入力してください');
    const [cycles]=await conn.query('SELECT * FROM cash_cycles WHERE cash_cycle_id=?',[cycleId]); if(!cycles.length) throw new Error('管理回が見つかりません');
    await conn.beginTransaction();
    const [schedule]=await conn.query(`INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,company_id,partner_id,project_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[cycleId,'outgoing','advance',projects[0].company_id,projects[0].partner_id,projectId,`パートナー #${projects[0].partner_id}`,'前払',requested,cycles[0].planned_outgoing_date,JSON.stringify({period_start:b.period_start,period_end:b.period_end,work_days:workDays,unit_price:terms[0].unit_price}),req.session.user?.user_id || null]);
    const [record]=await conn.query(`INSERT INTO advance_records (project_id,partner_id,company_id,project_advance_term_id,period_start,period_end,work_days,calculated_amount,advance_amount,adjustment_reason,cash_schedule_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[projectId,projects[0].partner_id,projects[0].company_id,terms[0].project_advance_term_id,b.period_start,b.period_end,workDays,calculated,requested,b.adjustment_reason || null,schedule.insertId,req.session.user?.user_id || null]);
    await conn.commit(); return res.status(201).json({ok:true,advance_record_id:record.insertId,work_days:workDays,calculated_amount:calculated});
  } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally { conn.release(); }
});
router.post('/records/:id/cancel', async (req,res) => {
  const pool=getPool(); const conn=await pool.getConnection();
  try { const id=Number(req.params.id); await conn.beginTransaction(); const [rows]=await conn.query('SELECT * FROM advance_records WHERE advance_record_id=? FOR UPDATE',[id]); if(!rows.length || rows[0].status !== 'planned') throw new Error('実行済み前払は取消できません。調整予定を作成してください'); await conn.query("UPDATE advance_records SET status='cancelled' WHERE advance_record_id=?",[id]); await conn.query("UPDATE cash_schedules SET status='cancelled' WHERE cash_schedule_id=?",[rows[0].cash_schedule_id]); await conn.commit(); return res.json({ok:true}); } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally {conn.release();}
});
router.get('/records', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const where = ym ? 'AND c.target_year_month = ?' : '';
    const rows = await query(
      `SELECT ar.*, cs.status AS cash_status, c.target_year_month, c.cycle_code, p.partner_name
       FROM advance_records ar
       JOIN cash_schedules cs ON cs.cash_schedule_id = ar.cash_schedule_id
       JOIN cash_cycles c ON c.cash_cycle_id = cs.cash_cycle_id
       LEFT JOIN partners p ON p.partner_id = ar.partner_id
       WHERE 1=1 ${where} ORDER BY ar.advance_record_id DESC`, ym ? [ym] : []
    );
    return res.json({ ok: true, records: rows });
  } catch (err) { return res.status(500).json({ ok:false, message:'前払記録の取得に失敗しました' }); }
});
router.post('/records/:id/reversal', async (req, res) => {
  const pool = getPool(); const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id); const cycleId = Number(req.body.cash_cycle_id); const amount = Number(req.body.amount);
    if (!id || !cycleId || !(amount > 0)) throw new Error('管理回と正の調整額は必須です');
    await conn.beginTransaction();
    const [records] = await conn.query('SELECT ar.*, p.partner_name FROM advance_records ar LEFT JOIN partners p ON p.partner_id=ar.partner_id WHERE ar.advance_record_id=? FOR UPDATE', [id]);
    if (!records.length || records[0].status !== 'executed') throw new Error('実行済みの前払だけを調整できます');
    const [reversed] = await conn.query("SELECT COALESCE(SUM(amount),0) AS total FROM cash_schedules WHERE source_type='adjustment' AND source_id=? AND direction='incoming' AND status <> 'cancelled'", [id]);
    if (amount + Number(reversed[0].total || 0) > Number(records[0].advance_amount)) throw new Error('調整額の合計は前払実行額を超えられません');
    const [cycles] = await conn.query('SELECT * FROM cash_cycles WHERE cash_cycle_id=? FOR UPDATE', [cycleId]); if (!cycles.length) throw new Error('管理回が見つかりません');
    const [result] = await conn.query(
      `INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,source_id,partner_id,project_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by)
       VALUES (?, 'incoming', 'adjustment', ?, ?, ?, ?, '前払返金・訂正', ?, ?, ?, ?)`,
      [cycleId,id,records[0].partner_id,records[0].project_id,records[0].partner_name || `パートナー #${records[0].partner_id}`,amount,cycles[0].planned_incoming_date,JSON.stringify({advance_record_id:id,kind:'advance_reversal'}),req.session.user?.user_id || null]
    );
    await conn.commit(); return res.status(201).json({ok:true,cash_schedule_id:result.insertId});
  } catch(err) { await conn.rollback(); return res.status(400).json({ok:false,message:err.message}); } finally {conn.release();}
});

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
        const daysInput =
          saved && saved.work_days_input != null ? Number(saved.work_days_input) : null;
        const effectiveDays = daysInput != null ? daysInput : workDays;
        const cycleTotal = isTarget ? unitPrice * effectiveDays : 0;
        cycles.push({
          cycle_number: cycle,
          advance_payment_id: saved?.advance_payment_id || null,
          is_target: isTarget,
          unit_price: unitPrice,
          is_price_overridden: saved ? !!saved.is_price_overridden : false,
          work_days: workDays,
          work_days_input: daysInput,
          title: saved?.title || '',
          total_amount: saved && saved.is_target ? Number(saved.total_amount) : cycleTotal,
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

      const workDaysInput =
        item.work_days_input != null && item.work_days_input !== ''
          ? Number(item.work_days_input)
          : null;
      const workDays = workDaysInput != null ? workDaysInput : await countWorkDays(projectId, ym, cycle);
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
      const title = item.title || null;
      const recordType = item.record_type || 'cycle';

      await conn.query(
        `INSERT INTO advance_payments
          (project_id, partner_id, company_id, target_year_month, cycle_number, record_type, title,
           is_target, unit_price, is_price_overridden, work_days, work_days_input, total_amount, applied_transfer_fee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           partner_id = VALUES(partner_id),
           company_id = VALUES(company_id),
           record_type = VALUES(record_type),
           title = VALUES(title),
           is_target = VALUES(is_target),
           unit_price = VALUES(unit_price),
           is_price_overridden = VALUES(is_price_overridden),
           work_days = VALUES(work_days),
           work_days_input = VALUES(work_days_input),
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
          recordType,
          title,
          isTarget ? 1 : 0,
          unitPrice,
          overridden ? 1 : 0,
          Math.round(workDays),
          workDaysInput,
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
