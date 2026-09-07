const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { featuresFromRoles } = require('../src/permissions');

test('基本管理はマスターを扱う社内権限だけが利用できる', () => {
  for (const role of ['admin', 'system', 'soumu']) {
    assert.equal(featuresFromRoles([role]).includes('base_management'), true, role);
  }
  for (const role of ['sales', 'executive', 'partner', 'company']) {
    assert.equal(featuresFromRoles([role]).includes('base_management'), false, role);
  }
});

test('基本管理画面は全対象・階層別編集・欠損表示を備える', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/base_management.js'), 'utf8');
  for (const text of ['全対象', '基本案件なし', '個別案件なし', '金額データなし', 'ダブルクリック', '編集画面へ', '請求単価合計', '支払単価合計']) {
    assert.match(source, new RegExp(text));
  }
  for (const target of ['companies', 'base_projects', 'projects', 'price_sets']) {
    assert.match(source, new RegExp(`openFeature\\('${target}'`));
  }
});
