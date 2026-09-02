const express = require('express');
const { getPool, query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { applyDailyPriceCalc, buildDailyCalculationContext, parseJson } = require('../services/price_calc');
const { canChangeDailyStatus, uncheckedDatesForMonth } = require('../services/daily_report_workflow');

const { calculateMonthlyDistance } = require('../services/distance_calc');

const {
  SETTING_KEYS: DAILY_REPORT_UI_SETTING_KEYS,
  normalizeDailyReportUiSettings,
} = require('../services/daily_report_ui_settings');


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
  'break_minutes',
  'is_absent',
  'is_training',
  'binding_hours',
  'work_hours',
  'overtime_hours',
  'start_meter',
  'end_meter',
  'total_distance',
  'distance_amount_billing',
  'distance_amount_payment',
  'distance_calculation_mode',
  'toll_fee',
  'parking_fee',
  'transport_fee',
  'night_hours',
  'night_break_minutes_billing',
  'night_break_minutes_payment',
  'night_adjustment_minutes_billing',
  'night_adjustment_minutes_payment',
  'night_adjustment_reason_billing',
  'night_adjustment_reason_payment',
  'selected_fee_item_id',
  'selected_fee_item_name',
  'fee_item_selection_source',
  'rate_overrides',
  'rate_override_reason',
  'spot_amount',
  'row_comment',
  'expenses_json',
  'memo',
  'calculated_billing_amount',
  'calculated_payment_amount',
  'applied_price_set_id',
  'override_billing_amount',
  'override_payment_amount',
  'input_source_type',
  'scanned_image_url',
];

const SYSTEM_FIELDS = [
  'applied_price_set_id',
  'selected_fee_item_id',
  'selected_fee_item_name',
  'fee_item_selection_source',
  'break_time',
  'break_minutes',
  'binding_hours',
  'work_hours',
  'overtime_hours',
  'shortage_hours',
  'shortage_minutes_billing',
  'shortage_minutes_payment',
  'shortage_amount_billing',
  'shortage_amount_payment',
  'distance_amount_billing',
  'distance_amount_payment',
  'distance_calculation_mode',
  'night_hours',
  'night_minutes_billing',
  'night_minutes_payment',
  'night_overtime_minutes_billing',
  'night_overtime_minutes_payment',
  'regular_overtime_minutes_billing',
  'regular_overtime_minutes_payment',
  'calculated_billing_amount',
  'calculated_payment_amount',
  'calculation_detail',
];

const JSON_FIELDS = new Set(['expenses_json', 'rate_overrides', 'calculation_detail']);
const AUDIT_FIELDS = [
  'selected_fee_item_id',
  'fee_item_selection_source',
  'night_break_minutes_billing',
  'night_break_minutes_payment',
  'night_adjustment_minutes_billing',
  'night_adjustment_minutes_payment',
  'night_adjustment_reason_billing',
  'night_adjustment_reason_payment',
  'rate_overrides',
  'rate_override_reason',
];

function pick(body) {
  const out = {};
  for (const key of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    let val = body[key];
    if (JSON_FIELDS.has(key)) {
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
    if (['is_absent', 'is_training'].includes(key)) {
      out[key] = val === true || val === 1 || val === '1' ? 1 : 0;
      continue;
    }
    out[key] = val === '' || val === undefined ? null : val;
  }
  return out;
}

function pickSystem(data) {
  const out = {};
  for (const key of SYSTEM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
  }
  return out;
}

function jsonValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return parseJson(value, value);
  return value;
}

function auditSubset(row) {
  const out = {};
  for (const key of AUDIT_FIELDS) out[key] = JSON_FIELDS.has(key) ? jsonValue(row[key]) : row[key] ?? null;
  const calculation = jsonValue(row.calculation_detail) || {};
  out.night_input_mode = calculation.night_input_mode || null;
  return out;
}

function changedAuditFields(before, after) {
  const left = auditSubset(before);
  const right = auditSubset(after);
  return JSON.stringify(left) === JSON.stringify(right) ? null : { before: left, after: right };
}

async function insertAudit(conn, reportId, action, before, after, reason, actorUserId) {
  await conn.query(
    `INSERT INTO daily_report_audit_logs
      (daily_report_id, action_code, before_data, after_data, reason, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      reportId,
      action,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      reason || null,
      actorUserId || null,
    ]
  );
}

function routeError(res, err, fallback) {
  if (err?.status) {
    return res.status(err.status).json({ ok: false, code: err.code || 'validation_error', message: err.message });
  }
  console.error(fallback, err);
  return res.status(500).json({ ok: false, message: fallback });
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
  return applyDailyPriceCalc(data);
}

router.get('/', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    const status = String(req.query.status || '').trim();
    const companyId = Number(req.query.company_id || 0);
    const partnerId = Number(req.query.partner_id || 0);
    const projectId = Number(req.query.project_id || 0);
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
    if (projectId > 0) {
      where.push('d.project_id = ?');
      params.push(projectId);
    }
    if (q) {
      where.push('(c.company_name LIKE ? OR p.partner_name LIKE ? OR CAST(d.project_id AS CHAR) LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const rows = await query(
      `SELECT d.*, c.company_name, p.partner_name
       FROM daily_reports d
       LEFT JOIN companies c ON c.company_id = d.company_id
       LEFT JOIN partners p ON p.partner_id = d.partner_id
       WHERE ${where.join(' AND ')}
       ORDER BY d.work_date ASC, d.daily_report_id ASC`,
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

/** F-01: 対象月×案件の入力状況一覧 */
router.get('/month-projects', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    if (!ym) return res.status(400).json({ ok: false, message: '対象年月は必須です' });
    const [y, m] = ym.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const projects = await query(
      `SELECT p.project_id, p.company_id, p.partner_id, p.manager_name, p.business_type,
              c.company_name, pt.partner_name, b.template_name
       FROM projects p
       LEFT JOIN companies c ON c.company_id = p.company_id
       LEFT JOIN partners pt ON pt.partner_id = p.partner_id
       LEFT JOIN base_projects b ON b.base_project_id = p.base_project_id
       WHERE p.is_deleted = 0
       ORDER BY p.project_id ASC`
    );

    const reports = await query(
      `SELECT project_id, status, work_date, COUNT(*) AS cnt
       FROM daily_reports
       WHERE is_deleted = 0 AND target_year_month = ?
       GROUP BY project_id, status, work_date`,
      [ym]
    );

    const byProject = new Map();
    for (const r of reports) {
      if (!byProject.has(r.project_id)) {
        byProject.set(r.project_id, { dates: new Set(), byStatus: {} });
      }
      const bag = byProject.get(r.project_id);
      bag.dates.add(String(r.work_date).slice(0, 10));
      bag.byStatus[r.status] = (bag.byStatus[r.status] || 0) + Number(r.cnt || 0);
    }

    const rows = projects.map((p) => {
      const bag = byProject.get(p.project_id) || { dates: new Set(), byStatus: {} };
      const inputDays = bag.dates.size;
      const approved = bag.byStatus.approved || 0;
      const confirmed = bag.byStatus.confirmed || 0;
      const draft = bag.byStatus.draft || 0;
      const totalRows = Object.values(bag.byStatus).reduce((a, b) => a + b, 0);
      return {
        ...p,
        input_days: inputDays,
        days_in_month: daysInMonth,
        completion_rate: daysInMonth ? Math.round((inputDays / daysInMonth) * 1000) / 10 : 0,
        status_summary: { draft, confirmed, approved, total: totalRows },
        input_status: totalRows === 0 ? '未入力' : approved > 0 && draft === 0 ? '承認済あり' : '入力中',
      };
    });

    const active = rows.filter((r) => r.status_summary.total > 0 || true);
    const withInput = rows.filter((r) => r.input_days > 0);
    return res.json({
      ok: true,
      target_year_month: ym,
      summary: {
        project_count: active.length,
        input_project_count: withInput.length,
        avg_completion_rate:
          active.length
            ? Math.round((active.reduce((s, r) => s + r.completion_rate, 0) / active.length) * 10) / 10
            : 0,
      },
      rows,
    });
  } catch (err) {
    console.error('[daily_reports/month-projects]', err);
    return res.status(500).json({ ok: false, message: '月次案件一覧の取得に失敗しました' });
  }
});

router.get('/calculation-context', async (req, res) => {
  try {
    const projectId = Number(req.query.project_id || 0);
    const workDate = String(req.query.work_date || '').slice(0, 10);
    const selectedFeeItemId = String(req.query.selected_fee_item_id || '').trim() || null;
    const isTraining = ['1', 'true'].includes(String(req.query.is_training || '').toLowerCase());
    if (!projectId || !workDate) {
      return res.status(400).json({ ok: false, message: '案件と勤務日は必須です' });
    }
    const context = await buildDailyCalculationContext(projectId, workDate, selectedFeeItemId, isTraining);
    return res.json({ ok: true, context });
  } catch (err) {
    return routeError(res, err, '日報計算条件の取得に失敗しました');
  }
});

router.get('/distance-monthly', async (req, res) => {
  try {
    const projectId = Number(req.query.project_id || 0);
    const ym = String(req.query.target_year_month || '').trim();
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ ok: false, message: '案件と対象年月は必須です' });
    const rows = await query(
      `SELECT work_date, total_distance FROM daily_reports
       WHERE project_id = ? AND target_year_month = ? AND is_deleted = 0
       ORDER BY work_date, daily_report_id`, [projectId, ym]
    );
    const context = rows.length ? await buildDailyCalculationContext(projectId, rows[0].work_date, null, false) : null;
    const output = {};
    for (const side of ['billing', 'payment']) {
      const rule = context?.distance_rules?.[side];
      if (!rule?.mode) { output[side] = null; continue; }
      const result = calculateMonthlyDistance({ distances: rows.map((r) => r.total_distance || 0), rule });
      output[side] = result;
      await query(
        `INSERT INTO daily_report_distance_monthly_results
          (project_id, target_year_month, side_code, result_data)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE calculation_version = calculation_version + 1,
           result_data = VALUES(result_data), calculated_at = CURRENT_TIMESTAMP`,
        [projectId, ym, side, JSON.stringify(result)]
      );
    }
    return res.json({ ok: true, project_id: projectId, target_year_month: ym, results: output });
  } catch (err) { return routeError(res, err, '月間距離計算に失敗しました'); }

router.get('/input-defaults', async (req, res) => {
  try {
    const projectId = Number(req.query.project_id || 0);
    if (!projectId) return res.status(400).json({ ok: false, message: '案件は必須です' });
    const rows = await query(
      `SELECT execution_time_start, execution_time_end, break_time
       FROM projects
       WHERE project_id = ? AND is_deleted = 0
       LIMIT 1`,
      [projectId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: '案件が見つかりません' });
    const project = rows[0];
    const breakHours = Number(project.break_time || 0);
    return res.json({
      ok: true,
      defaults: {
        start_time: project.execution_time_start || null,
        end_time: project.execution_time_end || null,
        break_minutes: Number.isFinite(breakHours) ? Math.max(0, Math.round(breakHours * 60)) : 0,
      },
    });
  } catch (err) {
    return routeError(res, err, '日報入力初期値の取得に失敗しました');
  }
});

router.get('/ui-settings', async (req, res) => {
  try {
    const projectId = Number(req.query.project_id || 0);
    const ym = String(req.query.target_year_month || '').trim();
    if (!projectId || !/^\d{4}-\d{2}$/.test(ym)) {
      return res.status(400).json({ ok: false, message: '案件と対象年月は必須です' });
    }
    const keys = Object.values(DAILY_REPORT_UI_SETTING_KEYS);
    const [settingRows, holidayRows] = await Promise.all([
      query(
        `SELECT setting_key, setting_value
         FROM system_settings
         WHERE is_deleted = 0 AND setting_key IN (${keys.map(() => '?').join(', ')})`,
        keys
      ),
      query(
        `SELECT holiday_date
         FROM holidays
         WHERE is_active = 1 AND is_deleted = 0
           AND holiday_date >= ? AND holiday_date < DATE_ADD(?, INTERVAL 1 MONTH)
           AND (project_id IS NULL OR project_id = ?)
         ORDER BY holiday_date ASC`,
        [`${ym}-01`, `${ym}-01`, projectId]
      ),
    ]);
    return res.json({
      ok: true,
      settings: normalizeDailyReportUiSettings(settingRows),
      holiday_dates: [...new Set(holidayRows.map((row) => String(row.holiday_date).slice(0, 10)))],
    });
  } catch (err) {
    return routeError(res, err, '日報画面設定の取得に失敗しました');
  }
});

router.post('/preview', async (req, res) => {
  try {
    const input = pick(req.body || {});
    if (!input.project_id || !input.work_date) {
      return res.status(400).json({ ok: false, message: '案件と勤務日は必須です' });
    }
    const calculated = await applySimpleCalc({ ...input });
    const preview = { ...input, ...pickSystem(calculated) };
    preview.effective_billing_amount = effectiveAmount(preview, 'billing');
    preview.effective_payment_amount = effectiveAmount(preview, 'payment');
    return res.json({ ok: true, preview });
  } catch (err) {
    return routeError(res, err, '日報金額の再計算に失敗しました');
  }

});

router.get('/monthly-approval', async (req, res) => {
  try {
    const projectId = Number(req.query.project_id || 0);
    const ym = String(req.query.target_year_month || '').trim();
    if (!projectId || !ym) return res.status(400).json({ ok: false, message: '案件と対象年月は必須です' });
    const rows = await query(
      `SELECT * FROM daily_report_monthly_approvals
       WHERE project_id = ? AND target_year_month = ?
       ORDER BY approval_version DESC LIMIT 1`,
      [projectId, ym]
    );
    return res.json({ ok: true, approval: rows[0] || null });
  } catch (err) {
    return routeError(res, err, '月次承認状態の取得に失敗しました');
  }
});

router.post('/monthly-approval', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const projectId = Number(req.body.project_id || 0);
    const ym = String(req.body.target_year_month || '').trim();
    const action = String(req.body.action || 'submit');
    const actorUserId = req.session.user.user_id || null;
    if (!projectId || !ym) return res.status(400).json({ ok: false, message: '案件と対象年月は必須です' });

    await conn.beginTransaction();
    const [reports] = await conn.query(
      `SELECT * FROM daily_reports
       WHERE project_id = ? AND target_year_month = ? AND is_deleted = 0
       ORDER BY work_date ASC, daily_report_id ASC`,
      [projectId, ym]
    );
    const [monthlyDistanceRows] = await conn.query(
      `SELECT side_code, calculation_version, result_data, calculated_at
       FROM daily_report_distance_monthly_results
       WHERE project_id = ? AND target_year_month = ?`, [projectId, ym]
    );
    const monthlyDistanceResults = Object.fromEntries(
      monthlyDistanceRows.map((row) => [row.side_code, {
        calculation_version: row.calculation_version,
        calculated_at: row.calculated_at,
        result: parseJson(row.result_data, row.result_data),
      }])
    );
    if (!reports.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: '承認対象の日報がありません' });
    }

    const [latestRows] = await conn.query(
      `SELECT * FROM daily_report_monthly_approvals
       WHERE project_id = ? AND target_year_month = ?
       ORDER BY approval_version DESC LIMIT 1 FOR UPDATE`,
      [projectId, ym]
    );
    const latest = latestRows[0] || null;
    if (action === 'submit') {
      const unchecked = uncheckedDatesForMonth(reports, ym);
      if (unchecked.length && !req.body.acknowledge_warnings) {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          code: 'unchecked_days_warning',
          message: '日次確認が未完了の日があります',
          unchecked_dates: unchecked,
        });
      }
      if (latest && latest.status === 'submitted') {
        await conn.rollback();
        return res.status(409).json({ ok: false, message: 'すでに承認依頼中です' });
      }
      const nextVersion = Number(latest?.approval_version || 0) + 1;
      const snapshot = {
        project_id: projectId,
        target_year_month: ym,
        submitted_at: new Date().toISOString(),
        unchecked_dates: unchecked,
        monthly_distance_results: monthlyDistanceResults,
        reports,
      };
      await conn.query(
        `INSERT INTO daily_report_monthly_approvals
          (project_id, target_year_month, approval_version, status, snapshot_data,
           note, submitted_by_user_id)
         VALUES (?, ?, ?, 'submitted', ?, ?, ?)`,
        [projectId, ym, nextVersion, JSON.stringify(snapshot), req.body.note || null, actorUserId]
      );
    } else {
      if (!latest || latest.status !== 'submitted') {
        await conn.rollback();
        return res.status(409).json({ ok: false, message: '承認依頼中の月次日報がありません' });
      }
      if (action === 'approve') {
        const approvalSnapshot = {
          project_id: projectId,
          target_year_month: ym,
          approved_at: new Date().toISOString(),
          monthly_distance_results: monthlyDistanceResults,
          reports,
        };
        await conn.query(
          `UPDATE daily_report_monthly_approvals
           SET status = 'approved', decided_by_user_id = ?, decided_at = CURRENT_TIMESTAMP,
               note = COALESCE(?, note), snapshot_data = ?
           WHERE monthly_approval_id = ?`,
          [actorUserId, req.body.note || null, JSON.stringify(approvalSnapshot), latest.monthly_approval_id]
        );
        await conn.query(
          `UPDATE daily_reports SET status = 'approved', version = version + 1, updated_at = CURRENT_TIMESTAMP
           WHERE project_id = ? AND target_year_month = ? AND is_deleted = 0 AND status = 'confirmed'`,
          [projectId, ym]
        );
      } else if (action === 'reject') {
        if (!String(req.body.note || '').trim()) {
          await conn.rollback();
          return res.status(400).json({ ok: false, message: '差戻し理由は必須です' });
        }
        await conn.query(
          `UPDATE daily_report_monthly_approvals
           SET status = 'rejected', decided_by_user_id = ?, decided_at = CURRENT_TIMESTAMP, note = ?
           WHERE monthly_approval_id = ?`,
          [actorUserId, req.body.note, latest.monthly_approval_id]
        );
      } else if (action === 'cancel') {
        await conn.query(
          `UPDATE daily_report_monthly_approvals
           SET status = 'cancelled', decided_by_user_id = ?, decided_at = CURRENT_TIMESTAMP,
               note = COALESCE(?, note)
           WHERE monthly_approval_id = ?`,
          [actorUserId, req.body.note || null, latest.monthly_approval_id]
        );
      } else {
        await conn.rollback();
        return res.status(400).json({ ok: false, message: '月次承認操作が不正です' });
      }
    }
    await conn.commit();
    const rows = await query(
      `SELECT * FROM daily_report_monthly_approvals
       WHERE project_id = ? AND target_year_month = ?
       ORDER BY approval_version DESC LIMIT 1`,
      [projectId, ym]
    );
    return res.json({ ok: true, approval: rows[0] || null });
  } catch (err) {
    await conn.rollback();
    return routeError(res, err, '月次承認処理に失敗しました');
  } finally {
    conn.release();
  }
});

router.post('/day-status', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const projectId = Number(req.body.project_id || 0);
    const workDate = String(req.body.work_date || '').slice(0, 10);
    const next = String(req.body.status || '');
    const actorUserId = req.session.user.user_id || null;
    if (!projectId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return res.status(400).json({ ok: false, message: '案件と勤務日は必須です' });
    }
    if (!['confirmed', 'draft'].includes(next)) {
      return res.status(400).json({ ok: false, message: '日次確認操作が不正です' });
    }

    await conn.beginTransaction();
    const [reports] = await conn.query(
      `SELECT * FROM daily_reports
       WHERE project_id = ? AND work_date = ? AND is_deleted = 0
       ORDER BY daily_report_id ASC FOR UPDATE`,
      [projectId, workDate]
    );
    if (!reports.length) {
      await conn.rollback();
      return res.status(400).json({ ok: false, message: '日次確認対象の作業明細がありません' });
    }
    if (reports.some((row) => row.status === 'approved')) {
      await conn.rollback();
      return res.status(409).json({ ok: false, message: '月次承認済みの日報は変更できません' });
    }

    if (next === 'confirmed') {
      const warnings = reports
        .flatMap((row) => {
          const calculation = parseJson(row.calculation_detail, {}) || {};
          return [...(calculation.billing?.warnings || []), ...(calculation.payment?.warnings || [])];
        })
        .filter((warning, index, all) => all.findIndex((item) => item.code === warning.code) === index);
      if (warnings.length && !req.body.acknowledge_warnings) {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          code: 'confirmation_warning',
          message: warnings.map((warning) => warning.message).join('\n'),
          warnings,
        });
      }

      const ids = reports.map((row) => Number(row.daily_report_id));
      const [versions] = await conn.query(
        `SELECT COALESCE(MAX(confirmation_version), 0) AS max_version
         FROM daily_report_confirmation_snapshots
         WHERE daily_report_id IN (${ids.map(() => '?').join(', ')})`,
        ids
      );
      const confirmationVersion = Number(versions[0]?.max_version || 0) + 1;
      const confirmedReports = reports.map((row) => ({
        ...row,
        status: 'confirmed',
        confirmation_version: confirmationVersion,
      }));
      const snapshot = {
        scope: 'project_work_date',
        project_id: projectId,
        work_date: workDate,
        confirmation_version: confirmationVersion,
        reports: confirmedReports,
      };
      await conn.query(
        `UPDATE daily_reports
         SET status = 'confirmed', rejection_reason = NULL,
             version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ? AND work_date = ? AND is_deleted = 0`,
        [projectId, workDate]
      );
      for (const row of reports) {
        await conn.query(
          `INSERT INTO daily_report_confirmation_snapshots
            (daily_report_id, confirmation_version, snapshot_data, confirmed_by_user_id)
           VALUES (?, ?, ?, ?)`,
          [row.daily_report_id, confirmationVersion, JSON.stringify(snapshot), actorUserId]
        );
        await insertAudit(
          conn,
          row.daily_report_id,
          'daily_confirm',
          { status: row.status },
          { status: 'confirmed', confirmation_version: confirmationVersion, scope: 'project_work_date' },
          null,
          actorUserId
        );
      }
    } else {
      const monthly = await conn.query(
        `SELECT status FROM daily_report_monthly_approvals
         WHERE project_id = ? AND target_year_month = ?
         ORDER BY approval_version DESC LIMIT 1`,
        [projectId, String(reports[0].target_year_month || '')]
      );
      const monthlyRows = Array.isArray(monthly[0]) ? monthly[0] : [];
      if (monthlyRows[0]?.status === 'submitted') {
        await conn.rollback();
        return res.status(409).json({ ok: false, message: '月次承認依頼を取り消してから日次確認を解除してください' });
      }
      await conn.query(
        `UPDATE daily_reports
         SET status = 'draft', version = version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ? AND work_date = ? AND is_deleted = 0 AND status = 'confirmed'`,
        [projectId, workDate]
      );
      for (const row of reports.filter((item) => item.status === 'confirmed')) {
        await insertAudit(
          conn,
          row.daily_report_id,
          'daily_unconfirm',
          { status: 'confirmed' },
          { status: 'draft', scope: 'project_work_date' },
          null,
          actorUserId
        );
      }
    }

    await conn.commit();
    const updated = await query(
      `SELECT * FROM daily_reports
       WHERE project_id = ? AND work_date = ? AND is_deleted = 0
       ORDER BY daily_report_id ASC`,
      [projectId, workDate]
    );
    return res.json({ ok: true, reports: updated });
  } catch (err) {
    await conn.rollback();
    return routeError(res, err, '日次確認処理に失敗しました');
  } finally {
    conn.release();
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
    const input = pick(req.body || {});
    if (!input.project_id || !input.company_id || !input.work_date || !input.target_year_month) {
      return res.status(400).json({
        ok: false,
        message: '案件・企業・勤務日・対象年月は必須です',
      });
    }
    if (!input.input_source_type) input.input_source_type = 'manual';
    const calculated = await applySimpleCalc({ ...input });
    const data = { ...input, ...pickSystem(calculated) };
    const cols = Object.keys(data);
    const result = await query(
      `INSERT INTO daily_reports (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => data[c])
    );
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await insertAudit(
        conn,
        result.insertId,
        'create',
        null,
        auditSubset(data),
        data.rate_override_reason || null,
        req.session.user.user_id
      );
    } finally {
      conn.release();
    }
    return res.status(201).json({ ok: true, report: await fetchDetail(result.insertId) });
  } catch (err) {
    return routeError(res, err, '日報の作成に失敗しました');
  }
});

router.put('/:id', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const current = await fetchDetail(id);
    if (!current) return res.status(404).json({ ok: false, message: '日報が見つかりません' });

    if (current.status === 'approved') {
      return res.status(400).json({ ok: false, message: '承認済みの日報は編集できません' });
    }

    let data;
    if (current.status === 'confirmed') {
      data = {
        memo: Object.prototype.hasOwnProperty.call(req.body, 'memo') ? req.body.memo || null : current.memo,
        row_comment: Object.prototype.hasOwnProperty.call(req.body, 'row_comment')
          ? req.body.row_comment || null
          : current.row_comment,
      };
    } else {
      const input = pick(req.body || {});
      const calculated = await applySimpleCalc({ ...current, ...input });
      data = { ...input, ...pickSystem(calculated) };
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
    await conn.beginTransaction();
    const [result] = await conn.query(sql, params);
    if (!result || result.affectedRows === 0) {
      await conn.rollback();
      return res.status(409).json({ ok: false, message: '更新に失敗しました（競合）' });
    }
    const changes = changedAuditFields(current, { ...current, ...data });
    if (changes) {
      await insertAudit(
        conn,
        id,
        'manual_change',
        changes.before,
        changes.after,
        data.rate_override_reason || data.night_adjustment_reason_billing || data.night_adjustment_reason_payment,
        req.session.user.user_id
      );
    }
    await conn.commit();
    return res.json({ ok: true, report: await fetchDetail(id) });
  } catch (err) {
    await conn.rollback();
    return routeError(res, err, '日報の更新に失敗しました');
  } finally {
    conn.release();
  }
});

router.post('/:id/status', async (req, res) => {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const current = await fetchDetail(id);
    if (!current) return res.status(404).json({ ok: false, message: '日報が見つかりません' });

    const next = String(req.body.status || '');
    const reason = req.body.rejection_reason || null;
    if (!canChangeDailyStatus(current.status, next)) {
      return res.status(400).json({
        ok: false,
        message: `ステータスを ${current.status} から ${next} へは変更できません`,
      });
    }
    if (next === 'rejected' && !reason) {
      return res.status(400).json({ ok: false, message: '却下理由を入力してください' });
    }
    if (current.status === 'confirmed' && next === 'draft') {
      const monthly = await query(
        `SELECT status FROM daily_report_monthly_approvals
         WHERE project_id = ? AND target_year_month = ?
         ORDER BY approval_version DESC LIMIT 1`,
        [current.project_id, current.target_year_month]
      );
      if (monthly[0]?.status === 'submitted') {
        return res.status(409).json({ ok: false, message: '月次承認依頼を取り消してから日次確認を解除してください' });
      }
    }

    const calculation = parseJson(current.calculation_detail, {}) || {};
    const warnings = [
      ...(calculation.billing?.warnings || []),
      ...(calculation.payment?.warnings || []),
    ].filter((warning, index, all) => all.findIndex((item) => item.code === warning.code) === index);
    if (next === 'confirmed' && warnings.length && !req.body.acknowledge_warnings) {
      return res.status(409).json({
        ok: false,
        code: 'confirmation_warning',
        message: warnings.map((warning) => warning.message).join('\n'),
        warnings,
      });
    }

    await conn.beginTransaction();
    await conn.query(
      `UPDATE daily_reports
       SET status = ?, rejection_reason = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE daily_report_id = ? AND is_deleted = 0`,
      [next, next === 'rejected' ? reason : null, id]
    );
    if (next === 'confirmed') {
      const [versions] = await conn.query(
        `SELECT COALESCE(MAX(confirmation_version), 0) AS max_version
         FROM daily_report_confirmation_snapshots WHERE daily_report_id = ? FOR UPDATE`,
        [id]
      );
      const confirmationVersion = Number(versions[0]?.max_version || 0) + 1;
      const confirmed = { ...current, status: 'confirmed', confirmation_version: confirmationVersion };
      await conn.query(
        `INSERT INTO daily_report_confirmation_snapshots
          (daily_report_id, confirmation_version, snapshot_data, confirmed_by_user_id)
         VALUES (?, ?, ?, ?)`,
        [id, confirmationVersion, JSON.stringify(confirmed), req.session.user.user_id || null]
      );
      await insertAudit(
        conn,
        id,
        'daily_confirm',
        { status: current.status },
        { status: 'confirmed', confirmation_version: confirmationVersion },
        null,
        req.session.user.user_id
      );
    } else {
      await insertAudit(
        conn,
        id,
        next === 'draft' ? 'daily_unconfirm' : `status_${next}`,
        { status: current.status },
        { status: next },
        reason,
        req.session.user.user_id
      );
    }
    await conn.commit();
    return res.json({ ok: true, report: await fetchDetail(id) });
  } catch (err) {
    await conn.rollback();
    return routeError(res, err, 'ステータス更新に失敗しました');
  } finally {
    conn.release();
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
