const assert = require('node:assert/strict');
const fs = require('fs/promises');
const { createApp } = require('../src/server');
const { getPool } = require('../src/db');

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function main() {
  const pool = getPool();
  let server;
  let companyId;
  let partnerId;
  let projectId;
  let batchId;
  let reportId;
  try {
    const [company] = await pool.query("INSERT INTO companies (company_name) VALUES ('IMPORT-CI匿名企業')");
    companyId = Number(company.insertId);
    const [partner] = await pool.query("INSERT INTO partners (partner_name) VALUES ('IMPORT-CI匿名パートナー')");
    partnerId = Number(partner.insertId);
    const [project] = await pool.query(
      "INSERT INTO projects (company_id,partner_id,manager_name,business_type,operation_start_date) VALUES (?,?, 'IMPORT-CI担当','IMPORT-CI案件','2026-09-01')",
      [companyId, partnerId]
    );
    projectId = Number(project.insertId);

    server = await listen(await createApp());
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie = '';
    async function request(urlPath, options = {}) {
      const headers = { connection:'close', ...(options.headers || {}) };
      if (options.body != null && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${baseUrl}${urlPath}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      const data = await response.json();
      return { response, data };
    }

    const login = await request('/api/auth/login', { method:'POST', body:JSON.stringify({ login_id:'ci-admin', password:'ci-admin-password' }) });
    assert.equal(login.response.status, 200);

    const csv = `案件ID,勤務日,開始,終了,休憩,距離,高速代,備考\r\n${projectId},2026/09/05,20:00,4:00,1:00,120,1300,夜間配送\r\n`;
    const form = new FormData();
    form.set('target_year_month', '2026-09');
    form.set('file', new Blob([`\uFEFF${csv}`], { type:'text/csv' }), 'anonymous-daily.csv');
    const uploaded = await request('/api/daily-report-imports', { method:'POST', body:form });
    assert.equal(uploaded.response.status, 201);
    batchId = Number(uploaded.data.batch_id);
    assert.equal(uploaded.data.inferred_mapping.project_id, 0);

    const parsed = await request(`/api/daily-report-imports/${batchId}/parse`, {
      method:'POST',
      body:JSON.stringify({ sheet_name:'CSV', header_row:1, mapping:uploaded.data.inferred_mapping }),
    });
    assert.equal(parsed.response.status, 200);
    assert.equal(parsed.data.batch.valid_count, 1);
    const importRow = parsed.data.rows[0];
    assert.equal(importRow.reviewed_data.end_time, '28:00');

    const applied = await request(`/api/daily-report-imports/${batchId}/apply`, {
      method:'POST', body:JSON.stringify({ row_ids:[importRow.daily_report_import_row_id] }),
    });
    assert.equal(applied.response.status, 200);
    reportId = Number(applied.data.applied[0].daily_report_id);

    const [reports] = await pool.query('SELECT * FROM daily_reports WHERE daily_report_id=?', [reportId]);
    assert.equal(reports[0].input_source_type, 'excel');
    assert.equal(String(reports[0].end_time).slice(0, 5), '28:00');
    assert.equal(Number(reports[0].total_distance), 120);

    const changed = await request(`/api/daily-reports/${reportId}`, {
      method:'PUT', body:JSON.stringify({ input_source_type:'email', row_comment:'取込後修正', version:reports[0].version }),
    });
    assert.equal(changed.response.status, 200);
    assert.equal(changed.data.report.input_source_type, 'excel');

    const duplicateForm = new FormData();
    duplicateForm.set('target_year_month', '2026-09');
    duplicateForm.set('file', new Blob([`\uFEFF${csv}`], { type:'text/csv' }), 'anonymous-daily.csv');
    const duplicate = await request('/api/daily-report-imports', { method:'POST', body:duplicateForm });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.data.code, 'duplicate_file');
    console.log('[integration] daily report Excel/CSV import verified');
  } finally {
    await close(server);
    if (batchId) {
      const [files] = await pool.query('SELECT storage_path FROM daily_report_import_files WHERE daily_report_import_batch_id=?', [batchId]);
      await pool.query('DELETE FROM daily_report_import_audit_logs WHERE daily_report_import_batch_id=?', [batchId]);
      await pool.query('DELETE FROM daily_report_import_rows WHERE daily_report_import_batch_id=?', [batchId]);
      await pool.query('DELETE FROM daily_report_import_files WHERE daily_report_import_batch_id=?', [batchId]);
      await pool.query('DELETE FROM daily_report_import_batches WHERE daily_report_import_batch_id=?', [batchId]);
      for (const file of files) await fs.unlink(file.storage_path).catch(() => {});
    }
    if (reportId) {
      await pool.query('DELETE FROM daily_report_audit_logs WHERE daily_report_id=?', [reportId]);
      await pool.query('DELETE FROM daily_reports WHERE daily_report_id=?', [reportId]);
    }
    if (projectId) await pool.query('DELETE FROM projects WHERE project_id=?', [projectId]);
    if (companyId) await pool.query('DELETE FROM companies WHERE company_id=?', [companyId]);
    if (partnerId) await pool.query('DELETE FROM partners WHERE partner_id=?', [partnerId]);
    await pool.end();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('[integration] daily report import failed', error);
  process.exit(1);
});
