const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('請求先Noは企業内採番され案件から選択できる', () => {
  const migration = read('db/migrations/030_billing_numbers_settlement_drafts_status_colors.sql');
  const companies = read('backend/src/routes/companies.js');
  const projects = read('backend/src/routes/projects.js');
  const projectUi = read('frontend/js/projects.js');
  const verificationSeed = read('backend/scripts/seed_verification_data.js');
  assert.match(migration, /UNIQUE KEY uq_company_billings_company_no \(company_id, billing_no\)/);
  assert.match(migration, /ADD COLUMN billing_id BIGINT UNSIGNED NULL/);
  assert.match(companies, /Math\.max\(max, Number\(row\.billing_no \|\| 0\)\)/);
  assert.match(projects, /選択した請求先が案件の企業に属していません/);
  assert.match(projectUi, /<label>請求先No<\/label>/);
  assert.match(verificationSeed, /billing_no: 1/);
  assert.match(verificationSeed, /billing_id: company\.billingId/);
  assert.match(verificationSeed, /settlement_projects/);
  assert.match(verificationSeed, /repairIssue100Data/);
  assert.match(verificationSeed, /detachExternalDerivedProjects/);
  assert.match(verificationSeed, /VERIFICATION_DETACH_CONFIRM/);
});

test('日報未完了でも案件を保持した精算下書きを作れる', () => {
  const settlements = read('backend/src/routes/settlements.js');
  const invoiceUi = read('frontend/js/invoices.js');
  const paymentUi = read('frontend/js/payments.js');
  assert.match(settlements, /requestedProjectIds/);
  assert.match(settlements, /const reports = ids\.length \?/);
  assert.match(settlements, /INSERT INTO settlement_projects/);
  assert.match(settlements, /日報との差分が残っています/);
  assert.match(settlements, /syncOnly=Boolean\(req\.body\?\.sync_only\)/);
  assert.match(invoiceUi, /project_ids:projectIds/);
  assert.match(paymentUi, /project_ids:projectIds/);
});

test('見本PDF・明細追加・状態色・スマホ操作を実データUIへ接続する', () => {
  const settlements = read('backend/src/routes/settlements.js');
  const invoiceUi = read('frontend/js/invoices.js');
  const settingsUi = read('frontend/js/master_settings.js');
  const projectUi = read('frontend/js/projects.js');
  const css = read('frontend/css/styles.css');
  assert.match(settlements, /previewTaxable/);
  assert.match(settlements, /total_amount:previewTotal/);
  assert.match(invoiceUi, /data-line-row="new"/);
  assert.match(invoiceUi, /data-create-line/);
  assert.match(settingsUi, /STATUS_COLOR_SETTINGS/);
  assert.match(read('frontend/js/feature-kit.js'), /available:\['working'/);
  assert.match(projectUi, /data-project-actions/);
  assert.match(projectUi, /data-base-actions/);
  assert.match(css, /\.analytics-screen \.check-row input\[type="checkbox"\]/);
});
