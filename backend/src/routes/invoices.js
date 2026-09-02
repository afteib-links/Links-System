const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePermission('invoices'));

function effectiveBilling(row) {
  if (row.override_billing_amount != null) return Number(row.override_billing_amount);
  return Number(row.calculated_billing_amount || 0);
}

/** 締め対象の仮集計一覧 */
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
      `d.billing_status = 'none'`,
    ];
    const params = [ym];
    if (closing) {
      where.push(`(pr.closing_date = ? OR c.closing_date_code = ?)`);
      params.push(closing, closing);
    }

    const reports = await query(
      `SELECT d.*, c.company_name, c.closing_date_code,
              pr.closing_date AS project_closing_date,
              cb.billing_id, cb.billing_summary_no, cb.billing_print_name
       FROM daily_reports d
       JOIN companies c ON c.company_id = d.company_id
       LEFT JOIN projects pr ON pr.project_id = d.project_id
       LEFT JOIN company_billings cb
         ON cb.company_id = d.company_id AND cb.is_deleted = 0
       WHERE ${where.join(' AND ')}
       ORDER BY d.company_id, cb.billing_summary_no, d.work_date`,
      params
    );

    // billing_summary_no 単位で集約（なければ company 単位）
    const groups = new Map();
    for (const r of reports) {
      const key = `${r.company_id}::${r.billing_summary_no || `company-${r.company_id}`}`;
      if (!groups.has(key)) {
        groups.set(key, {
          company_id: r.company_id,
          company_name: r.company_name,
          billing_id: r.billing_id || null,
          billing_summary_no: r.billing_summary_no || null,
          billing_print_name: r.billing_print_name || r.company_name,
          closing_date: closing || r.project_closing_date || r.closing_date_code || '',
          report_ids: [],
          project_ids: new Set(),
          subtotal_amount: 0,
        });
      }
      const g = groups.get(key);
      if (!g.report_ids.includes(r.daily_report_id)) {
        g.report_ids.push(r.daily_report_id);
        g.subtotal_amount += effectiveBilling(r);
      }
      g.project_ids.add(r.project_id);
    }

    const targets = [...groups.values()].map((g) => {
      const tax = Math.floor(g.subtotal_amount * 0.1);
      return {
        company_id: g.company_id,
        company_name: g.company_name,
        billing_id: g.billing_id,
        billing_summary_no: g.billing_summary_no,
        billing_print_name: g.billing_print_name,
        closing_date: g.closing_date,
        project_count: g.project_ids.size,
        report_count: g.report_ids.length,
        report_ids: g.report_ids,
        subtotal_amount: g.subtotal_amount,
        tax_amount: tax,
        total_amount: g.subtotal_amount + tax,
      };
    });

    return res.json({ ok: true, target_year_month: ym, targets });
  } catch (err) {
    console.error('[invoices/targets]', err);
    return res.status(500).json({ ok: false, message: '請求対象一覧の取得に失敗しました' });
  }
});

router.get('/', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const where = ['i.is_deleted = 0'];
    const params = [];
    if (ym) {
      where.push('i.target_year_month = ?');
      params.push(ym);
    }
    const rows = await query(
      `SELECT i.*, c.company_name
       FROM invoices i
       LEFT JOIN companies c ON c.company_id = i.company_id
       WHERE ${where.join(' AND ')}
       ORDER BY i.invoice_id DESC`,
      params
    );
    return res.json({ ok: true, invoices: rows });
  } catch (err) {
    console.error('[invoices/list]', err);
    return res.status(500).json({ ok: false, message: '請求一覧の取得に失敗しました' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rows = await query(
      `SELECT i.*, c.company_name
       FROM invoices i
       LEFT JOIN companies c ON c.company_id = i.company_id
       WHERE i.invoice_id = ? AND i.is_deleted = 0`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: '請求が見つかりません' });
    const details = await query(
      `SELECT * FROM invoice_details WHERE invoice_id = ? AND is_deleted = 0 ORDER BY invoice_detail_id`,
      [id]
    );
    return res.json({ ok: true, invoice: { ...rows[0], details } });
  } catch (err) {
    console.error('[invoices/get]', err);
    return res.status(500).json({ ok: false, message: '請求詳細の取得に失敗しました' });
  }
});

router.post('/close', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const ym = String(req.body.target_year_month || '').trim();
    const companyId = Number(req.body.company_id);
    const reportIds = Array.isArray(req.body.report_ids)
      ? req.body.report_ids.map(Number).filter((n) => n > 0)
      : [];
    const adjustmentAmount = Number(req.body.adjustment_amount || 0);
    const adjustmentName = String(req.body.adjustment_name || '調整').trim() || '調整';
    const closingDate = String(req.body.closing_date || '').trim() || 'end';
    const billingSummaryNo = req.body.billing_summary_no || null;
    const billingPrintName = req.body.billing_print_name || null;
    const billingId = req.body.billing_id ? Number(req.body.billing_id) : null;
    const cashCycleId = req.body.cash_cycle_id ? Number(req.body.cash_cycle_id) : null;

    if (!ym || !companyId || !reportIds.length) {
      return res.status(400).json({ ok: false, message: '年月・企業・対象日報は必須です' });
    }

    await conn.beginTransaction();
    const [reports] = await conn.query(
      `SELECT * FROM daily_reports
       WHERE daily_report_id IN (${reportIds.map(() => '?').join(',')})
         AND company_id = ? AND is_deleted = 0
         AND status = 'approved' AND billing_status = 'none'
       FOR UPDATE`,
      [...reportIds, companyId]
    );
    if (!reports.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: '締め可能な日報がありません' });
    }

    let subtotal = 0;
    for (const r of reports) {
      subtotal += effectiveBilling(r);
    }
    const taxable = subtotal + adjustmentAmount;
    const tax = Math.floor(taxable * 0.1);
    const total = taxable + tax;

    const [invResult] = await conn.query(
      `INSERT INTO invoices
        (company_id, billing_id, billing_summary_no, billing_print_name,
         target_year_month, closing_date, subtotal_amount, adjustment_amount,
         taxable_amount, tax_amount, total_amount, invoice_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
      [
        companyId,
        billingId,
        billingSummaryNo,
        billingPrintName,
        ym,
        closingDate,
        subtotal,
        adjustmentAmount,
        taxable,
        tax,
        total,
      ]
    );
    const invoiceId = invResult.insertId;

    if (cashCycleId) {
      const [cycles] = await conn.query('SELECT * FROM cash_cycles WHERE cash_cycle_id = ? FOR UPDATE', [cashCycleId]);
      if (!cycles.length) throw new Error('入金管理回が見つかりません');
      const [companies] = await conn.query('SELECT company_name FROM companies WHERE company_id = ?', [companyId]);
      await conn.query(
        `INSERT INTO cash_schedules (cash_cycle_id,direction,source_type,source_id,company_id,counterparty_name,title,amount,scheduled_date,snapshot_json,created_by)
         VALUES (?, 'incoming', 'invoice', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cashCycleId, invoiceId, companyId, companies[0]?.company_name || `企業 #${companyId}`, '請求入金', total, cycles[0].planned_incoming_date, JSON.stringify({ invoice_id: invoiceId, total_amount: total }), req.session.user?.user_id || null]
      );
    }

    await conn.query(
      `INSERT INTO invoice_details
        (invoice_id, price_name, unit_price, quantity, amount, is_adjustment_row)
       VALUES (?, '稼働分（仮組集計）', ?, 1, ?, 0)`,
      [invoiceId, subtotal, subtotal]
    );
    if (adjustmentAmount !== 0) {
      await conn.query(
        `INSERT INTO invoice_details
          (invoice_id, price_name, unit_price, quantity, amount, is_adjustment_row)
         VALUES (?, ?, ?, 1, ?, 1)`,
        [invoiceId, adjustmentName, adjustmentAmount, adjustmentAmount]
      );
    }

    for (const r of reports) {
      await conn.query(
        `INSERT INTO invoice_daily_reports (invoice_id, daily_report_id) VALUES (?, ?)`,
        [invoiceId, r.daily_report_id]
      );
      await conn.query(
        `UPDATE daily_reports
         SET billing_status = 'billed', version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE daily_report_id = ?`,
        [r.daily_report_id]
      );
    }

    await conn.commit();
    const detail = await query(
      `SELECT i.*, c.company_name FROM invoices i
       LEFT JOIN companies c ON c.company_id = i.company_id
       WHERE i.invoice_id = ?`,
      [invoiceId]
    );
    const details = await query(
      `SELECT * FROM invoice_details WHERE invoice_id = ? AND is_deleted = 0`,
      [invoiceId]
    );
    return res.status(201).json({ ok: true, invoice: { ...detail[0], details } });
  } catch (err) {
    await conn.rollback();
    console.error('[invoices/close]', err);
    return res.status(500).json({ ok: false, message: '請求締めに失敗しました' });
  } finally {
    conn.release();
  }
});

/** G-07: 請求確定解除 → 再編集可、日報の billed を戻す */
router.post('/:id/unconfirm', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM invoices WHERE invoice_id = ? AND is_deleted = 0 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: '請求が見つかりません' });
    }
    const [links] = await conn.query(
      `SELECT daily_report_id FROM invoice_daily_reports WHERE invoice_id = ?`,
      [id]
    );
    for (const link of links) {
      await conn.query(
        `UPDATE daily_reports
         SET billing_status = 'none', version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE daily_report_id = ?`,
        [link.daily_report_id]
      );
    }
    await conn.query(
      `UPDATE invoices
       SET is_confirmed = 0, approval_status = 'draft', invoice_status = 'draft',
           version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE invoice_id = ?`,
      [id]
    );
    await conn.query(
      `UPDATE cash_schedules SET status = 'cancelled', version = version + 1
       WHERE source_type = 'invoice' AND source_id = ? AND status IN ('planned', 'exported', 'held')`,
      [id]
    );
    await conn.commit();
    return res.json({ ok: true, message: '請求確定を解除しました' });
  } catch (err) {
    await conn.rollback();
    console.error('[invoices/unconfirm]', err);
    return res.status(500).json({ ok: false, message: '確定解除に失敗しました' });
  } finally {
    conn.release();
  }
});

router.post('/:id/confirm', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(
      `UPDATE invoices
       SET is_confirmed = 1, approval_status = 'confirmed', invoice_status = 'confirmed',
           version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE invoice_id = ? AND is_deleted = 0`,
      [id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[invoices/confirm]', err);
    return res.status(500).json({ ok: false, message: '確定に失敗しました' });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(
      `UPDATE invoices
       SET approval_status = 'approved', version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE invoice_id = ? AND is_deleted = 0`,
      [id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[invoices/approve]', err);
    return res.status(500).json({ ok: false, message: '承認に失敗しました' });
  }
});

router.post('/:id/print', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await query(
      `UPDATE invoices
       SET is_printed = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE invoice_id = ? AND is_deleted = 0`,
      [id]
    );
    return res.json({ ok: true, message: '印刷済みにしました（PDF本作成は後続）' });
  } catch (err) {
    console.error('[invoices/print]', err);
    return res.status(500).json({ ok: false, message: '印刷フラグ更新に失敗しました' });
  }
});

router.post('/exclude', async (req, res) => {
  try {
    const companyId = Number(req.body.company_id);
    const ym = String(req.body.target_year_month || '').trim();
    const reason = req.body.reason || null;
    if (!companyId || !ym) {
      return res.status(400).json({ ok: false, message: '企業と年月は必須です' });
    }
    await query(
      `INSERT INTO invoice_exclusions (company_id, target_year_month, reason)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), is_deleted = 0, version = version + 1`,
      [companyId, ym, reason]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[invoices/exclude]', err);
    return res.status(500).json({ ok: false, message: '除外登録に失敗しました' });
  }
});

router.put('/:id', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const [rows] = await conn.query(
      `SELECT * FROM invoices WHERE invoice_id = ? AND is_deleted = 0 FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, message: '請求が見つかりません' });
    }
    if (Number(rows[0].is_confirmed) === 1) {
      return res.status(400).json({ ok: false, message: '確定中です。先に確定解除してください' });
    }
    const adjustmentAmount = Number(req.body.adjustment_amount || rows[0].adjustment_amount || 0);
    const subtotal = Number(req.body.subtotal_amount != null ? req.body.subtotal_amount : rows[0].subtotal_amount);
    const taxable = subtotal + adjustmentAmount;
    const tax = Math.floor(taxable * 0.1);
    const total = taxable + tax;
    const issueType = req.body.issue_type || rows[0].issue_type || 'final';
    if (issueType === 'final' && rows[0].approval_status !== 'approved') {
      // 本請求は承認後のみ（仮は可）— 更新自体は下書きとして許可
    }
    await conn.query(
      `UPDATE invoices
       SET subtotal_amount = ?, adjustment_amount = ?, taxable_amount = ?,
           tax_amount = ?, total_amount = ?, issue_type = ?,
           version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE invoice_id = ?`,
      [subtotal, adjustmentAmount, taxable, tax, total, issueType, id]
    );

    const details = Array.isArray(req.body.details) ? req.body.details : null;
    if (details) {
      await conn.query(`UPDATE invoice_details SET is_deleted = 1 WHERE invoice_id = ?`, [id]);
      for (const d of details) {
        await conn.query(
          `INSERT INTO invoice_details
            (invoice_id, price_name, unit_price, quantity, amount, is_adjustment_row, source_type, daily_report_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            d.price_name || '明細',
            Number(d.unit_price || 0),
            Number(d.quantity || 1),
            Number(d.amount || 0),
            d.is_adjustment_row ? 1 : 0,
            d.source_type || 'manual',
            d.daily_report_id || null,
          ]
        );
      }
    }
    await conn.commit();
    const inv = await query(
      `SELECT i.*, c.company_name FROM invoices i
       LEFT JOIN companies c ON c.company_id = i.company_id WHERE i.invoice_id = ?`,
      [id]
    );
    const detailRows = await query(
      `SELECT * FROM invoice_details WHERE invoice_id = ? AND is_deleted = 0`,
      [id]
    );
    return res.json({ ok: true, invoice: { ...inv[0], details: detailRows } });
  } catch (err) {
    await conn.rollback();
    console.error('[invoices/update]', err);
    return res.status(500).json({ ok: false, message: '請求更新に失敗しました' });
  } finally {
    conn.release();
  }
});

module.exports = router;
