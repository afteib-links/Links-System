const express = require('express');
const { query } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { normalizePriceMatrixSettings } = require('../services/price_matrix_settings');
const {
  monthStart,
  shiftYm,
  listMonths,
  buildPl,
  buildMargin,
  buildDays,
} = require('../services/analytics');

const router = express.Router();
router.use(requireAuth, requirePermission('analytics'));

function ymOrNow(value) {
  if (/^\d{4}-\d{2}$/.test(String(value || ''))) return String(value);
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function loadWarningPercent() {
  const rows = await query(
    `SELECT setting_key, setting_value FROM system_settings WHERE is_deleted = 0 AND setting_key = 'price_matrix_profit_warning_percent'`
  );
  return normalizePriceMatrixSettings(rows).profit_warning_percent;
}

async function loadReports(fromYm, toYm) {
  return query(
    `SELECT dr.target_year_month, dr.company_id, c.company_name, dr.partner_id, p.partner_name, p.employment_type_code,
            SUM(COALESCE(dr.override_billing_amount, dr.calculated_billing_amount, 0)) AS sales,
            SUM(COALESCE(dr.override_payment_amount, dr.calculated_payment_amount, 0)) AS pay,
            SUM(CASE WHEN COALESCE(dr.is_absent, 0) = 0 THEN 1 ELSE 0 END) AS days
     FROM daily_reports dr
     INNER JOIN companies c ON c.company_id = dr.company_id AND c.is_deleted = 0
     LEFT JOIN partners p ON p.partner_id = dr.partner_id AND p.is_deleted = 0
     WHERE dr.is_deleted = 0
       AND dr.target_year_month BETWEEN ? AND ?
       AND EXISTS (
         SELECT 1 FROM daily_report_monthly_approvals a
         WHERE a.project_id = dr.project_id AND a.target_year_month = dr.target_year_month AND a.status = 'approved'
       )
     GROUP BY dr.target_year_month, dr.company_id, c.company_name, dr.partner_id, p.partner_name, p.employment_type_code`,
    [fromYm, toYm]
  );
}

async function loadInvoices(fromYm, toYm) {
  return query(
    `SELECT target_year_month, company_id,
            SUM(subtotal_amount) AS subtotal, SUM(tax_amount) AS tax
     FROM invoices
     WHERE is_deleted = 0 AND is_confirmed = 1
       AND target_year_month BETWEEN ? AND ?
       AND COALESCE(invoice_status, '') NOT IN ('cancelled', 'canceled')
     GROUP BY target_year_month, company_id`,
    [fromYm, toYm]
  );
}

async function loadPayments(fromYm, toYm) {
  return query(
    `SELECT target_year_month, partner_id, SUM(gross_amount) AS gross_amount
     FROM payments
     WHERE is_deleted = 0 AND is_confirmed = 1
       AND target_year_month BETWEEN ? AND ?
       AND COALESCE(payment_status, '') NOT IN ('cancelled', 'canceled')
     GROUP BY target_year_month, partner_id`,
    [fromYm, toYm]
  );
}

async function loadManagers(fromYm, toYm) {
  const fromDate = monthStart(fromYm);
  const toDate = monthStart(shiftYm(toYm, 1));
  return query(
    `SELECT cmp.company_id, cmp.staff_master_id, cmp.name_or_user, cmp.start_date, cmp.end_date,
            sm.staff_name, sm.area_name
     FROM company_manager_periods cmp
     LEFT JOIN staff_masters sm ON sm.staff_master_id = cmp.staff_master_id AND sm.is_deleted = 0
     WHERE cmp.is_deleted = 0 AND cmp.role_type = 'our_manager'
       AND cmp.start_date < ?
       AND (cmp.end_date IS NULL OR cmp.end_date >= ?)`,
    [toDate, fromDate]
  );
}

function filtersFromQuery(req) {
  return {
    area: String(req.query.area || '').trim(),
    staff: String(req.query.staff || '').trim(),
    company_id: req.query.company_id ? Number(req.query.company_id) : '',
  };
}

router.get('/meta', async (_req, res) => {
  try {
    const [staff, companies, months, warning] = await Promise.all([
      query(
        `SELECT staff_master_id, staff_name, area_name FROM staff_masters
         WHERE is_deleted = 0 AND is_active = 1 ORDER BY sort_order ASC, staff_name ASC`
      ),
      query(`SELECT company_id, company_name FROM companies WHERE is_deleted = 0 ORDER BY company_name ASC`),
      query(
        `SELECT DISTINCT target_year_month AS ym FROM daily_reports WHERE is_deleted = 0 ORDER BY target_year_month DESC`
      ),
      loadWarningPercent(),
    ]);
    const areas = [...new Set(staff.map((s) => String(s.area_name || '').trim()).filter(Boolean))].sort();
    if (!areas.includes('未設定')) areas.push('未設定');
    return res.json({
      ok: true,
      areas,
      staff,
      companies,
      months: months.map((r) => r.ym),
      profit_warning_percent: warning,
    });
  } catch (err) {
    console.error('[analytics/meta]', err);
    return res.status(500).json({ ok: false, message: '分析条件の取得に失敗しました' });
  }
});

router.get('/pl', async (req, res) => {
  try {
    const ym = ymOrNow(req.query.ym);
    const [reports, invoices, payments, managers, warning] = await Promise.all([
      loadReports(ym, ym),
      loadInvoices(ym, ym),
      loadPayments(ym, ym),
      loadManagers(ym, ym),
      loadWarningPercent(),
    ]);
    const data = buildPl({
      reports,
      invoices,
      payments,
      managers,
      filters: filtersFromQuery(req),
    });
    return res.json({ ok: true, ym, profit_warning_percent: warning, ...data });
  } catch (err) {
    console.error('[analytics/pl]', err);
    return res.status(500).json({ ok: false, message: '収支分析一覧の取得に失敗しました' });
  }
});

router.get('/margin', async (req, res) => {
  try {
    const latest = ymOrNow(req.query.ym);
    const monthCount = req.query.months === 'all' ? 'all' : Number(req.query.months || 12);
    const available = (await query(
      `SELECT DISTINCT target_year_month AS ym FROM daily_reports WHERE is_deleted = 0`
    )).map((r) => r.ym);
    const months = listMonths(latest, monthCount, available);
    const fromYm = months[months.length - 1] || latest;
    const toYm = months[0] || latest;
    const [reports, invoices, payments, managers, warning] = await Promise.all([
      loadReports(fromYm, toYm),
      loadInvoices(fromYm, toYm),
      loadPayments(fromYm, toYm),
      loadManagers(fromYm, toYm),
      loadWarningPercent(),
    ]);
    const data = buildMargin({
      reports,
      invoices,
      payments,
      managers,
      months,
      filters: filtersFromQuery(req),
    });
    return res.json({ ok: true, profit_warning_percent: warning, ...data });
  } catch (err) {
    console.error('[analytics/margin]', err);
    return res.status(500).json({ ok: false, message: '企業別利益率の取得に失敗しました' });
  }
});

router.get('/days', async (req, res) => {
  try {
    const latest = ymOrNow(req.query.ym);
    const monthCount = req.query.months === 'all' ? 'all' : Number(req.query.months || 12);
    const available = (await query(
      `SELECT DISTINCT target_year_month AS ym FROM daily_reports WHERE is_deleted = 0`
    )).map((r) => r.ym);
    const months = listMonths(latest, monthCount, available);
    const fromYm = months[months.length - 1] || latest;
    const toYm = months[0] || latest;
    const [reports, managers] = await Promise.all([loadReports(fromYm, toYm), loadManagers(fromYm, toYm)]);
    const data = buildDays({ reports, managers, months, filters: filtersFromQuery(req) });
    return res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[analytics/days]', err);
    return res.status(500).json({ ok: false, message: '稼働日一覧の取得に失敗しました' });
  }
});

module.exports = router;
