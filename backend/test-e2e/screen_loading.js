const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../../frontend')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let signedIn = false;
  let failCompany = true;
  let companyRequests = 0;
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/js/companies.js*', (route) => {
    companyRequests++;
    return failCompany ? route.abort('connectionreset') : route.continue();
  });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === '/api/auth/me' && !signedIn) return json({ ok: false }, 401);
    if (url.pathname === '/api/auth/me' || url.pathname === '/api/auth/login') {
      signedIn = true;
      return json({ ok: true, user: { user_id: 1, display_name: 'テスト管理者', roles: ['admin'], permissions: ['companies', 'partners', 'users'] } });
    }
    if (url.pathname === '/api/dashboard/summary') return json({ ok: true, cards: [] });
    if (url.pathname === '/api/masters/codes') return json({ ok: true, codes: [] });
    if (url.pathname === '/api/companies') return json({ ok: true, companies: [] });
    if (url.pathname === '/api/partners') return json({ ok: true, partners: [] });
    if (url.pathname === '/api/users') return json({ ok: true, users: [] });
    return json({ ok: true });
  });
  try {
    const started = Date.now();
    await page.goto(base);
    await page.locator('#login-form').waitFor({ timeout: 3000 });
    assert.ok(Date.now() - started < 3000, '機能ファイルの障害でログインを待たせない');
    assert.equal(companyRequests, 0, 'ログイン前は企業スクリプトを要求しない');
    await page.locator('#login_id').fill('test');
    await page.locator('#password').fill('test');
    await page.locator('#login-form button[type=submit]').click();
    await page.locator('[data-nav-feature="companies"]').click();
    await page.locator('#retry-feature').waitFor();
    assert.ok((await page.locator('[role=alert]').innerText()).includes('取得できません'));
    assert.ok(!(await page.locator('body').innerText()).includes('準備中'));
    failCompany = false;
    await page.locator('#retry-feature').click();
    await page.locator('#shared-data-table').waitFor();
    assert.equal(companyRequests, 2, '失敗後に再取得する');
    await page.locator('[data-nav-feature="partners"]').click();
    await page.locator('#shared-data-table').waitFor();
    assert.match(await page.locator('.topbar-page-title').textContent(), /パートナー/);
    await page.locator('[data-nav-feature="companies"]').click();
    await page.locator('#shared-data-table').waitFor();
    assert.equal(companyRequests, 2, '成功したスクリプトは再取得しない');
    await page.locator('[data-nav-feature="users"]').click();
    await page.locator('#new-user-btn').waitFor();
    // 集計が停止していてもメニューから移動でき、遅い応答で画面を上書きしない。
    let finishDashboard;
    await page.route('**/api/dashboard/summary*', (route) => {
      finishDashboard = () => route.fulfill({ json: { ok: true, cards: [] } });
    });
    await page.locator('[data-nav-home]').first().click();
    await page.locator('.loading-panel').waitFor();
    await page.locator('[data-nav-feature="companies"]').click();
    await page.locator('#shared-data-table').waitFor();
    await finishDashboard();
    await page.waitForLoadState('networkidle');
    assert.match(await page.locator('.topbar-page-title').textContent(), /企業/);
    await page.unroute('**/api/dashboard/summary*');

    // 応答が来ないスクリプトも8秒で再試行可能な画面に切り替える。
    await page.unroute('**/js/companies.js*');
    let stalled;
    await page.route('**/js/companies.js*', (route) => { stalled = route; });
    await page.reload();
    await page.locator('[data-nav-feature="companies"]').click();
    await page.locator('#retry-feature').waitFor({ timeout: 10000 });
    assert.match(await page.locator('[role=alert]').innerText(), /タイムアウト/);
    await stalled.abort();
    await page.unroute('**/js/companies.js*');
    await page.locator('#retry-feature').click();
    await page.locator('#shared-data-table').waitFor();
    assert.deepEqual(errors, []);
    console.log('[screen-loading] ログイン独立、取得失敗・タイムアウト・再試行、集計停止中の画面遷移、企業・パートナー・ユーザー画面を確認');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exit(1); });

