const assert = require('node:assert/strict');
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
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function seedAnonymousProject(pool) {
  const [company] = await pool.execute(
    `INSERT INTO companies (company_name) VALUES ('CI匿名企業')`
  );
  const [partner] = await pool.execute(
    `INSERT INTO partners (partner_name) VALUES ('CI匿名パートナー')`
  );
  const [project] = await pool.execute(
    `INSERT INTO projects (company_id, partner_id, manager_name, business_type)
     VALUES (?, ?, 'CI担当', 'CI日報結合試験')`,
    [company.insertId, partner.insertId]
  );
  return {
    companyId: Number(company.insertId),
    partnerId: Number(partner.insertId),
    projectId: Number(project.insertId),
  };
}

async function main() {
  const pool = getPool();
  let server;
  try {
    const ids = await seedAnonymousProject(pool);
    const app = await createApp();
    server = await listen(app);
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    let cookie = '';

    async function request(path, options = {}) {
      const headers = { connection: 'close', ...(options.headers || {}) };
      if (options.body != null) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      const data = await response.json();
      return { response, data };
    }

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login_id: 'ci-admin', password: 'ci-admin-password' }),
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.data.ok, true);
    assert.match(cookie, /^connect\.sid=/);

    const commonReport = {
      project_id: ids.projectId,
      company_id: ids.companyId,
      partner_id: ids.partnerId,
      target_year_month: '2026-08',
      work_date: '2026-08-31',
      break_minutes: 60,
    };
    for (const time of [
      { start_time: '08:00', end_time: '12:00', row_comment: '午前作業' },
      { start_time: '13:00', end_time: '18:00', row_comment: '午後作業' },
    ]) {
      const created = await request('/api/daily-reports', {
        method: 'POST',
        body: JSON.stringify({ ...commonReport, ...time }),
      });
      assert.equal(created.response.status, 201);
      assert.equal(created.data.ok, true);
    }

    const listed = await request(
      `/api/daily-reports?target_year_month=2026-08&project_id=${ids.projectId}`
    );
    assert.equal(listed.response.status, 200);
    assert.equal(listed.data.reports.length, 2);

    const confirmed = await request('/api/daily-reports/day-status', {
      method: 'POST',
      body: JSON.stringify({
        project_id: ids.projectId,
        work_date: '2026-08-31',
        status: 'confirmed',
      }),
    });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.data.reports.every((row) => row.status === 'confirmed'), true);

    const [snapshots] = await pool.execute(
      `SELECT snapshot_data
       FROM daily_report_confirmation_snapshots
       WHERE daily_report_id IN (
         SELECT daily_report_id FROM daily_reports WHERE project_id = ? AND work_date = '2026-08-31'
       )`,
      [ids.projectId]
    );
    assert.equal(snapshots.length, 2);
    const snapshot = typeof snapshots[0].snapshot_data === 'string'
      ? JSON.parse(snapshots[0].snapshot_data)
      : snapshots[0].snapshot_data;
    assert.equal(snapshot.scope, 'project_work_date');
    assert.equal(snapshot.reports.length, 2);

    const unconfirmed = await request('/api/daily-reports/day-status', {
      method: 'POST',
      body: JSON.stringify({
        project_id: ids.projectId,
        work_date: '2026-08-31',
        status: 'draft',
      }),
    });
    assert.equal(unconfirmed.response.status, 200);
    assert.equal(unconfirmed.data.reports.every((row) => row.status === 'draft'), true);

    const reconfirmed = await request('/api/daily-reports/day-status', {
      method: 'POST',
      body: JSON.stringify({
        project_id: ids.projectId,
        work_date: '2026-08-31',
        status: 'confirmed',
      }),
    });
    assert.equal(reconfirmed.response.status, 200);

    const warning = await request('/api/daily-reports/monthly-approval', {
      method: 'POST',
      body: JSON.stringify({
        project_id: ids.projectId,
        target_year_month: '2026-08',
        action: 'submit',
      }),
    });
    assert.equal(warning.response.status, 409);
    assert.equal(warning.data.code, 'unchecked_days_warning');
    assert.equal(warning.data.unchecked_dates.includes('2026-08-30'), true);

    const submitted = await request('/api/daily-reports/monthly-approval', {
      method: 'POST',
      body: JSON.stringify({
        project_id: ids.projectId,
        target_year_month: '2026-08',
        action: 'submit',
        acknowledge_warnings: true,
      }),
    });
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.data.approval.status, 'submitted');

    const approved = await request('/api/daily-reports/monthly-approval', {
      method: 'POST',
      body: JSON.stringify({
        project_id: ids.projectId,
        target_year_month: '2026-08',
        action: 'approve',
      }),
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.data.approval.status, 'approved');

    const [approvedReports] = await pool.execute(
      `SELECT status FROM daily_reports WHERE project_id = ? AND is_deleted = 0`,
      [ids.projectId]
    );
    assert.equal(approvedReports.every((row) => row.status === 'approved'), true);
    console.log('[integration] daily report API workflow verified');
  } finally {
    await close(server);
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[integration] daily report API verification failed', error);
    process.exit(1);
  });
