const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('請求先Noは企業内0始まりで採番され案件から選択できる', () => {
  const migration = read('db/migrations/030_billing_numbers_settlement_drafts_status_colors.sql');
  const workflowMigration = read('db/migrations/032_billing_consolidation_and_closing_workflow.sql');
  const companies = read('backend/src/routes/companies.js');
  const projects = read('backend/src/routes/projects.js');
  const projectUi = read('frontend/js/projects.js');
  const verificationSeed = read('backend/scripts/seed_verification_data.js');
  assert.match(migration, /UNIQUE KEY uq_company_billings_company_no \(company_id, billing_no\)/);
  assert.match(migration, /ADD COLUMN billing_id BIGINT UNSIGNED NULL/);
  assert.match(workflowMigration, /next_billing_no/);
  assert.match(companies, /numberRows\.length[\s\S]*: 0/);
  assert.match(projects, /選択した請求先が案件の企業に属していません/);
  assert.match(projectUi, /<label>請求先No<\/label>/);
  assert.match(workflowMigration, /billing_no=0/);
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

test('取りまとめ請求・統合承認・発行無効履歴を保持する', () => {
  const migration = read('db/migrations/032_billing_consolidation_and_closing_workflow.sql');
  const settlements = read('backend/src/routes/settlements.js');
  const dailyReports = read('backend/src/routes/daily_reports.js');
  const invoiceUi = read('frontend/js/invoices.js');
  assert.match(migration, /CREATE TABLE invoice_consolidation_sources/);
  assert.match(migration, /uq_active_invoice_consolidation_source/);
  assert.match(migration, /CREATE TABLE monthly_closing_workflows/);
  assert.match(migration, /CREATE TABLE settlement_invalidation_requests/);
  assert.match(settlements, /invoice\/consolidations/);
  assert.match(settlements, /status='invalidated'/);
  assert.match(dailyReports, /monthly_closing_reviewers/);
  assert.match(dailyReports, /pending_reviewer_count/);
  assert.match(invoiceUi, /consolidateSelected/);
});

test('ダブルタップと入力中の局所計算を提供する', () => {
  const baseManagement = read('frontend/js/base_management.js');
  const dataTable = read('frontend/js/data-table.js');
  const invoices = read('frontend/js/invoices.js');
  assert.match(baseManagement, /pointerType === 'mouse'/);
  assert.match(baseManagement, /now-previous>350/);
  assert.match(dataTable, /pointerup/);
  assert.match(invoices, /amount\.value=String/);
  assert.doesNotMatch(invoices, /addEventListener\('input'.*this\.detail/);
});

test('契約終了の通常除外・共通ヘルプ・相手先別帳票番号を追加する', () => {
  const migration = read('db/migrations/031_contract_lifecycle_and_help.sql');
  const appUi = read('frontend/js/app.js');
  assert.match(migration, /contract_status_code/);
  assert.match(migration, /operation_end_date/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS help_contents/);
  assert.match(migration, /settlement_counterparty_sequences/);
  assert.match(read('backend/src/routes/companies.js'), /include_ended/);
  assert.match(read('backend/src/routes/partners.js'), /include_ended/);
  assert.match(read('backend/src/routes/projects.js'), /include_ended/);
  assert.match(appUi, /id="header-back"/);
  assert.match(appUi, /id="screen-help"/);
  assert.match(appUi, /enhanceActionAreas/);
  assert.match(appUi, /enhanceNumberInputs/);
});

test('未完了の日報再反映と請求先No一覧を維持する', () => {
  const settlements = read('backend/src/routes/settlements.js');
  const invoiceUi = read('frontend/js/invoices.js');
  const dataTable = read('frontend/js/data-table.js');
  assert.match(settlements, /includeCurrent=false/);
  assert.match(settlements, /currentAggregateForSettlement\(conn,kind,id,headers\[0\]\.target_year_month,true\)/);
  assert.match(settlements, /currentAggregateForSettlement\(conn,kind,id,headers\[0\]\.target_year_month\);/);
  assert.match(invoiceUi, /data-col="billing_no">請求先No/);
  assert.match(dataTable, /compositionstart/);
  assert.match(dataTable, /compositionend/);
});
