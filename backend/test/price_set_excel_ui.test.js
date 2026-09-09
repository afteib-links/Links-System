const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('金額データの基本情報を指定順で上部へ置き備考を最下部へ分離する', () => {
  const ui = read('frontend/js/price_sets.js');
  const start = ui.indexOf('name="apply_start_date"');
  const end = ui.indexOf('name="apply_end_date"');
  const company = ui.indexOf("searchSelectHtml('company_id'");
  const name = ui.indexOf('name="price_set_name"');
  const note = ui.indexOf('price-set-note-card');
  assert.ok(start >= 0 && start < end && end < company && company < name);
  assert.ok(note > name);
  assert.match(ui, /price-set-basic-grid/);
});

test('料金カードはExcel型3列で行末から適用条件を展開する', () => {
  const ui = read('frontend/js/price_sets.js');
  const css = read('frontend/css/styles.css');
  assert.match(ui, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(ui, /min-width:\s*1680px[\s\S]{0,120}fee-items-stack/);
  assert.match(ui, /data-toggle-rule/);
  assert.match(ui, /data-rule-panel/);
  assert.match(ui, /<span>支払詳細名<\/span><span>条件<\/span>/);
  assert.match(css, /\.fee-rule-main \{ display:grid/);
  assert.match(css, /border-right:1px solid #d8e0e8/);
});

test('タブレット以下は横長1列カードにして操作と曜日を明確にする', () => {
  const ui = read('frontend/js/price_sets.js');
  const css = read('frontend/css/styles.css');
  assert.match(ui, /@media \(max-width: 1100px\)[\s\S]{0,180}fee-items-stack \{ grid-template-columns:1fr/);
  assert.match(css, /@media \(max-width:1100px\)[\s\S]{0,420}\[data-add-row\],[\s\S]{0,80}\[data-del-row\] \{ display:none/);
  assert.match(ui, /title="料金カードをコピー" aria-label="料金カードをコピー"/);
  assert.match(ui, /title="料金カードを削除" aria-label="料金カードを削除"/);
  assert.match(css, /fee-card-action-copy[\s\S]{0,100}background:#ffd84d/);
  assert.match(css, /fee-card-action-delete[\s\S]{0,100}background:#e63e4d/);
  assert.match(css, /weekday-fri \{ color:#fff; border-color:#22a447; background:#34c759/);
  assert.match(css, /weekday-sat \{ color:#fff; border-color:#086ccf; background:#1683ea/);
});

test('勤務・深夜・丸め条件を4列化し日次基準時間を最小幅にする', () => {
  const ui = read('frontend/js/price_sets.js');
  assert.match(ui, /night-setting-card \{ display:grid; grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(ui, /night-setting-card \.night-field-standard \{ max-width:4\.5rem/);
  assert.match(ui, /night-setting-card \.night-field-tiers \{ grid-column:span 2/);
  assert.match(ui, /price-set-night-card \{ padding:10px 16px/);
  assert.match(ui, /class="night-field-standard">日次基準時間/);
});
