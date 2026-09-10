const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');

const manualDir = path.resolve(__dirname, '../../利用マニュアル');
const outputDir = path.resolve(__dirname, '../test-results/manual');
const featureKeys = [
  'base_management', 'companies', 'partners', 'base_projects', 'projects', 'price_sets',
  'office_work', 'daily_reports', 'daily_report_submissions', 'advances', 'invoices',
  'payments', 'cash_management', 'analytics', 'master_settings', 'help_settings',
  'ui_builder', 'users',
];

function localBrowserPath() {
  if (process.env.MANUAL_BROWSER_PATH) return process.env.MANUAL_BROWSER_PATH;
  if (process.platform !== 'win32') return null;
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => fs.existsSync(candidate)) || null;
}

async function assertNoHorizontalOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(sizes.scroll <= sizes.client + 1, `${label}でページ全体が横にはみ出さないこと`);
}

async function main() {
  const app = express();
  app.use('/manual', express.static(manualDir));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const executablePath = localBrowserPath();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  const base = `http://127.0.0.1:${server.address().port}/manual/`;
  const errors = [];
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    desktop.on('pageerror', (error) => errors.push(error.message));
    await desktop.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await desktop.locator('.feature-chapter').count(), featureKeys.length);
    for (const key of featureKeys) {
      assert.equal(await desktop.locator(`#${key} .examples section`).count(), 3, `${key}の具体例`);
    }
    await assertNoHorizontalOverflow(desktop, 'PC表示');

    await desktop.getByRole('button', { name: '企業', exact: true }).click();
    assert.equal(await desktop.locator('[data-flow="companies"]').getAttribute('class'), 'is-selected');
    assert.match(await desktop.locator('[data-flow-result]').innerText(), /関連する機能：基本案件、個別案件、基本管理、請求/);

    await desktop.locator('#base_management figure img').click();
    await desktop.locator('[data-image-dialog][open]').waitFor();
    await desktop.getByRole('button', { name: '画像を閉じる' }).click();

    await desktop.goto(`${base}#daily_reports`);
    assert.equal(await desktop.locator('[data-nav="daily_reports"]').getAttribute('aria-current'), 'page');

    await desktop.emulateMedia({ media: 'print' });
    await desktop.evaluate(() => {
      document.body.dataset.printScope = 'chapter';
      document.querySelectorAll('[data-chapter]').forEach((chapter) => chapter.classList.toggle('print-target', chapter.id === 'daily_reports'));
    });
    assert.equal(await desktop.locator('#daily_reports').evaluate((node) => getComputedStyle(node).display), 'block');
    assert.equal(await desktop.locator('#companies').evaluate((node) => getComputedStyle(node).display), 'none');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    mobile.on('pageerror', (error) => errors.push(error.message));
    await mobile.goto(base, { waitUntil: 'networkidle' });
    await assertNoHorizontalOverflow(mobile, 'スマートフォン表示');
    assert.equal(await mobile.locator('.start-grid .start-card').count(), 4);
    await mobile.screenshot({ path: path.join(outputDir, 'manual-mobile.png'), fullPage: false });

    assert.deepEqual(errors, []);
    console.log('manual UI verified');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

fs.mkdirSync(outputDir, { recursive: true });
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
