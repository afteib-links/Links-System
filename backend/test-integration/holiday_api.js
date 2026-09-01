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
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function priceExtra() {
  const empty = { billing: '', payment: '', lineIds: {} };
  const item = (id, name, weekdays) => ({
    id,
    name,
    mode: 'weekdays',
    weekdays,
    matrix: {
      daily: { basic: { billing: 10000, payment: 8000, lineIds: {} }, overtime: empty, night: empty, night_overtime: empty },
      hourly: { basic: empty, overtime: empty, night: empty, night_overtime: empty },
    },
  });
  return {
    fee_items: [
      item('weekday', '通常料金', { weekday: true }),
      item('holiday', '休日料金', { holiday: true }),
    ],
  };
}

async function seed(pool) {
  const [company] = await pool.execute(`INSERT INTO companies (company_name) VALUES ('休日CI匿名企業')`);
  const [partner] = await pool.execute(`INSERT INTO partners (partner_name) VALUES ('休日CI匿名パートナー')`);
  const [project] = await pool.execute(
    `INSERT INTO projects (company_id, partner_id, manager_name, business_type)
     VALUES (?, ?, '休日CI担当', '休日CI案件')`,
    [company.insertId, partner.insertId]
  );
  await pool.execute(
    `INSERT INTO price_sets
      (price_set_no, price_set_name, company_id, project_id, apply_start_date, extra_data)
     VALUES ('PS-HOLIDAY-CI', '休日CI料金', ?, ?, '2026-09-01', ?)`,
    [company.insertId, project.insertId, JSON.stringify(priceExtra())]
  );
  return { projectId: Number(project.insertId) };
}

async function main() {
  const pool = getPool();
  let server;
  try {
    const ids = await seed(pool);
    server = await listen(await createApp());
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let cookie = '';
    async function request(path, options = {}) {
      const headers = { connection: 'close', ...(options.headers || {}) };
      if (options.body != null) headers['content-type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';', 1)[0];
      return { response, data: await response.json() };
    }

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login_id: 'ci-admin', password: 'ci-admin-password' }),
    });
    assert.equal(login.response.status, 200);

    const globalHoliday = await request('/api/master-settings/holidays', {
      method: 'POST',
      body: JSON.stringify({ holiday_date: '2026-09-01', holiday_name: 'CI全体休日' }),
    });
    assert.equal(globalHoliday.response.status, 201);

    const projectHoliday = await request('/api/master-settings/holidays', {
      method: 'POST',
      body: JSON.stringify({ holiday_date: '2026-09-02', holiday_name: 'CI案件休日', project_id: ids.projectId }),
    });
    assert.equal(projectHoliday.response.status, 201);

    const overlappingProjectHoliday = await request('/api/master-settings/holidays', {
      method: 'POST',
      body: JSON.stringify({ holiday_date: '2026-09-01', holiday_name: 'CI重複案件休日', project_id: ids.projectId }),
    });
    assert.equal(overlappingProjectHoliday.response.status, 201);

    const duplicate = await request('/api/master-settings/holidays', {
      method: 'POST',
      body: JSON.stringify({ holiday_date: '2026-09-02', holiday_name: '重複', project_id: ids.projectId }),
    });
    assert.equal(duplicate.response.status, 409);

    async function context(date, selected = '') {
      const suffix = selected ? `&selected_fee_item_id=${selected}` : '';
      return request(`/api/daily-reports/calculation-context?project_id=${ids.projectId}&work_date=${date}${suffix}`);
    }

    const global = await context('2026-09-01');
    assert.equal(global.data.context.selected_fee_item_id, 'holiday');
    assert.equal(global.data.context.holiday.scope, 'project');

    const removedOverlap = await request(
      `/api/master-settings/holidays/${overlappingProjectHoliday.data.holiday_id}`,
      { method: 'DELETE' }
    );
    assert.equal(removedOverlap.response.status, 200);
    const globalAfterProjectDelete = await context('2026-09-01');
    assert.equal(globalAfterProjectDelete.data.context.holiday.scope, 'global');

    const project = await context('2026-09-02');
    assert.equal(project.data.context.selected_fee_item_id, 'holiday');
    assert.equal(project.data.context.holiday.scope, 'project');

    const normal = await context('2026-09-03');
    assert.equal(normal.data.context.selected_fee_item_id, 'weekday');
    assert.equal(normal.data.context.holiday, null);

    const manual = await context('2026-09-01', 'weekday');
    assert.equal(manual.data.context.selected_fee_item_id, 'weekday');
    assert.equal(manual.data.context.fee_item_selection_source, 'manual');

    const removed = await request(`/api/master-settings/holidays/${projectHoliday.data.holiday_id}`, { method: 'DELETE' });
    assert.equal(removed.response.status, 200);
    const afterDelete = await context('2026-09-02');
    assert.equal(afterDelete.data.context.selected_fee_item_id, 'weekday');
    console.log('[integration] holiday master and daily report selection verified');
  } finally {
    await close(server);
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[integration] holiday verification failed', error);
    process.exit(1);
  });
