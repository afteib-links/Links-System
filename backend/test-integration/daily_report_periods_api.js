const assert = require('node:assert/strict');
const { getPool } = require('../src/db');
const { createApp } = require('../src/server');
const { migrationPreview, applyMigration } = require('../src/services/daily_report_periods');

async function main() {
  // 書込み対象を専用の匿名DBに限定する。
  const ephemeralCi = process.env.GITHUB_ACTIONS === 'true' && process.env.DB_HOST === '127.0.0.1'
    && process.env.ADMIN_LOGIN_ID === 'ci-admin';
  assert.ok(ephemeralCi || /test|ci|verification/i.test(process.env.DB_NAME || ''), '専用匿名DBまたはGitHub CIの一時DBだけで実行できます');
  const pool = getPool();
  let server;
  const conn = await pool.getConnection();
  try {
    const [company] = await conn.query("INSERT INTO companies(company_name,closing_date_code) VALUES ('PERIOD匿名企業','20')");
    const [partner] = await conn.query("INSERT INTO partners(partner_name) VALUES ('PERIOD匿名パートナー')");
    const [billing] = await conn.query("INSERT INTO company_billings(company_id,billing_no,billing_print_name) VALUES (?,0,'PERIOD匿名請求先')", [company.insertId]);
    const [project] = await conn.query("INSERT INTO projects(company_id,billing_id,partner_id,business_type) VALUES (?,?,?,'PERIOD検証')", [company.insertId, billing.insertId, partner.insertId]);
    const projectId = Number(project.insertId);
    server = (await createApp()).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '';
    async function api(path, body, method = 'POST') {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : method,
        headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, data: await response.json() };
    }
    assert.equal((await api('/api/auth/login', { login_id: process.env.ADMIN_LOGIN_ID || 'ci-admin', password: process.env.ADMIN_PASSWORD || 'ci-admin-password' })).status, 200);
    const list = await api(`/api/daily-reports?project_id=${projectId}&target_year_month=2026-11`);
    assert.equal(list.data.period.period_start, '2026-10-21');
    assert.equal(list.data.period.dates.length, 31);
    const input = { project_id: projectId, company_id: company.insertId, partner_id: partner.insertId, target_year_month: '2026-11', work_date: '2026-10-21', start_time: '08:00', end_time: '17:00', break_minutes: 60 };
    const created = await api('/api/daily-reports', input);
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.ok(created.data.report.daily_report_period_id);
    assert.equal((await api('/api/daily-reports', { ...input, work_date: '2026-11-21' })).status, 400);
    const warning = await api('/api/daily-reports/monthly-approval', { project_id: projectId, target_year_month: '2026-11' });
    assert.equal(warning.status, 409);
    assert.equal(warning.data.unchecked_dates[0], '2026-10-21');
    assert.equal(warning.data.unchecked_dates.at(-1), '2026-11-20');
    const months = await api('/api/daily-reports/month-projects?target_year_month=2026-11');
    assert.equal(months.data.rows.find(r => Number(r.project_id) === projectId).days_in_month, 31);

    // CSVも勤務日の暦月ではなく同じ締め期間に割り当てる。
    const csv = `案件ID,勤務日,開始,終了,休憩\n${projectId},2026/10/22,08:00,17:00,1:00\n`;
    const form = new FormData();
    form.set('file', new Blob([csv], { type: 'text/csv' }), 'anonymous-period.csv');
    const upload = await fetch(base + '/api/daily-report-imports', { method: 'POST', headers: { cookie }, body: form });
    const uploaded = await upload.json();
    assert.equal(upload.status, 201, JSON.stringify(uploaded));
    const parsed = await api(`/api/daily-report-imports/${uploaded.batch_id}/parse`, { header_row: 1, mapping: uploaded.inferred_mapping });
    assert.equal(parsed.data.rows[0].reviewed_data.target_year_month, '2026-11');
    const applied = await api(`/api/daily-report-imports/${uploaded.batch_id}/apply`, { row_ids: [parsed.data.rows[0].daily_report_import_row_id] });
    assert.equal(applied.status, 200, JSON.stringify(applied));
    const [imported] = await conn.query('SELECT target_year_month,daily_report_period_id FROM daily_reports WHERE daily_report_id=?', [applied.data.applied[0].daily_report_id]);
    assert.equal(imported[0].target_year_month, '2026-11');
    assert.ok(imported[0].daily_report_period_id);

    // 旧暦月の金額・版付きプレビューと競合、月跨ぎの付け替え。
    const [legacy] = await conn.query("INSERT INTO projects(company_id,billing_id,partner_id,closing_date,business_type) VALUES (?,?,?,'20','PERIOD移行検証')", [company.insertId, billing.insertId, partner.insertId]);
    const legacyId = Number(legacy.insertId);
    await conn.query("INSERT INTO daily_report_periods(project_id,target_year_month,period_start,period_end,closing_day,period_mode) VALUES (?,'2026-10','2026-10-01','2026-10-31','end','legacy_calendar')", [legacyId]);
    const [old] = await conn.query(`INSERT INTO daily_reports(project_id,company_id,partner_id,target_year_month,work_date,calculated_billing_amount,calculated_payment_amount)
      VALUES (?,?,?,'2026-10','2026-10-25',1234,987)`, [legacyId, company.insertId, partner.insertId]);
    await conn.beginTransaction();
    const preview = await migrationPreview(conn, legacyId);
    assert.equal(preview.changes[0].after_month, '2026-11');
    await conn.commit();
    await conn.query('UPDATE daily_reports SET version=version+1 WHERE daily_report_id=?', [old.insertId]);
    await conn.beginTransaction();
    await assert.rejects(applyMigration(conn, legacyId, preview.token, '匿名移行テスト', 1), /更新されました/);
    await conn.rollback();
    await conn.beginTransaction();
    const refreshed = await migrationPreview(conn, legacyId);
    await applyMigration(conn, legacyId, refreshed.token, '匿名移行テスト', 1);
    await conn.commit();
    const [moved] = await conn.query('SELECT * FROM daily_reports WHERE daily_report_id=?', [old.insertId]);
    assert.equal(moved[0].target_year_month, '2026-11');
    assert.equal(Number(moved[0].calculated_billing_amount), 1234);
    assert.equal(Number(moved[0].calculated_payment_amount), 987);
    await conn.query("UPDATE daily_reports SET status='confirmed' WHERE daily_report_id=?", [old.insertId]);
    await conn.beginTransaction();
    const protectedPreview = await migrationPreview(conn, legacyId);
    assert.ok(protectedPreview.protected_months.includes('2026-11'));
    await conn.rollback();
    console.log('[integration] closing period input, CSV, approval, migration, conflict and amount preservation passed');
  } finally {
    await conn.rollback();
    conn.release();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.end();
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
