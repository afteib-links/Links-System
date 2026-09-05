const assert = require('node:assert/strict');
const test = require('node:test');

global.window = {};
require('../../frontend/js/data-table.js');

test('compareValuesは数値を数値順で比較する', () => {
  assert.ok(window.LinksDataTable.compareValues('2', '10') < 0);
  assert.ok(window.LinksDataTable.compareValues('10', '2') > 0);
});

test('compareValuesは日本語を自然順で比較し空値を末尾に置く', () => {
  assert.ok(window.LinksDataTable.compareValues('案件2', '案件10') < 0);
  assert.ok(window.LinksDataTable.compareValues('-', '案件1') > 0);
  assert.equal(window.LinksDataTable.compareValues('', null), 0);
});
