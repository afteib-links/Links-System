#!/usr/bin/env node
/**
 * Capture live SPA screenshots for docs/manual/.
 * Usage: UI_BASE_URL=http://127.0.0.1:3000 node scripts/capture_manual_screens.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.UI_BASE_URL || 'http://127.0.0.1:3000';
const OUT = path.resolve(__dirname, '../../docs/manual/screenshots');
const YM = process.env.MANUAL_YM || '2026-08';
const LOGIN_ID = process.env.ADMIN_LOGIN_ID || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

async function waitMain(page) {
  await page.locator('.app-main').waitFor({ timeout: 20000 });
  await page.waitForTimeout(350);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log('wrote', path.basename(file));
}

async function openFeature(page, key) {
  const toggle = page.locator('#sidebar-toggle');
  if (await page.locator('.app-shell.sidebar-collapsed').count()) {
    await toggle.click();
    await page.waitForTimeout(200);
  }
  await page.locator(`[data-nav-feature="${key}"]`).click();
  await waitMain(page);
}

async function setMonth(page, prefix) {
  const input = page.locator(`#${prefix}-value`);
  if (!(await input.count())) return;
  await input.fill(YM);
  await page.locator(`#${prefix}-load`).click();
  await waitMain(page);
}

async function clickFirst(page, selector) {
  const loc = page.locator(selector).first();
  if (await loc.count()) {
    await loc.click();
    await waitMain(page);
    return true;
  }
  return false;
}

async function login(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('#login_id').fill(LOGIN_ID);
  await page.locator('#password').fill(PASSWORD);
  await shot(page, '01_login');
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('.app-sidebar').waitFor({ timeout: 20000 });
  await waitMain(page);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);

  await login(page);
  await shot(page, '02_home');

  await openFeature(page, 'companies');
  await shot(page, '03_companies_list');
  if (await clickFirst(page, '[data-edit]')) await shot(page, '04_companies_detail');

  await openFeature(page, 'partners');
  await shot(page, '05_partners_list');
  if (await clickFirst(page, '[data-edit]')) await shot(page, '06_partners_detail');

  await openFeature(page, 'base_projects');
  await shot(page, '07_base_projects_list');
  if (await clickFirst(page, '[data-edit-base]')) await shot(page, '08_base_projects_detail');

  await openFeature(page, 'projects');
  await shot(page, '09_projects_list');
  if (await clickFirst(page, '[data-edit]')) await shot(page, '10_projects_detail');

  await openFeature(page, 'price_sets');
  await shot(page, '11_price_sets_list');
  if (await clickFirst(page, '[data-edit], [data-edit-ps]')) await shot(page, '12_price_sets_detail');

  await openFeature(page, 'daily_reports');
  await setMonth(page, 'daily-month');
  await shot(page, '13_daily_list');
  if (await clickFirst(page, '[data-input]')) await shot(page, '14_daily_grid');
  await openFeature(page, 'daily_reports');
  await setMonth(page, 'daily-month');
  if (await page.locator('#open-daily-import').count()) {
    await page.locator('#open-daily-import').click();
    await waitMain(page);
    await shot(page, '15_daily_import');
  }

  await openFeature(page, 'advances');
  await setMonth(page, 'advance-month');
  await shot(page, '16_advances');

  await openFeature(page, 'invoices');
  await setMonth(page, 'invoice-month');
  await shot(page, '17_invoices_list');
  if (await clickFirst(page, '[data-open]')) await shot(page, '18_invoices_detail');

  await openFeature(page, 'payments');
  await setMonth(page, 'payment-month');
  await shot(page, '19_payments_list');
  if (await clickFirst(page, '[data-open]')) await shot(page, '20_payments_detail');

  await openFeature(page, 'cash_management');
  await setMonth(page, 'cash-month');
  await shot(page, '21_cash_management');

  await openFeature(page, 'master_settings');
  await shot(page, '22_master_settings_hub');
  if (await page.locator('[data-hub="settings"]').count()) {
    await page.locator('[data-hub="settings"]').click();
    await waitMain(page);
    await shot(page, '23_master_settings_system');
  }

  await openFeature(page, 'ui_builder');
  await shot(page, '24_ui_builder');

  await openFeature(page, 'users');
  await shot(page, '25_users');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
