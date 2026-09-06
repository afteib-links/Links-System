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
            user: { user_id: 1, display_name: '管理者', roles: ['admin'], permissions: ['analytics'] },
            features: [{ key: 'analytics', label: '収支分析', group: 'analysis' }],
            roles: [{ key: 'admin', label: '管理者' }],
          };
        } else if (url.pathname === '/api/dashboard/summary') body = { ok: true, cards: [] };
        else if (url.pathname === '/api/analytics/meta') {
          body = { ok: true, areas: ['関東'], staff: [{ staff_master_id: 1, staff_name: '佐藤', area_name: '関東' }], companies: [], months: ['2026-08'], profit_warning_percent: 10 };
        } else if (url.pathname === '/api/analytics/pl') {
          body = {
            ok: true,
            ym: '2026-08',
            profit_warning_percent: 10,
            areas: [{
              area_name: '関東',
              totals: { sales: 100, pay: 70, bill: 100, pay_bill: 70, tax: 10, days: 5, profit: 30, profit_rate: 30 },
              staffs: [{
                staff_id: '1',
                staff_name: '佐藤',
                totals: { sales: 100, pay: 70, bill: 100, pay_bill: 70, tax: 10, days: 5, profit: 30, profit_rate: 30 },
                companies: [{
                  company_no: '101',
                  company_name: 'ABC',
                  sales: 100, pay: 70, bill: 120, pay_bill: 70, tax: 12, days: 5, profit: 30, profit_rate: 30, invoice_diff: true,
                  partners: [{ partner_name: '山田', kubun: '外注', sales: 100, pay: 70, bill: 100, pay_bill: 70, days: 5, profit: 30, profit_rate: 30 }],
                }],
              }],
            }],
          };
        } else if (url.pathname === '/api/analytics/margin') {
          body = { ok: true, profit_warning_percent: 10, months: ['2026-08'], rows: [{ area_name: '関東', staff_name: '佐藤', company_no: '101', company_name: 'ABC', rates: [9.5] }] };
        } else if (url.pathname === '/api/analytics/days') {
          body = { ok: true, months: ['2026-08'], rows: [{ area_name: '関東', staff_name: '佐藤', company_no: '101', company_name: 'ABC', partner_name: '山田', days: [22] }] };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.locator('[data-nav-feature="analytics"]').click();
      await page.locator('.analytics-screen').waitFor();
      assert.equal(await page.locator('.topbar-page-title').innerText(), '収支分析');
      assert.match(await page.locator('.analytics-screen').innerText(), /請求書合計を使用/);
      await page.locator('[data-tab="margin"]').click();
      const rateCell = page.locator('td.neg', { hasText: '9.5%' });
      await rateCell.waitFor();
      const colorInfo = await rateCell.evaluate((el) => {
        const color = getComputedStyle(el).color;
        const nums = (color.match(/[\d.]+/g) || []).map(Number);
        const scale = nums[0] <= 1 && nums[1] <= 1 && nums[2] <= 1 ? 255 : 1;
        return { color, className: el.className, r: (nums[0] || 0) * scale, g: (nums[1] || 0) * scale, b: (nums[2] || 0) * scale };
      });
      assert.match(colorInfo.className, /\bneg\b/);
      assert.ok(colorInfo.r > colorInfo.g && colorInfo.r > colorInfo.b, `利益率警告の赤表示が必要: ${colorInfo.color}`);
      await page.locator('[data-tab="days"]').click();
      await page.getByText('22日').waitFor();
      await page.close();
    });
  } finally {
    await browser.close();
  }
  console.log('[analytics-ui] 収支分析3タブの表示を確認しました');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[analytics-ui] failed:', error);
    process.exit(1);
  });
