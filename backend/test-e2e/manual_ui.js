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
  'ui_builder', 'users', 'master_data_preparation', 'db_import', 'db_export',
  'master_data_export', 'test_data', 'calculation_rules', 'menu_access_settings',
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
    assert.equal(await desktop.locator('.operation-image').count(), featureKeys.length + 4);
    assert.equal(await desktop.locator('.input-image').count(), featureKeys.length + 4);
    for (const chapter of await desktop.locator('[data-chapter]').all()) {
      assert.equal(await chapter.getByRole('heading', { name: '運用イメージ', exact: true }).count(), 1);
      assert.equal(await chapter.getByRole('heading', { name: '入力イメージ', exact: true }).count(), 1);
      assert.ok(await chapter.locator('.sample-fields samp').count() >= 2);
    }
    for (const key of featureKeys) {
      assert.equal(await desktop.locator(`#${key} .examples section`).count(), 3, `${key}の具体例`);
    }
    await assertNoHorizontalOverflow(desktop, 'PC表示');
    assert.deepEqual(await desktop.locator('a[href^="#"]').evaluateAll((links) => links.map(a => a.getAttribute('href').slice(1)).filter(id => !document.getElementById(id))), [], '章リンク切れ');
    assert.equal(await desktop.locator('figure img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true, '画面画像の読み込み');
    await desktop.getByRole('button', { name: 'DB取込', exact: true }).click();
    assert.match(await desktop.locator('[data-flow-result]').innerText(), /正常行/);

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
    assert.equal(await desktop.locator('#daily_reports .input-image').isVisible(), true);
    assert.equal(await desktop.locator('#daily_reports .operation-image').isVisible(), true);
    assert.equal(await desktop.locator('.manual-footer').isVisible(), false);
    assert.equal(await desktop.locator('#companies').evaluate((node) => getComputedStyle(node).display), 'none');
    await desktop.pdf({ path: path.join(outputDir, 'daily-report-chapter.pdf'), format: 'A4', printBackground: true });
    await desktop.evaluate(() => { document.body.dataset.printScope = 'all'; });
    assert.equal(await desktop.locator('#companies').evaluate((node) => getComputedStyle(node).display), 'block');
    assert.equal(await desktop.locator('#menu_access_settings').evaluate((node) => getComputedStyle(node).display), 'block');
    await desktop.pdf({ path: path.join(outputDir, 'manual-all.pdf'), format: 'A4', printBackground: true });
    await desktop.screenshot({ path: path.join(outputDir, 'manual-print.png'), fullPage: false });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    mobile.on('pageerror', (error) => errors.push(error.message));
    await mobile.goto(base, { waitUntil: 'networkidle' });
    await assertNoHorizontalOverflow(mobile, 'スマートフォン表示');
    assert.equal(await mobile.locator('.start-grid .start-card').count(), 4);
    await mobile.screenshot({ path: path.join(outputDir, 'manual-mobile.png'), fullPage: false });
    await mobile.locator('#daily_reports .input-image').scrollIntoViewIfNeeded();
    await assertNoHorizontalOverflow(mobile, '入力イメージのスマートフォン表示');
    await mobile.screenshot({ path: path.join(outputDir, 'manual-input-mobile.png'), fullPage: false });
    await desktop.emulateMedia({ media: 'screen' });
    await desktop.locator('#daily_reports .input-image').screenshot({ path: path.join(outputDir, 'manual-input-desktop.png') });

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
