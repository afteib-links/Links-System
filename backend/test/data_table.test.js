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

test('一覧の数値識別子Noだけを共通狭幅列として判定する', () => {
  for (const label of ['No', 'No.', '企業No', '案件No', '事業所No']) {
    assert.equal(window.LinksDataTable.isCompactNumberColumn(label), true, `${label}を狭幅にする`);
  }
  for (const label of ['取り纏めNo', '車両番号', '料金セットNo']) {
    assert.equal(window.LinksDataTable.isCompactNumberColumn(label), false, `${label}は長い業務番号として維持する`);
  }
  assert.equal(window.LinksDataTable.isCompactNumberColumn({ label:'独自番号',compactNumber:true }), true, '列定義から明示指定できる');
});
