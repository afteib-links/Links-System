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

async function inspectViewport(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await login(page);
  const suffix = `${viewport.width}x${viewport.height}`;
  const shellWidth = await page.locator('.app-shell').evaluate((node) => node.getBoundingClientRect().width);
  assert.ok(shellWidth <= viewport.width && shellWidth >= viewport.width - 2, '共通シェルが画面幅を利用すること');
  assert.equal(await page.locator('.app-sidebar').count(), 1, 'サイドバーを表示すること');
  assert.equal(await page.locator('.dashboard-main').count(), 1, '業務ダッシュボードを表示すること');
  if (viewport.width <= 1366) assert.ok(await page.locator('.app-shell').evaluate((node) => node.classList.contains('sidebar-collapsed')), '1366px以下ではサイドバーを折り畳むこと');
  await page.screenshot({ path:path.join(outputDir, `dashboard-${suffix}.png`), fullPage:true });

  const daily = page.locator('[data-nav-feature="daily_reports"]');
  if (await daily.count()) {
    await daily.click();
    await page.locator('.app-main').waitFor();
    assert.equal(await page.locator('.app-sidebar').count(), 1, '業務画面でもサイドバーを維持すること');
    await page.screenshot({ path:path.join(outputDir, `daily-reports-${suffix}.png`), fullPage:true });
  }
  const masterSettings = page.locator('[data-nav-feature="master_settings"]');
  if (await masterSettings.count()) {
    await masterSettings.click();
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
  const browser = await chromium.launch({ headless:true });
  try {
    await inspectViewport(browser, { width:1920, height:1080 });
    await inspectViewport(browser, { width:1366, height:768 });
  } finally {
    await browser.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  console.log('[ui-redesign] 1920x1080 / 1366x768 の共通シェルを確認しました');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[ui-redesign] failed:', error);
    process.exit(1);
  });
