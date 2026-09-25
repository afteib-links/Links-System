const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/server');
const { getPool } = require('../src/db');

const password = 'system-design-test-password';

async function request(base, route, cookie = '', options = {}) {
  const headers = { connection: 'close', ...(cookie ? { cookie } : {}), ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${route}`, { ...options, headers, redirect: 'manual' });
  return { response, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] || cookie };
}

async function login(base, loginId) {
  const result = await request(base, '/api/auth/login', '', { method: 'POST', body: JSON.stringify({ login_id: loginId, password }) });
  assert.equal(result.response.status, 200);
  return result.cookie;
}

async function main() {
  const pool = getPool();
  const created = [];
  let server;
  try {
    const hash = await bcrypt.hash(password, 4);
    for (const role of ['admin', 'system', 'soumu']) {
      const loginId = `system-design-access-${role}`;
      await pool.query('DELETE FROM users WHERE login_id=?', [loginId]);
      const [result] = await pool.query(`INSERT INTO users (login_id,password_hash,display_name,role,roles,is_active,permissions,departments,areas,extra_data) VALUES (?,?,?,'staff',?,1,JSON_ARRAY(),JSON_ARRAY(),JSON_ARRAY(),?)`, [loginId, hash, `設計書権限 ${role}`, JSON.stringify([role]), JSON.stringify({ test_key: 'system-design-access' })]);
      created.push({ id: Number(result.insertId), role, loginId });
    }
    const app = await createApp();
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    assert.equal((await request(base, '/system-design/')).response.status, 401);
    for (const user of created) user.cookie = await login(base, user.loginId);
    for (const role of ['admin', 'system']) {
      const user = created.find((item) => item.role === role);
      const page = await request(base, '/system-design/', user.cookie);
      assert.equal(page.response.status, 200, role);
      assert.match(page.response.headers.get('content-type') || '', /text\/html/);
      assert.match(page.response.headers.get('content-security-policy') || '', /default-src 'self'/);
      assert.equal((await request(base, '/system-design/system-design.css', user.cookie)).response.status, 200);
    }
    const soumu = created.find((item) => item.role === 'soumu');
    assert.equal((await request(base, '/system-design/', soumu.cookie)).response.status, 403);
    for (const asset of ['source.js', 'source.css', 'sources/feature-companies.html', 'sources/feature-companies.md']) {
      const route = `/system-design/${asset}`;
      assert.equal((await request(base, route)).response.status, 401, asset);
      assert.equal((await request(base, route, soumu.cookie)).response.status, 403, asset);
      for (const role of ['admin', 'system']) {
        assert.equal((await request(base, route, created.find((item) => item.role === role).cookie)).response.status, 200, `${role}: ${asset}`);
      }
    }
    console.log('[integration] system design access verified');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (created.length) await pool.query(`DELETE FROM users WHERE user_id IN (${created.map(() => '?').join(',')})`, created.map((item) => item.id));
    await pool.end();
  }
}

// セッションストアの定期清掃タイマーが残るため、後片付け完了後に終了する。
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
