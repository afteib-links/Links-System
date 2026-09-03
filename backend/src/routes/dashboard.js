const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { hasPermission } = require('../permissions');

const router = express.Router();
router.use(requireAuth);

function card(featureKey, label, statuses) {
  const values = Array.isArray(statuses) ? statuses : [];
  const completed = values.filter((value) => value === 'completed').length;
  const waiting = values.filter((value) => value === 'waiting').length;
  const attention = values.filter((value) => value === 'attention').length;
  const inProgress = values.filter((value) => value === 'in_progress').length;
  const notStarted = values.filter((value) => value === 'not_started').length;
  const total = values.length;
  return {
    feature_key: featureKey,
    label,
    total,
    incomplete: Math.max(0, total - completed),
    not_started: notStarted,
    in_progress: inProgress,
    waiting,
    completed,
    attention,
    progress_percent: total ? Math.round((completed / total) * 100) : 0,
  };
}

function accessWhere(user, kind, alias) {
  const roles = new Set(user?.roles || []);
  const params = [];
  if (roles.has('admin') || roles.has('soumu') || roles.has('executive')) return { sql: '1=1', params };
  if (kind === 'daily' && roles.has('system')) return { sql: '1=1', params };
  if (roles.has('sales')) {
    params.push(user.user_id);
    if (kind === 'invoice') {
      return { sql: `EXISTS (SELECT 1 FROM invoice_daily_reports idr JOIN daily_reports drx ON drx.daily_report_id=idr.daily_report_id JOIN project_settlement_reviewers psr ON psr.project_id=drx.project_id WHERE idr.invoice_id=${alias}.invoice_id AND psr.user_id=?)`, params };
    }
    if (kind === 'payment') {
      return { sql: `EXISTS (SELECT 1 FROM payment_daily_reports pdr JOIN daily_reports drx ON drx.daily_report_id=pdr.daily_report_id JOIN project_settlement_reviewers psr ON psr.project_id=drx.project_id WHERE pdr.payment_id=${alias}.payment_id AND psr.user_id=?)`, params };
    }
    return { sql: `EXISTS (SELECT 1 FROM project_settlement_reviewers psr WHERE psr.project_id=${alias}.project_id AND psr.user_id=?)`, params };
  }
  if (kind === 'daily' && roles.has('partner')) { params.push(user.partner_id); return { sql: `${alias}.partner_id=?`, params }; }
  if (kind === 'invoice' && roles.has('company')) { params.push(user.company_id); return { sql: `${alias}.company_id=?`, params }; }
  if (kind === 'payment' && roles.has('partner')) { params.push(user.partner_id); return { sql: `${alias}.partner_id=?`, params }; }
  return { sql: '1=0', params };
}

async function dailyCard(user, ym) {
  const access = accessWhere(user, 'daily', 'p');
  const rows = await query(
    `SELECT p.project_id, COUNT(d.daily_report_id) report_count,
            (SELECT a.status FROM daily_report_monthly_approvals a
             WHERE a.project_id=p.project_id AND a.target_year_month=?
             ORDER BY a.approval_version DESC LIMIT 1) approval_status
     FROM projects p
     LEFT JOIN daily_reports d ON d.project_id=p.project_id AND d.target_year_month=? AND d.is_deleted=0
     WHERE p.is_deleted=0 AND ${access.sql}
     GROUP BY p.project_id`,
    [ym, ym, ...access.params]
  );
  const statuses = rows.map((row) => {
    if (row.approval_status === 'approved') return 'completed';
    if (row.approval_status === 'submitted') return 'waiting';
    if (row.approval_status === 'rejected') return 'attention';
    return Number(row.report_count) ? 'in_progress' : 'not_started';
  });
  return card('daily_reports', '日報', statuses);
}

async function advanceCard(ym) {
  const projects = await query(
    `SELECT DISTINCT p.project_id
     FROM projects p
     JOIN project_advance_terms t ON t.project_id=p.project_id AND t.is_enabled=1 AND t.is_deleted=0
     WHERE p.is_deleted=0 AND p.closing_date IN ('5','10','15','20','25','end')
       AND t.valid_from<=LAST_DAY(?) AND (t.valid_to IS NULL OR t.valid_to>=?)`,
    [`${ym}-01`, `${ym}-01`]
  );
  const records = await query(
    `SELECT ar.project_id, ar.status
     FROM advance_records ar
     JOIN (SELECT project_id,MAX(advance_record_id) advance_record_id FROM advance_records WHERE target_year_month=? GROUP BY project_id) latest
       ON latest.advance_record_id=ar.advance_record_id`, [ym]
  );
  const byProject = new Map(records.map((row) => [Number(row.project_id), row.status]));
  const statuses = projects.map((row) => {
    const status = byProject.get(Number(row.project_id));
    if (status === 'executed') return 'completed';
    if (status === 'planned') return 'waiting';
    if (status === 'cancelled') return 'attention';
    return 'not_started';
  });
  return card('advances', '先払い', statuses);
}

async function invoiceCard(user, ym) {
  const documentAccess = accessWhere(user, 'invoice', 'i');
  const documents = await query(
    `SELECT i.settlement_status FROM invoices i WHERE i.is_deleted=0 AND i.target_year_month=? AND ${documentAccess.sql}`,
    [ym, ...documentAccess.params]
  );
  const roles = new Set(user?.roles || []);
  const targetWhere = [];
  const params = [ym];
  if (roles.has('company')) { targetWhere.push('d.company_id=?'); params.push(user.company_id); }
  else if (roles.has('sales')) { targetWhere.push('EXISTS (SELECT 1 FROM project_settlement_reviewers psr WHERE psr.project_id=d.project_id AND psr.user_id=?)'); params.push(user.user_id); }
  else if (!(roles.has('admin') || roles.has('soumu') || roles.has('executive'))) targetWhere.push('1=0');
  const targets = await query(
    `SELECT COUNT(DISTINCT d.project_id) count FROM daily_reports d
     WHERE d.is_deleted=0 AND d.target_year_month=? AND d.status='approved' AND d.billing_status='none'
       AND EXISTS (SELECT 1 FROM daily_report_monthly_approvals a WHERE a.project_id=d.project_id AND a.target_year_month=d.target_year_month AND a.status='approved')
       ${targetWhere.length ? `AND ${targetWhere.join(' AND ')}` : ''}`, params
  );
  const statuses = documents.map((row) => ({ finalized:'completed', sales_reviewed:'waiting', cancelled:'attention', draft:'in_progress' }[row.settlement_status] || 'in_progress'));
  statuses.push(...Array(Number(targets[0]?.count || 0)).fill('not_started'));
  return card('invoices', '請求', statuses);
}

async function paymentCard(user, ym) {
  const documentAccess = accessWhere(user, 'payment', 'pay');
  const documents = await query(
    `SELECT pay.settlement_status FROM payments pay WHERE pay.is_deleted=0 AND pay.target_year_month=? AND ${documentAccess.sql}`,
    [ym, ...documentAccess.params]
  );
  const roles = new Set(user?.roles || []);
  const targetWhere = [];
  const params = [ym];
  if (roles.has('partner')) { targetWhere.push('d.partner_id=?'); params.push(user.partner_id); }
  else if (roles.has('sales')) { targetWhere.push('EXISTS (SELECT 1 FROM project_settlement_reviewers psr WHERE psr.project_id=d.project_id AND psr.user_id=?)'); params.push(user.user_id); }
  else if (!(roles.has('admin') || roles.has('soumu') || roles.has('executive'))) targetWhere.push('1=0');
  const targets = await query(
    `SELECT COUNT(DISTINCT d.partner_id) count FROM daily_reports d
     WHERE d.is_deleted=0 AND d.target_year_month=? AND d.status='approved' AND d.payment_status='none' AND d.partner_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM daily_report_monthly_approvals a WHERE a.project_id=d.project_id AND a.target_year_month=d.target_year_month AND a.status='approved')
       ${targetWhere.length ? `AND ${targetWhere.join(' AND ')}` : ''}`, params
  );
  const statuses = documents.map((row) => ({ finalized:'completed', sales_reviewed:'waiting', cancelled:'attention', draft:'in_progress' }[row.settlement_status] || 'in_progress'));
  statuses.push(...Array(Number(targets[0]?.count || 0)).fill('not_started'));
  return card('payments', '支払', statuses);
}

router.get('/summary', async (req, res) => {
  try {
    const ym = String(req.query.target_year_month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ ok:false, message:'対象年月は必須です' });
    const user = req.session.user;
    const cards = [];
    if (hasPermission(user, 'daily_reports')) cards.push(await dailyCard(user, ym));
    if (hasPermission(user, 'advances')) cards.push(await advanceCard(ym));
    if (hasPermission(user, 'invoices')) cards.push(await invoiceCard(user, ym));
    if (hasPermission(user, 'payments')) cards.push(await paymentCard(user, ym));
    return res.json({ ok:true, target_year_month:ym, cards });
  } catch (err) {
    console.error('[dashboard/summary]', err);
    return res.status(500).json({ ok:false, message:'ダッシュボード集計の取得に失敗しました' });
  }
});

router.card = card;
module.exports = router;
