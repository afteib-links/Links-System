const crypto = require('node:crypto');
const { getPool } = require('../db');

function periodError(message, status = 409) {
  return Object.assign(new Error(message), { status, code: 'period_conflict' });
}
function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)) && Number(String(value).slice(0, 4)) >= 1900;
}
function iso(date) { return date.toISOString().slice(0, 10); }
function nextDate(value, days = 1) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}
function shiftMonth(ym, count) {
  if (!validMonth(ym)) throw periodError('対象年月を確認してください', 400);
  const [y, m] = ym.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + count, 1))).slice(0, 7);
}
function normalizeClosingDay(value) {
  if (value == null || value === '' || value === 'end' || String(value) === '31') return 'end';
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 30) throw periodError('案件の締日設定を確認してください', 400);
  return String(day);
}
function monthEnd(ym, closingDay) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(closingDay === 'end' ? last : Math.min(last, Number(closingDay))).padStart(2, '0')}`;
}
function closingPeriod(ym, day) {
  if (!validMonth(ym)) throw periodError('対象年月を確認してください', 400);
  const closing = normalizeClosingDay(day);
  return {
    target_year_month: ym, closing_day: closing, period_mode: 'closing',
    period_start: nextDate(monthEnd(shiftMonth(ym, -1), closing)),
    period_end: monthEnd(ym, closing),
  };
}
function periodDates(period) {
  const dates = [];
  for (let date = period.period_start; date <= period.period_end; date = nextDate(date)) {
    if (dates.length >= 62) throw periodError('締め期間が長すぎます。期間設定を確認してください');
    dates.push(date);
  }
  return dates;
}
function resolvePeriod(ym, closingDay, saved = []) {
  const existing = saved.find(p => p.target_year_month === ym);
  if (existing) return { ...existing, dates: periodDates(existing) };
  const result = closingPeriod(ym, closingDay);
  const previous = saved.find(p => p.target_year_month === shiftMonth(ym, -1));
  if (previous && nextDate(previous.period_end) !== result.period_start) {
    result.period_start = nextDate(previous.period_end);
    result.period_mode = 'transition';
  }
  const next = saved.find(p => p.target_year_month === shiftMonth(ym, 1));
  if (result.period_start > result.period_end || (next && nextDate(result.period_end) !== next.period_start)
    || saved.some(p => p.period_start <= result.period_end && p.period_end >= result.period_start)) {
    throw periodError('保存済みの前後の期間と締日が一致しません。締め期間の移行画面で確認してください');
  }
  return { ...result, dates: periodDates(result) };
}
async function projectPeriods(conn, projectId, lock = false) {
  const [projects] = await conn.query(
    `SELECT p.project_id,COALESCE(NULLIF(p.closing_date,''),NULLIF(c.closing_date_code,''),'end') closing_day
     FROM projects p LEFT JOIN companies c ON c.company_id=p.company_id
     WHERE p.project_id=? AND p.is_deleted=0 ${lock ? 'FOR UPDATE' : ''}`, [projectId]);
  if (!projects.length) throw periodError('案件が見つかりません', 404);
  const [periods] = await conn.query('SELECT * FROM daily_report_periods WHERE project_id=? ORDER BY target_year_month', [projectId]);
  return { project: projects[0], periods };
}
async function getPeriod(projectId, ym, conn = getPool(), persist = false) {
  const { project, periods } = await projectPeriods(conn, projectId, persist);
  const period = resolvePeriod(ym, project.closing_day, periods);
  if (persist && !period.daily_report_period_id) {
    const [result] = await conn.query(
      `INSERT INTO daily_report_periods (project_id,target_year_month,period_start,period_end,closing_day,period_mode)
       VALUES (?,?,?,?,?,?)`, [projectId, ym, period.period_start, period.period_end, period.closing_day, period.period_mode]);
    period.daily_report_period_id = result.insertId;
    period.version = 1;
  }
  return period;
}
async function periodForDate(projectId, date, conn = getPool(), persist = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || iso(new Date(`${date}T00:00:00Z`)) !== date) throw periodError('勤務日を確認してください', 400);
  const { project, periods } = await projectPeriods(conn, projectId, persist);
  const matched = periods.filter(p => p.period_start <= date && p.period_end >= date);
  if (matched.length > 1) throw periodError('勤務日が複数の締め期間に重複しています');
  if (matched.length) return getPeriod(projectId, matched[0].target_year_month, conn, persist);
  let ym = date.slice(0, 7);
  if (date > closingPeriod(ym, project.closing_day).period_end) ym = shiftMonth(ym, 1);
  const period = await getPeriod(projectId, ym, conn, persist);
  if (date < period.period_start || date > period.period_end) throw periodError('勤務日を含む締め期間がありません');
  return period;
}
async function assertPeriodEditable(conn, projectId, ym) {
  const [rows] = await conn.query(`SELECT status FROM daily_report_monthly_approvals
    WHERE project_id=? AND target_year_month=? ORDER BY approval_version DESC LIMIT 1`, [projectId, ym]);
  if (['submitted', 'approved'].includes(rows[0]?.status)) throw periodError('この締め期間は承認中または承認済みのため変更できません');
}
async function bindReportPeriod(conn, input) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.work_date)) || Number.isNaN(Date.parse(`${input.work_date}T00:00:00Z`))
    || iso(new Date(`${input.work_date}T00:00:00Z`)) !== input.work_date) throw periodError('勤務日を確認してください', 400);
  const period = await getPeriod(input.project_id, input.target_year_month, conn, true);
  if (input.work_date < period.period_start || input.work_date > period.period_end) {
    throw periodError(`勤務日は ${period.period_start}〜${period.period_end} の範囲で入力してください`, 400);
  }
  await assertPeriodEditable(conn, input.project_id, input.target_year_month);
  return period;
}

// 金額再計算をせず、案件の未確定期間全体を一度に付け替える。
async function migrationPreview(conn, projectId) {
  const { project, periods } = await projectPeriods(conn, projectId, true);
  const [reports] = await conn.query('SELECT * FROM daily_reports WHERE project_id=? AND is_deleted=0 ORDER BY daily_report_id FOR UPDATE', [projectId]);
  const [approvals] = await conn.query('SELECT target_year_month,status FROM daily_report_monthly_approvals WHERE project_id=?', [projectId]);
  const protectedMonths = new Set(approvals.filter(a => ['submitted', 'approved'].includes(a.status)).map(a => a.target_year_month));
  for (const r of reports) if (['confirmed', 'approved'].includes(r.status)
    || (r.billing_status && r.billing_status !== 'none') || (r.payment_status && r.payment_status !== 'none')) protectedMonths.add(r.target_year_month);
  const fixed = periods.filter(p => protectedMonths.has(p.target_year_month));
  const adjustable = periods.filter(p => !protectedMonths.has(p.target_year_month));
  const proposed = [...fixed];
  const months = new Set(adjustable.map(p => p.target_year_month));
  for (const r of reports.filter(r => !protectedMonths.has(r.target_year_month))) {
    const month = r.work_date.slice(0, 7);
    months.add(month);
    if (r.work_date > closingPeriod(month, project.closing_day).period_end) months.add(shiftMonth(month, 1));
  }
  for (const ym of [...months].sort()) {
    if (protectedMonths.has(ym)) continue;
    const period = resolvePeriod(ym, project.closing_day, proposed);
    proposed.push({ ...period, project_id: Number(projectId) });
  }
  proposed.sort((a, b) => a.target_year_month.localeCompare(b.target_year_month));
  const changes = reports.map(r => {
    const matches = proposed.filter(p => p.period_start <= r.work_date && p.period_end >= r.work_date);
    if (matches.length !== 1) throw periodError(`${r.work_date} の所属を一意に決められません。確定済み期間と締日を確認してください`);
    const ym = matches[0].target_year_month;
    if (protectedMonths.has(r.target_year_month) && ym !== r.target_year_month) throw periodError('確定済みの日報の所属は変更できません');
    return { daily_report_id: r.daily_report_id, version: r.version, work_date: r.work_date,
      before_month: r.target_year_month, after_month: ym,
      billing_amount: r.override_billing_amount ?? r.calculated_billing_amount,
      payment_amount: r.override_payment_amount ?? r.calculated_payment_amount };
  });
  const result = { project_id: Number(projectId), closing_day: project.closing_day,
    before_periods: periods, periods: proposed, changes, protected_months: [...protectedMonths].sort() };
  // 全日報の状態・版・金額も署名に含め、プレビュー後の更新・確認を検出する。
  result.token = crypto.createHash('sha256').update(JSON.stringify({ result, reports, approvals })).digest('hex');
  return result;
}
async function applyMigration(conn, projectId, token, reason, actor) {
  if (!String(reason || '').trim()) throw periodError('移行理由を入力してください', 400);
  const preview = await migrationPreview(conn, projectId);
  if (preview.token !== token) throw periodError('プレビュー後に内容が更新されました。差分を再取得してください');
  for (const p of preview.periods) {
    if (preview.protected_months.includes(p.target_year_month)) continue;
    await conn.query(`INSERT INTO daily_report_periods
      (project_id,target_year_month,period_start,period_end,closing_day,period_mode) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE period_start=VALUES(period_start),period_end=VALUES(period_end),
      closing_day=VALUES(closing_day),period_mode=VALUES(period_mode),version=version+1`,
    [projectId, p.target_year_month, p.period_start, p.period_end, p.closing_day, p.period_mode]);
  }
  for (const change of preview.changes) {
    if (preview.protected_months.includes(change.before_month)) continue;
    await conn.query(`UPDATE daily_reports d JOIN daily_report_periods p ON p.project_id=d.project_id AND p.target_year_month=?
      SET d.target_year_month=?,d.daily_report_period_id=p.daily_report_period_id,d.version=d.version+1
      WHERE d.daily_report_id=? AND d.version=?`, [change.after_month, change.after_month, change.daily_report_id, change.version]);
    await conn.query(`INSERT INTO daily_report_audit_logs
      (daily_report_id,action_code,before_data,after_data,reason,actor_user_id) VALUES (?,'period_migration',?,?,?,?)`,
    [change.daily_report_id, JSON.stringify({ target_year_month: change.before_month }), JSON.stringify({ target_year_month: change.after_month }), reason, actor]);
  }
  await conn.query(`INSERT INTO daily_report_period_audits (project_id,before_data,after_data,reason,actor_user_id)
    VALUES (?,?,?,?,?)`, [projectId, JSON.stringify(preview.before_periods), JSON.stringify(preview), reason, actor]);
  // 未確定の月間距離キャッシュは所属変更後の勤務日から再計算する。
  for (const p of preview.periods) if (!preview.protected_months.includes(p.target_year_month)) {
    await conn.query('DELETE FROM daily_report_distance_monthly_results WHERE project_id=? AND target_year_month=?', [projectId, p.target_year_month]);
  }
  return preview;
}
module.exports = { validMonth, shiftMonth, nextDate, closingPeriod, periodDates, resolvePeriod,
  getPeriod, periodForDate, bindReportPeriod, assertPeriodEditable, migrationPreview, applyMigration, periodError };
