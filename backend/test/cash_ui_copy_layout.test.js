const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('案件コピーAPIと一覧操作が仕様どおりつながっている', () => {
  const routes = read('backend/src/routes/projects.js');
  const lifecycle = read('backend/src/services/price_set_lifecycle.js');
  const ui = read('frontend/js/projects.js');
  assert.match(routes, /router\.post\('\/base\/:id\/copy'/);
  assert.match(routes, /router\.post\('\/:id\/copy'/);
  assert.match(routes, /template_name = `\$\{String\(source\.template_name/);
  assert.match(routes, /manager_name = `\$\{String\(source\.manager_name/);
  assert.match(lifecycle, /async function deepCopyPriceSets\(/);
  assert.match(ui, /data-copy-base=/);
  assert.match(ui, /data-copy-project=/);
});

test('入出金・日報・支払の画面仕様がコードに残っている', () => {
  const cash = read('frontend/js/cash_management.js');
  const css = read('frontend/css/styles.css');
  const daily = read('frontend/js/daily_reports.js');
  const payments = read('frontend/js/payments.js');
  const pdf = read('backend/src/services/settlement_pdf.js');
  assert.match(cash, /すべての締日/);
  assert.match(cash, /口座不備/);
  assert.match(cash, /対象外/);
  assert.match(cash, /口座調整/);
  assert.match(cash, /data-new-schedule="incoming"/);
  assert.match(cash, /data-new-schedule="outgoing"/);
  assert.match(cash, /modalHtml\('手動予定'/);
  assert.match(cash, /ondblclick=/);
  assert.match(css, /data-table\.dr-month-table td:last-child/);
  assert.match(css, /\.settlement-editor \{ display:flex; flex-direction:column/);
  assert.match(css, /\.settlement-deduction-block \{ min-height:220px/);
  assert.match(daily, /dr-ops-cell/);
  assert.match(payments, /settlement-deduction-block/);
  assert.match(payments, /placeholder="-1100"/);
  assert.match(pdf, /preview-paper/);
  assert.match(pdf, /210mm/);
});
