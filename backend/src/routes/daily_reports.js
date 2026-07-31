const express = require('express');
const { query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePermission('daily_reports'));

const FIELDS = [
  'project_id',
  'company_id',
  'partner_id',
  'vehicle_id',
  'target_year_month',
  'work_date',
  'start_time',
  'end_time',
  'break_time',
  'expenses_json',
  'memo',
  'calculated_billing_amount',
  'calculated_payment_amount',
  'override_billing_amount',
  'override_payment_amount',
  'input_source_type',
  'scanned_image_url',
];

function pick(body) {
  const out = {};
  for (const key of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let val = body[key];
    if (key === 'expenses_json') {
      if (val == null || val === '') out[key] = null;
      else if (typeof val === 'string') {
        try {
          out[key] = JSON.stringify(JSON.parse(val));
        } catch (_e) {
          out[key] = JSON.stringify({ note: val });
        }
      } else out[key] = JSON.stringify(val);
      continue;
    }
    out[key] = val === '' || val === undefined ? null : val;
  }
  return out;
}

function effectiveAmount(row, kind) {
  const override = kind === 'billing' ? row.override_billing_amount : row.override_payment_amount;
  const calc = kind === 'billing' ? row.calculated_billing_amount : row.calculated_payment_amount;
  if (override != null && override !== '') return Number(override);
  return calc != null ? Number(calc) : 0;
}

async function fetchDetail(id) {
  const rows = await query(
    `SELECT d.*, c.company_name, p.partner_name, pr.manager_name, pr.business_type
     FROM daily_reports d
     LEFT JOIN companies c ON c.company_id = d.company_id
     LEFT JOIN partners p ON p.partner_id = d.partner_id
     LEFT JOIN projects pr ON pr.project_id = d.project_id
     WHERE d.daily_report_id = ? AND d.is_deleted = 0
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function applySimpleCalc(data) {
  // 仮組: 勤務日時点の改定から請求/支払基本単価を拾う（なければ0）
  if (!data.project_id || !data.work_date) return data;
  const revs = await query(
    `SELECT billing_base_price, payment_base_price
     FROM project_revisions
     WHERE project_id = ? AND is_deleted = 0
       AND revision_start_date <= ?
       AND (revision_end_date IS NULL OR revision_end_date >= ?)
     ORDER BY revision_start_date DESC, revision_id DESC
     LIMIT 1`,
    [data.project_id, data.work_date, data.work_date]
  );
  if (revs.length) {
    if (data.calculated_billing_amount == null) {
      data.calculated_billing_amount = revs[0].billing_base_price || 0;
    }
    if (data.calculated_payment_amount == null) {
      data.calculated_payment_amount = revs[0].payment_base_price || 0;
    }
  } else {
    if (data.calculated_billing_amount == null) data.calculated_billing_amount = 0;
    if (data.calculated_payment_amount == null) data.calculated_payment_amount = 0;
  }
  return data;
}

router.get('/', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const status = String(req.query.status || '').trim();
    const companyId = Number(req.query.company_id || 0);
    const partnerId = Number(req.query.partner_id || 0);
    const q = String(req.query.q || '').trim();

    const where = ['d.is_deleted = 0'];
    const params = [];
    if (ym) {
      where.push('d.target_year_month = ?');
      params.push(ym);
    }
    if (status) {
      where.push('d.status = ?');
      params.push(status);
    }
    if (companyId > 0) {
      where.push('d.company_id = ?');
      params.push(companyId);
    }
    if (partnerId > 0) {
      where.push('d.partner_id = ?');
      params.push(partnerId);
    }
    if (q) {
      where.push('(c.company_name LIKE ? OR p.partner_name LIKE ? OR CAST(d.project_id AS CHAR) LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const rows = await query(
      `SELECT d.daily_report_id, d.project_id, d.company_id, d.partner_id, d.vehicle_id,
              d.target_year_month, d.work_date, d.start_time, d.end_time, d.break_time,
              d.status, d.billing_status, d.payment_status,
              d.calculated_billing_amount, d.calculated_payment_amount,
              d.override_billing_amount, d.override_payment_amount, d.version,
              c.company_name, p.partner_name
       FROM daily_reports d
       LEFT JOIN companies c ON c.company_id = d.company_id
       LEFT JOIN partners p ON p.partner_id = d.partner_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.work_date DESC, d.daily_report_id DESC`,
      params
    );

    const reports = rows.map((r) => ({
      ...r,
      effective_billing_amount: effectiveAmount(r, 'billing'),
      effective_payment_amount: effectiveAmount(r, 'payment'),
    }));
    return res.json({ ok: true, reports });
  } catch (err) {
    console.error('[daily_reports/list]', err);
    return res.status(500).json({ ok: false, message: '日報一覧の取得に失敗しました' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const detail = await fetchDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ ok: false, message: '日報が見つかりません' });
    detail.effective_billing_amount = effectiveAmount(detail, 'billing');
    detail.effective_payment_amount = effectiveAmount(detail, 'payment');
    return res.json({ ok: true, report: detail });
  } catch (err) {
    console.error('[daily_reports/get]', err);
    return res.status(500).json({ ok: false, message: '日報詳細の取得に失敗しました' });
  }
});

router.post('/', async (req, res) => {
  try {
    let data = pick(req.body || {});
    if (!data.project_id || !data.company_id || !data.work_date || !data.target_year_month) {
      return res.status(400).json({
        ok: false,
        message: '案件・企業・勤務日・対象年月は必須です',
      });
    }
    if (!data.input_source_type) data.input_source_type = 'manual';
    data = await applySimpleCalc(data);
    const cols = Object.keys(data);
    const result = await query(
      `INSERT INTO daily_reports (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => data[c])
    );
    return res.status(201).json({ ok: true, report: await fetchDetail(result.insertId) });
  } catch (err) {
    console.error('[daily_reports/create]', err);
    return res.status(500).json({ ok: false, message: '日報の作成に失敗しました' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await fetchDetail(id);
    if (!current) return res.status(404).json({ ok: false, message: '日報が見つかりません' });

    if (current.status === 'approved') {
      return res.status(400).json({ ok: false, message: '承認済みの日報は編集できません' });
    }

    let data = pick(req.body || {});
    // confirmed: memo / override のみ許可（仮組は緩めに基本項目も許可しつつ警告はUI側）
    if (current.status === 'confirmed') {
      data = {
        memo: data.memo != null ? data.memo : current.memo,
        override_billing_amount:
          data.override_billing_amount !== undefined
            ? data.override_billing_amount
            : current.override_billing_amount,
        override_payment_amount:
          data.override_payment_amount !== undefined
            ? data.override_payment_amount
            : current.override_payment_amount,
      };
    } else {
      data = await applySimpleCalc({ ...current, ...data });
      // pick したフィールドのみ更新対象にする
      data = pick({ ...current, ...req.body });
      data = await applySimpleCalc(data);
    }

    const expectedVersion = req.body.version != null ? Number(req.body.version) : null;
    const keys = Object.keys(data);
    const sets = keys.map((k) => `${k} = ?`);
    const params = keys.map((k) => data[k]);
    let sql = `
      UPDATE daily_reports
      SET ${sets.join(', ')}, version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE daily_report_id = ? AND is_deleted = 0
    `;
    params.push(id);
    if (expectedVersion != null && Number.isInteger(expectedVersion)) {
      sql += ' AND version = ?';
      params.push(expectedVersion);
    }
    const result = await query(sql, params);
    if (!result || result.affectedRows === 0) {
      return res.status(409).json({ ok: false, message: '更新に失敗しました（競合）' });
    }
    return res.json({ ok: true, report: await fetchDetail(id) });
  } catch (err) {
    console.error('[daily_reports/update]', err);
    return res.status(500).json({ ok: false, message: '日報の更新に失敗しました' });
  }
});

router.post('/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await fetchDetail(id);
    if (!current) return res.status(404).json({ ok: false, message: '日報が見つかりません' });

    const next = String(req.body.status || '');
    const reason = req.body.rejection_reason || null;
    const allowed = {
      draft: ['confirmed'],
      rejected: ['draft', 'confirmed'],
      confirmed: ['approved', 'rejected', 'draft'],
      approved: [],
    };
    if (!(allowed[current.status] || []).includes(next)) {
      return res.status(400).json({
        ok: false,
        message: `ステータスを ${current.status} から ${next} へは変更できません`,
      });
    }
    if (next === 'rejected' && !reason) {
      return res.status(400).json({ ok: false, message: '却下理由を入力してください' });
    }

    await query(
      `UPDATE daily_reports
       SET status = ?, rejection_reason = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE daily_report_id = ? AND is_deleted = 0`,
      [next, next === 'rejected' ? reason : null, id]
    );
    return res.json({ ok: true, report: await fetchDetail(id) });
  } catch (err) {
    console.error('[daily_reports/status]', err);
    return res.status(500).json({ ok: false, message: 'ステータス更新に失敗しました' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = await fetchDetail(id);
    if (!current) return res.status(404).json({ ok: false, message: '日報が見つかりません' });
    if (current.status === 'approved' || current.billing_status === 'billed' || current.payment_status === 'paid') {
      return res.status(400).json({ ok: false, message: '承認済み／締め済みの日報は削除できません' });
    }
    await query(
      `UPDATE daily_reports
       SET is_deleted = 1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE daily_report_id = ?`,
      [id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[daily_reports/delete]', err);
    return res.status(500).json({ ok: false, message: '日報の削除に失敗しました' });
  }
});

module.exports = router;
