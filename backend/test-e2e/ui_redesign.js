const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApp } = require('../src/server');

let baseUrl = process.env.UI_BASE_URL || '';
const outputDir = path.resolve(__dirname, '../test-results/ui-redesign');

async function login(page) {
  await page.goto(baseUrl, { waitUntil:'networkidle' });
  await page.locator('#login_id').fill(process.env.ADMIN_LOGIN_ID || 'admin');
  await page.locator('#password').fill(process.env.ADMIN_PASSWORD || 'admin1234');
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('.app-sidebar').waitFor();
}

async function assertNoPageOverflow(page, viewport, label) {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(widths.document <= viewport.width + 1, `${label}でページ全体が横にはみ出さないこと`);
  assert.ok(widths.body <= viewport.width + 1, `${label}でbodyが横にはみ出さないこと`);
  assert.ok(widths.client <= viewport.width + 1, `${label}で表示領域を超えないこと`);
}

async function assertCompactHeader(page, viewport, expectedTitle) {
  const layout = await page.evaluate(() => {
    const header = document.querySelector('.app-topbar');
    const visible = (selector) => {
      const element = document.querySelector(selector);
      if (!element || getComputedStyle(element).display === 'none') return null;
      const rect = element.getBoundingClientRect();
      return { top:rect.top, bottom:rect.bottom };
    };
    return {
      headerHeight:header?.getBoundingClientRect().height || 0,
      flexWrap:header ? getComputedStyle(header).flexWrap : '',
      toggle:visible('.sidebar-toggle'),
      system:visible('.topbar-context'),
      title:visible('.topbar-page-title'),
      user:visible('.app-topbar .user-pill'),
      logout:visible('#logout-btn'),
      bodyTitles:document.querySelectorAll('.page-header-row .page-title').length,
    };
  });
  const heightLimit = viewport.width <= 760 ? 56.5 : 58.5;
  assert.ok(layout.headerHeight <= heightLimit, `${viewport.width}pxでヘッダー高を固定すること`);
  assert.equal(layout.flexWrap, 'nowrap', 'ヘッダーを折り返さないこと');
  assert.equal(await page.locator('.topbar-page-title').textContent(), expectedTitle);
  assert.equal(layout.bodyTitles, 0, '本文に画面タイトルを重複表示しないこと');
  assert.ok(layout.toggle && layout.title && layout.logout, '主要ヘッダー要素を表示すること');
  for (const item of [layout.toggle, layout.title, layout.logout, layout.system, layout.user].filter(Boolean)) {
    assert.ok(item.top >= -0.5 && item.bottom <= layout.headerHeight + 0.5, '各要素をヘッダー1行内に収めること');
  }
  assert.equal(Boolean(layout.system), viewport.width > 760, 'スマホではシステム名を省略すること');
  assert.equal(Boolean(layout.user), viewport.width > 520, '520px以下では利用者名を省略すること');
}

async function openFeature(page, featureKey, isMobile) {
  if (isMobile) {
    await page.locator('#sidebar-toggle').click();
    await page.locator('.app-shell.mobile-menu-open').waitFor();
  }
  await page.locator(`[data-nav-feature="${featureKey}"]`).click();
  await page.locator('.app-main').waitFor();
  if (isMobile) {
    assert.equal(await page.locator('.app-shell.mobile-menu-open').count(), 0, '画面遷移後にスマホメニューが閉じること');
  }
}

async function inspectViewport(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await login(page);
  const suffix = `${viewport.width}x${viewport.height}`;
  const isMobile = viewport.width <= 760;
  const shellWidth = await page.locator('.app-shell').evaluate((node) => node.getBoundingClientRect().width);
  assert.ok(shellWidth <= viewport.width && shellWidth >= viewport.width - 2, '共通シェルが画面幅を利用すること');
  assert.equal(await page.locator('.app-sidebar').count(), 1, 'サイドバーを表示すること');
  assert.equal(await page.locator('.dashboard-main').count(), 1, '業務ダッシュボードを表示すること');
  await assertCompactHeader(page, viewport, '業務ダッシュボード');
  if (!isMobile && viewport.width <= 1366) {
    assert.ok(await page.locator('.app-shell').evaluate((node) => node.classList.contains('sidebar-collapsed')), '1366px以下ではサイドバーを折り畳むこと');
  }
  await assertNoPageOverflow(page, viewport, 'ホーム');

  if (isMobile) {
    assert.equal(await page.locator('.app-shell.sidebar-collapsed').count(), 0, 'スマホ表示でPC用折り畳み状態を使わないこと');
    assert.equal(await page.locator('.app-shell.mobile-menu-open').count(), 0, 'スマホメニューが初期状態で閉じていること');
    assert.equal(await page.locator('.app-sidebar').getAttribute('inert'), '', '閉じたスマホメニューをキーボード操作対象から外すこと');
    await page.locator('#sidebar-toggle').click();
    await page.locator('.app-shell.mobile-menu-open').waitFor();
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'true', 'メニュー展開状態を通知すること');
    assert.equal(await page.locator('.app-sidebar').getAttribute('inert'), null, '開いたスマホメニューを操作可能にすること');
    await page.waitForFunction(() => document.querySelector('.app-sidebar')?.getBoundingClientRect().left >= -1);
    const sidebarLeft = await page.locator('.app-sidebar').evaluate((node) => node.getBoundingClientRect().left);
    assert.ok(sidebarLeft >= -1, 'スマホメニューが画面内へ表示されること');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.app-shell.mobile-menu-open').count(), 0, 'Escキーでスマホメニューが閉じること');
    assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false', 'メニュー閉鎖状態を通知すること');
    await page.locator('#sidebar-toggle').click();
    await page.locator('#sidebar-backdrop').click({ position:{ x:viewport.width - 8, y:20 } });
    assert.equal(await page.locator('.app-shell.mobile-menu-open').count(), 0, '背景操作でスマホメニューが閉じること');
  }
  await page.screenshot({ path:path.join(outputDir, `dashboard-${suffix}.png`), fullPage:true });

  const daily = page.locator('[data-nav-feature="daily_reports"]');
  if (await daily.count()) {
    await openFeature(page, 'daily_reports', isMobile);
    assert.equal(await page.locator('.app-sidebar').count(), 1, '業務画面でもサイドバーを維持すること');
    await assertCompactHeader(page, viewport, '日報管理');
    await assertNoPageOverflow(page, viewport, '日報画面');
    await page.screenshot({ path:path.join(outputDir, `daily-reports-${suffix}.png`), fullPage:true });
  }

  const companies = page.locator('[data-nav-feature="companies"]');
  if (!isMobile && await companies.count()) {
    await openFeature(page, 'companies', false);
    await page.locator('#shared-data-table').waitFor();
    assert.equal(await page.locator('#shared-data-table thead tr').count(), 2, '企業一覧に列別フィルターを表示すること');
    const firstRow = page.locator('#shared-data-table tbody tr[data-row-key]').first();
    if (await firstRow.count()) {
      await firstRow.click();
      assert.equal(await firstRow.getAttribute('aria-selected'), 'true', 'クリックした企業行を選択表示すること');
      await firstRow.dblclick();
      await page.locator('#company-form').waitFor();
      assert.ok(await page.locator('#company-form .form-section-card').count() >= 4, '企業編集をカテゴリ別カードで表示すること');
    } else {
      await page.locator('#company-new').click();
      await page.locator('#company-form').waitFor();
    }
    await assertNoPageOverflow(page, viewport, '企業編集画面');
  }

  const projects = page.locator('[data-nav-feature="projects"]');
  if (!isMobile && await projects.count()) {
    await openFeature(page, 'projects', false);
    await page.locator('#projects-table').waitFor();
    assert.equal(await page.locator('#projects-table th').filter({hasText:'締日'}).count() > 0, true, '個別案件一覧に締日を表示すること');
    await page.locator('#new-project').click();
    await page.locator('#project-form').waitFor();
    assert.equal(await page.locator('#vehicle-owner-type').count(), 1, '個別案件で車両所有元を選べること');
    assert.ok(await page.locator('#project-form .search-select').count() >= 4, '個別案件の参照項目を検索選択にすること');
    await assertNoPageOverflow(page, viewport, '個別案件編集画面');
  }

  if (isMobile && await page.locator('[data-nav-feature="payments"]').count()) {
    await openFeature(page, 'payments', true);
    await page.locator('.settlement-filters').waitFor();
    const layout = await page.evaluate(() => ({
      mainWidth: document.querySelector('.app-main')?.getBoundingClientRect().width || 0,
      filterWidth: document.querySelector('.settlement-filters input')?.getBoundingClientRect().width || 0,
      monthControls: [...document.querySelectorAll('.month-navigator > *')].map((node) => {
        const rect = node.getBoundingClientRect();
        return { width:rect.width, height:rect.height };
      }),
    }));
    assert.ok(layout.mainWidth >= viewport.width - 2, '支払画面の本文がスマホ幅を利用すること');
    assert.ok(layout.filterWidth >= viewport.width - 60, '検索欄がスマホ幅を利用すること');
    assert.ok(layout.monthControls.every((control) => control.width >= 100 && control.height <= 52), '月選択を横書き可能な2列へ配置すること');
    await assertNoPageOverflow(page, viewport, '支払画面');
    await page.screenshot({ path:path.join(outputDir, `payments-${suffix}.png`), fullPage:true });
  }

  const masterSettings = page.locator('[data-nav-feature="master_settings"]');
  if (!isMobile && await masterSettings.count()) {
    await openFeature(page, 'master_settings', false);
    await page.locator('[data-hub="settings"]').click();
    await page.locator('#document-logo-uploader').waitFor();
    const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+XK6mAAAAAElFTkSuQmCC', 'base64');
    await page.locator('#document-logo-file').setInputFiles({ name:'company-logo.png', mimeType:'image/png', buffer:transparentPng });
    await page.locator('#document-logo-preview:not([hidden])').waitFor();
    assert.ok((await page.locator('#document-logo-preview').getAttribute('src'))?.startsWith('data:image/png;base64,'), '会社ロゴを選択してプレビューできること');
  }
  await page.close();
}

async function main() {
  await fs.mkdir(outputDir, { recursive:true });
  let server = null;
  if (!baseUrl) {
    server = (await createApp()).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }
  const browser = await chromium.launch({
    headless:true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel:process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  try {
    await inspectViewport(browser, { width:1920, height:1080 });
    await inspectViewport(browser, { width:1366, height:768 });
    await inspectViewport(browser, { width:1200, height:600 });
    await inspectViewport(browser, { width:430, height:932 });
    await inspectViewport(browser, { width:390, height:844 });
  } finally {
    await browser.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('[ui-redesign] 1920x1080 / 1366x768 / 1200x600 / 430x932 / 390x844 の共通シェルを確認しました');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[ui-redesign] failed:', error);
    process.exit(1);
  });
