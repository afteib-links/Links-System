const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function loadBrowserScript(relativePath, exportedName) {
  global.window = {};
  const target = path.resolve(__dirname, '..', '..', relativePath);
  delete require.cache[target];
  require(target);
  return global.window[exportedName];
}

test('共通金額表示は通常金額を整数、単価だけ既存小数付きで表示する', () => {
  const money = loadBrowserScript('frontend/js/feature-kit.js', 'LinksMoney');
  assert.equal(money.amount(12345.6), '￥12,346');
  assert.equal(money.amount(-12345), '￥-12,345');
  assert.equal(money.amount(0), '￥0');
  assert.equal(money.unit(123), '￥123');
  assert.equal(money.unit(123.5), '￥123.5');
  assert.equal(money.unit('123.50'), '￥123.5');
});

test('料金項目は複数計算種別を保持し、距離だけ全日、その他は曜日別で行へ変換する', () => {
  const fee = loadBrowserScript('frontend/js/price_set_fee_model.js', 'LinksPriceSetFeeModel');
  const item = fee.normalizeItem({
    name:'混在料金',
    calc_types:['daily', 'distance', 'custom'],
    weekdays:{ mon:true },
    matrix:{
      daily:{ basic:{ billing:10000, payment:8000 } },
      distance:{ basic:{ billing:25.5, payment:20 } },
      custom:{ basic:{ billing:300, payment:200 } },
    },
  }, ['basic']);
  const lines = fee.itemsToLines([item]);
  assert.deepEqual(lines.map((line) => [line.calc_type_code, line.weekday_code]), [
    ['daily', 'mon'],
    ['distance', 'all'],
    ['custom', 'mon'],
  ]);
  assert.deepEqual(fee.feeItemsForExtraData([item])[0].calc_types, ['daily', 'distance', 'custom']);
});

test('従来mode形式の料金項目は日極・時間または距離として補完する', () => {
  const fee = loadBrowserScript('frontend/js/price_set_fee_model.js', 'LinksPriceSetFeeModel');
  assert.deepEqual(fee.normalizeItem({ mode:'weekdays' }, ['basic']).calc_types, ['daily', 'hourly']);
  assert.deepEqual(fee.normalizeItem({ mode:'distance' }, ['basic']).calc_types, ['distance']);
});
