const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('事務作業を既存の日報・請求・支払と併設する', () => {
  const permissions = require('../src/permissions');
  const dailyKeys = permissions.FEATURES.filter((feature) => feature.group === 'daily').map((feature) => feature.key);
  assert.deepEqual(dailyKeys, ['office_work', 'daily_reports', 'daily_report_submissions']);
  assert.ok(permissions.FEATURE_KEYS.includes('invoices'));
  assert.ok(permissions.FEATURE_KEYS.includes('payments'));
  assert.ok(read('frontend/js/feature-loader.js').includes("office_work: [['office_work', 'LinksOfficeWork']]"));
});

test('事務作業は日報チェック・PDF表示・案件選択を提供する', () => {
  const source = read('frontend/js/office_work.js');
  assert.match(source, /日報チェック/);
  assert.match(source, /PDF表示/);
  assert.match(source, /案件を選択/);
  assert.match(source, /data-type/);
  assert.match(source, /dblclick/);
  assert.match(source, /settlements\/\$\{this\.type\}\/\$\{ids\[0\]\}\/preview/);
});

test('事務作業プレビューは案件一覧を置かず進行状況を表示する', () => {
  const css = read('frontend/css/styles.css');
  const source = read('frontend/js/office_work.js');
  assert.match(css, /\.office-preview-card \{[^}]*height:100%[^}]*overflow:hidden[^}]*display:flex/s);
  assert.doesNotMatch(source, /office-project-table/);
  assert.match(source, /未入力/);
  assert.match(source, /請求支払/);
  assert.match(source, /日報未承認/);
  assert.match(source, /出力済み/);
  assert.match(css, /\.office-column-row \{[^}]*padding:18px 12px 10px[^}]*align-items:flex-start/s);
});

test('全対象と第3ミラーの業務フィルターを提供する', () => {
  const css = read('frontend/css/styles.css');
  const source = read('frontend/js/office_work.js');
  assert.match(source, /id="office-all-companies">全対象/);
  assert.match(source, /data-company-sort="number">企業No/);
  assert.match(source, /data-company-sort="closing">締日/);
  assert.match(source, /data-company-sort="kana">フリガナ/);
  assert.match(source, /data-type-filter/);
  assert.match(source, /renderAllTable/);
  assert.match(source, /詳細プレビュー/);
  assert.match(css, /grid-template-columns:300px 220px 230px minmax\(400px,1fr\)/);
  assert.match(css, /\.office-column-row strong,[^}]*font-size:18px/s);
  assert.match(css, /\.office-head-actions \.btn \{[^}]*min-height:38px[^}]*font-size:14px/s);
});
