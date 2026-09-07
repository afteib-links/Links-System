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

test('事務作業プレビューは画面内固定と内部スクロールを使う', () => {
  const css = read('frontend/css/styles.css');
  assert.match(css, /\.office-preview-card \{[^}]*height:100%[^}]*overflow:hidden[^}]*display:flex/s);
  assert.match(css, /\.office-project-table \{[^}]*flex:1[^}]*overflow:auto/s);
  assert.match(css, /\.office-column-row \{[^}]*padding:18px 12px 10px[^}]*align-items:flex-start/s);
});
