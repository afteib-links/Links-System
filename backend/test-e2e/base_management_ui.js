const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');
const { chromium } = require('playwright');

async function main() {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../../frontend')));
  app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../../frontend/index.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let body = { ok: true };
      if (pathname === '/api/auth/me') {
        body = {
          ok: true,
          user: { user_id: 1, display_name: '管理者', roles: ['admin'], permissions: ['base_management'] },
          features: [{ key: 'base_management', label: '基本管理', group: 'master' }],
          roles: [{ key: 'admin', label: '管理者' }],
        };
      } else if (pathname === '/api/dashboard/summary') body = { ok: true, cards: [] };
      else if (pathname === '/api/base-management') {
        body = {
          ok: true,
          companies: [
            { company_id: 1, office_no: 'C001', company_name: '企業A', company_name_kana: 'キギョウエー', closing_date_code: 'end', payment_date_code: 'end' },
            { company_id: 2, office_no: 'C002', company_name: '企業B', closing_date_code: '15' },
            ...Array.from({ length: 28 }, (_, index) => ({
              company_id: index + 3,
              office_no: `C${String(index + 3).padStart(3, '0')}`,
              company_name: `企業${String(index + 3).padStart(2, '0')}`,
              closing_date_code: 'end',
            })),
          ],
          base_projects: [{ base_project_id: 11, company_id: 1, template_name: '定期便', closing_date: 'end' }],
          projects: [{ project_id: 21, base_project_id: 11, company_id: 1, partner_id: 31, partner_name: 'パートナーA', closing_date: 'end' }],
          price_sets: [{ price_set_id: 41, price_set_no: 'PS-001', price_set_name: '通常料金', company_id: 1, project_id: 21, apply_start_date: '2026-09-01', line_count: 3, billing_unit_total: 75000, payment_unit_total: 60000 }],
        };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page.locator('[data-nav-feature="base_management"]').click();
    await page.locator('.bm-screen').waitFor();
    const initialScreen = await page.locator('.bm-screen').elementHandle();
    assert.equal(await page.locator('.bm-heads .bm-column-title').count(), 4);
    await page.setViewportSize({ width: 600, height: 800 });
    const companyScroll = await page.locator('[data-list="company"]').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    assert.ok(companyScroll.scrollHeight > companyScroll.clientHeight, 'スマホで企業一覧に縦スクロールが必要');
    assert.ok(companyScroll.scrollTop > 0, 'スマホで企業一覧を最下部まで縦スクロールできる');
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.locator('[data-list="company"] [data-id="1"]').click();
    await page.locator('[data-list="base"] [data-id="11"]').click();
    await page.locator('[data-list="project"] [data-id="21"]').click();
    await page.locator('[data-list="price"] [data-id="41"]').click();
    await page.getByText('請求単価合計').waitFor();
    assert.match(await page.locator('#bm-preview-body').innerText(), /通常料金/);
    assert.match(await page.locator('#bm-preview-body').innerText(), /￥75,000/);
    assert.equal(await initialScreen.evaluate((element) => element.isConnected), true, '項目選択で画面全体を再描画しない');
    await page.setViewportSize({ width: 1600, height: 700 });
    const previewOverflow = await page.locator('#bm-preview-body').evaluate((element) => element.scrollHeight > element.clientHeight);
    assert.equal(previewOverflow, true, '詳細プレビュー本文だけを縦スクロールできる');
    await page.locator('[data-all="company"]').click();
    await page.locator('.bm-all-table').waitFor();
    assert.match(await page.locator('.bm-all-table').innerText(), /基本案件なし/);
    assert.match(await page.locator('.bm-all-table').innerText(), /通常料金/);
    await page.setViewportSize({ width: 900, height: 800 });
    const allScroll = await page.locator('.bm-all-wrap').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    assert.ok(allScroll.scrollHeight > allScroll.clientHeight, 'タブレットの全対象一覧に縦スクロールが必要');
    assert.ok(allScroll.scrollTop > 0, 'タブレットで全対象一覧を最下部まで縦スクロールできる');
    await page.setViewportSize({ width: 1200, height: 800 });
    const overflow = await page.locator('.bm-screen').evaluate((element) => element.scrollWidth > element.clientWidth);
    assert.equal(overflow, true, '狭い画面ではミラーカラム全体を横スクロールできる');
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('[base-management-ui] 基本管理の順次選択と全対象表示を確認しました');
}

main().catch((error) => {
  console.error('[base-management-ui] failed:', error);
  process.exit(1);
});
