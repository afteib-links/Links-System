const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePermission('payments'));

const OFFICE_FEE = 1100;
const SAFETY_FEE = 8800;

function effectivePayment(row) {
  if (row.override_payment_amount != null) return Number(row.override_payment_amount);
  return Number(row.calculated_payment_amount || 0);
}

router.get('/targets', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const closing = String(req.query.closing_date || '').trim();
    if (!ym) {
      return res.status(400).json({ ok: false, message: '対象年月は必須です' });
    }

    const where = [
      `d.is_deleted = 0`,
      `d.target_year_month = ?`,
      `d.status = 'approved'`,
      `d.payment_status = 'none'`,
      `d.partner_id IS NOT NULL`,
    ];
    const params = [ym];
    if (closing) {
      where.push(`(pr.closing_date = ? OR c.closing_date_code = ?)`);
      params.push(closing, closing);
    }

    const reports = await query(
      `SELECT d.*, p.partner_name, p.partner_category_code, p.payment_output_code,
              pr.closing_date AS project_closing_date, c.closing_date_code
       FROM daily_reports d
       JOIN partners p ON p.partner_id = d.partner_id
       LEFT JOIN projects pr ON pr.project_id = d.project_id
       LEFT JOIN companies c ON c.company_id = d.company_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.partner_id, d.work_date`,
      params
    );

    const advances = await query(
      `SELECT partner_id,
              SUM(CASE WHEN is_target = 1 THEN total_amount ELSE 0 END) AS advance_sum,
              SUM(CASE WHEN is_target = 1 THEN applied_transfer_fee ELSE 0 END) AS fee_sum
       FROM advance_payments
       WHERE target_year_month = ? AND is_deleted = 0
       GROUP BY partner_id`,
      [ym]
    );
    const advMap = new Map(advances.map((a) => [Number(a.partner_id), a]));

    const groups = new Map();
    for (const r of reports) {
      const pid = Number(r.partner_id);
      if (!groups.has(pid)) {
        groups.set(pid, {
          partner_id: pid,
          partner_name: r.partner_name,
          partner_category_code: r.partner_category_code,
          payment_output_code: r.payment_output_code,
          closing_date: closing || r.project_closing_date || r.closing_date_code || '',
          report_ids: [],
          gross_amount: 0,
        });
      }
      const g = groups.get(pid);
      if (!g.report_ids.includes(r.daily_report_id)) {
        g.report_ids.push(r.daily_report_id);
        g.gross_amount += effectivePayment(r);
      }
    }

    const targets = [...groups.values()].map((g) => {
      const adv = advMap.get(g.partner_id) || { advance_sum: 0, fee_sum: 0 };
      const advanceDeduction = Number(adv.advance_sum || 0);
      const transferFee = Number(adv.fee_sum || 0);
      const finalAmount =
        g.gross_amount - advanceDeduction - transferFee - OFFICE_FEE - SAFETY_FEE;
      return {
        ...g,
        advance_deduction_amount: advanceDeduction,
        transfer_fee_deduction_amount: transferFee,
        office_fee_amount: OFFICE_FEE,
        safety_fee_amount: SAFETY_FEE,
        other_adjustment_amount: 0,
        final_transfer_amount: finalAmount,
        report_count: g.report_ids.length,
      };
    });

    return res.json({ ok: true, target_year_month: ym, targets });
  } catch (err) {
    console.error('[payments/targets]', err);
    return res.status(500).json({ ok: false, message: '支払対象一覧の取得に失敗しました' });
  }
});

router.get('/', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const where = ['pay.is_deleted = 0'];
    const params = [];
    if (ym) {
      where.push('pay.target_year_month = ?');
      params.push(ym);
    }
    const rows = await query(
      `SELECT pay.*, p.partner_name
       FROM payments pay
       LEFT JOIN partners p ON p.partner_id = pay.partner_id
       WHERE ${where.join(' AND ')}
       ORDER BY pay.payment_id DESC`,
      params
    );
    return res.json({ ok: true, payments: rows });
  } catch (err) {
    console.error('[payments/list]', err);
    return res.status(500).json({ ok: false, message: '支払一覧の取得に失敗しました' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await query(
      `SELECT pay.*, p.partner_name
       FROM payments pay
       LEFT JOIN partners p ON p.partner_id = pay.partner_id
       WHERE pay.payment_id = ? AND pay.is_deleted = 0`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: '支払が見つかりません' });
    const details = await query(
      `SELECT * FROM payment_details WHERE payment_id = ? AND is_deleted = 0 ORDER BY payment_detail_id`,
      [id]
    );
    return res.json({ ok: true, payment: { ...rows[0], details } });
  } catch (err) {
    console.error('[payments/get]', err);
    return res.status(500).json({ ok: false, message: '支払詳細の取得に失敗しました' });
  }
});

router.post('/close', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const ym = String(req.body.target_year_month || '').trim();
    const partnerId = Number(req.body.partner_id);
    const reportIds = Array.isArray(req.body.report_ids)
      ? req.body.report_ids.map(Number).filter((n) => n > 0)
      : [];
    const closingDate = String(req.body.closing_date || '').trim() || 'end';
    const otherAdj = Number(req.body.other_adjustment_amount || 0);
    const paymentOutputCode = req.body.payment_output_code || null;

    if (!ym || !partnerId || !reportIds.length) {
      return res.status(400).json({ ok: false, message: '年月・パートナー・対象日報は必須です' });
    }

    await conn.beginTransaction();
    const [reports] = await conn.query(
      `SELECT * FROM daily_reports
       WHERE daily_report_id IN (${reportIds.map(() => '?').join(',')})
         AND partner_id = ? AND is_deleted = 0
         AND status = 'approved' AND payment_status = 'none'
       FOR UPDATE`,
      [...reportIds, partnerId]
    );
    if (!reports.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: '締め可能な日報がありません' });
    }

    let gross = 0;
    for (const r of reports) gross += effectivePayment(r);

    const [advRows] = await conn.query(
      `SELECT
         SUM(CASE WHEN is_target = 1 THEN total_amount ELSE 0 END) AS advance_sum,
         SUM(CASE WHEN is_target = 1 THEN applied_transfer_fee ELSE 0 END) AS fee_sum
       FROM advance_payments
       WHERE partner_id = ? AND target_year_month = ? AND is_deleted = 0`,
      [partnerId, ym]
    );
    const advanceDeduction = Number(advRows[0]?.advance_sum || 0);
    const transferFee = Number(advRows[0]?.fee_sum || 0);
    const finalAmount = gross - advanceDeduction - transferFee - OFFICE_FEE - SAFETY_FEE + otherAdj;

    const [payResult] = await conn.query(
      `INSERT INTO payments
        (partner_id, target_year_month, closing_date, gross_amount,
         advance_deduction_amount, transfer_fee_deduction_amount,
         office_fee_amount, safety_fee_amount, other_adjustment_amount,
         final_transfer_amount, payment_output_code, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
      [
        partnerId,
        ym,
        closingDate,
        gross,
        advanceDeduction,
        transferFee,
        OFFICE_FEE,
        SAFETY_FEE,
        otherAdj,
        finalAmount,
        paymentOutputCode,
      ]
    );
    const paymentId = payResult.insertId;

    await conn.query(
      `INSERT INTO payment_details
        (payment_id, detail_type, item_name, unit_price, quantity, amount)
       VALUES (?, 'work_item', '稼働分（仮組集計）', ?, 1, ?)`,
      [paymentId, gross, gross]
    );
    await conn.query(
      `INSERT INTO payment_details
        (payment_id, detail_type, item_name, unit_price, quantity, amount)
       VALUES
         (?, 'deduction_item', '先払い控除', ?, 1, ?),
         (?, 'deduction_item', '振込手数料控除', ?, 1, ?),
         (?, 'deduction_item', '事務手数料', ?, 1, ?),
         (?, 'deduction_item', '安全協力会費', ?, 1, ?)`,
      [
        paymentId, -advanceDeduction, -advanceDeduction,
        paymentId, -transferFee, -transferFee,
        paymentId, -OFFICE_FEE, -OFFICE_FEE,
        paymentId, -SAFETY_FEE, -SAFETY_FEE,
      ]
    );
    if (otherAdj !== 0) {
      await conn.query(
        `INSERT INTO payment_details
          (payment_id, detail_type, item_name, unit_price, quantity, amount)
         VALUES (?, 'adjustment_item', 'その他調整', ?, 1, ?)`,
        [paymentId, otherAdj, otherAdj]
      );
    }

    for (const r of reports) {
      await conn.query(
        `INSERT INTO payment_daily_reports (payment_id, daily_report_id) VALUES (?, ?)`,
        [paymentId, r.daily_report_id]
      );
      await conn.query(
        `UPDATE daily_reports
         SET payment_status = 'paid', version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE daily_report_id = ?`,
        [r.daily_report_id]
      );
    }

    await conn.commit();
    const detail = await query(
      `SELECT pay.*, p.partner_name FROM payments pay
       LEFT JOIN partners p ON p.partner_id = pay.partner_id
       WHERE pay.payment_id = ?`,
      [paymentId]
    );
    const details = await query(
      `SELECT * FROM payment_details WHERE payment_id = ? AND is_deleted = 0`,
      [paymentId]
    );
    return res.status(201).json({ ok: true, payment: { ...detail[0], details } });
  } catch (err) {
    await conn.rollback();
    console.error('[payments/close]', err);
    return res.status(500).json({ ok: false, message: '支払締めに失敗しました' });
  } finally {
    conn.release();
  }
});

router.post('/:id/unconfirm', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM payments WHERE payment_id = ? AND is_deleted = 0 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: '支払が見つかりません' });
    }
    const [links] = await conn.query(
      `SELECT daily_report_id FROM payment_daily_reports WHERE payment_id = ?`,
      [id]
    );
    for (const link of links) {
      await conn.query(
        `UPDATE daily_reports SET payment_status = 'none', version = version + 1 WHERE daily_report_id = ?`,
        [link.daily_report_id]
      );
    }
    await conn.query(
      `UPDATE payments
       SET is_confirmed = 0, approval_status = 'draft', payment_status = 'draft',
           version = version + 1 WHERE payment_id = ?`,
      [id]
    );
    await conn.commit();
    return res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('[payments/unconfirm]', err);
    return res.status(500).json({ ok: false, message: '確定解除に失敗しました' });
  } finally {
    conn.release();
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    await query(
      `UPDATE payments SET approval_status = 'approved', version = version + 1 WHERE payment_id = ?`,
      [Number(req.params.id)]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, message: '承認に失敗しました' });
  }
});

router.post('/:id/print', async (req, res) => {
  try {
    await query(
      `UPDATE payments SET is_printed = 1, version = version + 1 WHERE payment_id = ?`,
      [Number(req.params.id)]
    );
    return res.json({ ok: true, message: '印刷済みにしました（PDF本作成は後続）' });
  } catch (err) {
    return res.status(500).json({ ok: false, message: '印刷フラグ更新に失敗しました' });
  }
});

module.exports = router;
