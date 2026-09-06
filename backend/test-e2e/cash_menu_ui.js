const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');

async function withMockedApp(run) {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../../frontend')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../../frontend/index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  });
  try {
    await withMockedApp(async (baseUrl) => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        let body = { ok: true };
        if (url.pathname === '/api/auth/me') {
          body = {
            ok: true,
            user: { user_id: 1, display_name: '管理者', roles: ['admin'], permissions: ['advances', 'invoices', 'payments'] },
            features: [
              { key: 'advances', label: '先払い', group: 'billing' },
              { key: 'invoices', label: '請求', group: 'billing' },
              { key: 'payments', label: '支払', group: 'billing' },
            ],
            roles: [{ key: 'admin', label: '管理者' }],
          };
        } else if (url.pathname === '/api/dashboard/summary') body = { ok: true, cards: [] };
        else if (url.pathname === '/api/lookups/companies' || url.pathname === '/api/lookups/partners') body = { ok: true, companies: [], partners: [] };
        else if (url.pathname === '/api/advances/matrix') {
          body = {
            ok: true,
            target_year_month: '2026-09',
            groups: [],
            projects: [],
            summary: { project_count: 0, advance_count: 0, advance_amount: 0, transfer_fee_amount: 0, cycles: [] },
            visible_project_count: 0,
          };
        } else if (url.pathname.startsWith('/api/cash-management/')) {
          body = { ok: true, cycles: [], schedules: [], batches: [], accounts: [], holiday_dates: [] };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      const billingLabels = await page.locator('.sidebar-group').filter({ hasText: '精算' }).locator('.sidebar-text').allTextContents();
      assert.deepEqual(billingLabels, ['先払い', '請求', '支払', '入出金管理・FB出力']);
      await page.locator('[data-nav-feature="advances"]').click();
      await page.locator('#open-cash').waitFor();
      await page.locator('#open-cash').click();
      await page.locator('.cash-screen').waitFor();
      assert.equal(await page.locator('.topbar-page-title').innerText(), '入出金管理・FB出力');
      await page.close();
    });
  } finally {
    await browser.close();
  }
  console.log('[cash-menu] 精算メニューと先払からの遷移を確認しました');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[cash-menu] failed:', error);
    process.exit(1);
  });
