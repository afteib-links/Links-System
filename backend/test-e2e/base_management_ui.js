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
            { company_id: 1, office_no: 'C001', company_name: 'あおば運輸', company_name_kana: 'アオバウンユ', closing_date_code: 'end', payment_date_code: 'end' },
            { company_id: 2, office_no: 'C002', company_name: 'かもめ運送', company_name_kana: 'カモメウンソウ', closing_date_code: '15' },
            ...Array.from({ length: 28 }, (_, index) => ({
              company_id: index + 3,
              office_no: `C${String(index + 3).padStart(3, '0')}`,
              company_name: `企業${String(index + 3).padStart(2, '0')}`,
              closing_date_code: 'end',
            })),
          ],
          base_projects: [
            { base_project_id: 11, company_id: 1, template_name: '定期便', closing_date: 'end' },
            { base_project_id: 12, company_id: 1, template_name: '新規候補', closing_date: 'end' },
          ],
          projects: [
            { project_id: 21, base_project_id: 11, company_id: 1, partner_id: 31, partner_name: 'パートナーA', closing_date: 'end' },
            { project_id: 22, base_project_id: 11, company_id: 1, partner_id: 32, partner_name: 'パートナーB', closing_date: 'end' },
          ],
          price_sets: [{ price_set_id: 41, price_set_no: 'PS-001', price_set_name: '通常料金', company_id: 1, project_id: 21, apply_start_date: '2026-09-01', line_count: 3, billing_unit_total: 75000, payment_unit_total: 60000 }],
        };
      } else if (/^\/api\/projects\/base\/\d+\/create-project$/.test(pathname)) {
        body = { ok: true, project: { project_id: 99 }, copied_price_set_count: 1 };
      } else if (pathname === '/api/projects/21/copy') {
        body = { ok: true, project: { project_id: 100 }, copied_price_set_count: 1 };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page.locator('[data-nav-feature="base_management"]').click();
    await page.locator('.bm-screen').waitFor();
    let initialScreen;
    assert.equal(await page.locator('.bm-heads .bm-column-title').count(), 4);
    assert.equal(await page.locator('[data-list="company"] [data-id]').count(), 30);
    assert.equal(await page.locator('#bm-company-query').count(), 0, '企業抽出は初期状態で閉じている');
    await page.locator('#bm-filter-toggle').click();
    assert.equal(await page.locator('#bm-filter-toggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#bm-company-query').waitFor();
    const filterBounds = await page.evaluate(() => {
      const header = document.querySelector('.bm-heads').getBoundingClientRect();
      const kana = document.querySelector('.bm-kana-filter').getBoundingClientRect();
      return { headerBottom: header.bottom, kanaBottom: kana.bottom };
    });
    assert.ok(filterBounds.kanaBottom < filterBounds.headerBottom, `五十音ボタンをヘッダー下線より内側に収める: ${JSON.stringify(filterBounds)}`);
    await page.locator('#bm-company-query').evaluate((input) => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { data:'か' }));
      input.value = 'かも';
      input.dispatchEvent(new Event('input', { bubbles:true }));
    });
    await page.waitForTimeout(260);
    assert.equal(await page.locator('[data-list="company"] [data-id]').count(), 30, 'IME変換確定前は一覧を再描画しない');
    await page.locator('#bm-company-query').evaluate((input) => input.dispatchEvent(new CompositionEvent('compositionend', { data:'かも' })));
    await page.waitForTimeout(260);
    assert.equal(await page.locator('[data-list="company"] [data-id="2"]').count(), 1, '日本語IME確定後に企業名・カナを検索する');
    await page.locator('#bm-company-query').fill('');
    await page.waitForTimeout(260);
    await page.locator('#bm-company-closing').selectOption('15');
    assert.equal(await page.locator('[data-list="company"] [data-id]').count(), 1, '締日で企業を絞り込む');
    await page.locator('#bm-company-closing').selectOption('');
    await page.locator('[data-kana-group="a"]').click();
    assert.equal(await page.locator('[data-list="company"] [data-id="1"]').count(), 1, 'あ行で企業を絞り込む');
    await page.locator('[data-kana-group=""]').click();
    initialScreen = await page.locator('.bm-screen').elementHandle();
    await page.setViewportSize({ width: 600, height: 800 });
    const companyScroll = await page.locator('[data-list="company"]').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    assert.ok(companyScroll.scrollHeight > companyScroll.clientHeight, 'スマホで企業一覧に縦スクロールが必要');
    assert.ok(companyScroll.scrollTop > 0, 'スマホで企業一覧を最下部まで縦スクロールできる');
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.evaluate(() => {
      window.__baseManagementCreate = null;
      window.LinksBaseManagement.ctx.openFeature = (feature, options) => { window.__baseManagementCreate = { feature, options }; };
    });
    await page.locator('[data-list="company"] [data-id="2"]').click();
    await page.locator('[data-list="base"] [data-create-type="base"]').click();
    assert.deepEqual(await page.evaluate(() => window.__baseManagementCreate), { feature: 'base_projects', options: { new: true, company_id: 2 } });
    const normalAddSize = await page.locator('[data-list="base"] .bm-add-action').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    await page.locator('[data-list="company"] [data-id="1"]').click();
    await page.locator('[data-list="base"] .bm-add-action').waitFor();
    assert.equal(await page.locator('[data-list="base"] .bm-add-action').count(), 1, '基本案件が存在しても追加できる');
    await page.locator('[data-list="base"] [data-id="11"]').click();
    await page.locator('[data-list="project"] .bm-add-action').waitFor();
    assert.equal(await page.locator('[data-list="project"] .bm-add-action').count(), 1, '個別案件が存在しても追加できる');
    await page.locator('[data-list="project"] .bm-add-action').click();
    await page.waitForFunction(() => window.__baseManagementCreate?.options?.project_id === 99);
    assert.deepEqual(await page.evaluate(() => window.__baseManagementCreate), { feature: 'projects', options: { project_id: 99 } });
    await page.locator('[data-list="base"] [data-id="12"]').click();
    await page.locator('[data-list="project"] [data-create-type="project"][data-base-id="12"]').waitFor();
    await page.locator('[data-list="project"] [data-create-type="project"]').click();
    await page.waitForFunction(() => window.__baseManagementCreate?.options?.project_id === 99);
    assert.deepEqual(await page.evaluate(() => window.__baseManagementCreate), { feature: 'projects', options: { project_id: 99 } });
    await page.locator('[data-list="price"] [data-create-type="price"]').click();
    assert.deepEqual(await page.evaluate(() => window.__baseManagementCreate), { feature: 'price_sets', options: { new_with_owner: true, company_id: 1, base_project_id: 12, project_id: null } });
    await page.locator('[data-list="company"] [data-id="1"]').click();
    await page.locator('[data-list="base"] [data-id="11"]').click();
    await page.locator('[data-list="project"] [data-create-type="project"][data-base-id="11"]').waitFor();
    await page.locator('[data-list="project"] [data-id="22"]').click();
    await page.locator('[data-list="price"] [data-create-type="price"][data-project-id="22"]').waitFor();
    await page.locator('[data-list="price"] [data-create-type="price"][data-project-id="22"]').click();
    assert.deepEqual(await page.evaluate(() => window.__baseManagementCreate), { feature: 'price_sets', options: { new_with_owner: true, company_id: 1, base_project_id: null, project_id: 22 } });
    await page.locator('[data-list="project"] [data-id="21"]').click();
    await page.locator('#bm-preview-body h2').getByText('パートナーA', { exact: true }).waitFor();
    await page.locator('[data-list="price"] .bm-add-action').waitFor();
    assert.equal(await page.locator('[data-list="price"] .bm-add-action').count(), 1, '金額データが存在しても追加できる');
    await page.locator('#bm-preview-body [data-copy-selected]').click();
    await page.waitForFunction(() => window.__baseManagementCreate?.options?.project_id === 100);
    assert.deepEqual(await page.evaluate(() => window.__baseManagementCreate), { feature: 'projects', options: { project_id: 100 } });
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
    const allAddSize = await page.locator('.bm-all-table .bm-empty-action').first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(Math.abs(normalAddSize.width - allAddSize.width) < 1, `通常列と全対象の追加ボタン幅を揃える: ${JSON.stringify({ normalAddSize, allAddSize })}`);
    assert.ok(Math.abs(normalAddSize.height - allAddSize.height) < 1, `通常列と全対象の追加ボタン高を揃える: ${JSON.stringify({ normalAddSize, allAddSize })}`);
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
