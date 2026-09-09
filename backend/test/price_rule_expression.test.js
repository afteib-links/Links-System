const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectExpression, evaluateExpression } = require('../src/services/price_rule_expression');
const { validateFeeItems, firstMatchingRows, materializeFeeItem } = require('../src/services/fee_item_rules');

test('許可したExcel風の演算・関数だけを安全に評価する', () => {
  assert.equal(evaluateExpression('=IF(distance > 100, ROUND(distance * 25.5, 0), 0)', { distance: 120 }), 3060);
  assert.equal(evaluateExpression('AND(work_minutes >= 480, NOT(is_absent))', { work_minutes: 500, is_absent: false }), true);
  assert.throws(() => evaluateExpression('process.exit()'), /使用できない関数|解釈できません/);
  assert.throws(() => evaluateExpression('1; 2'), /使用できない文字/);
});

test('未提供の将来変数を含む行は保存可能な下書きとなる', () => {
  const result = validateFeeItems([{ name: '将来ルール', rows: [{ item_type: 'daily_basic', condition_expression: 'weather_code = 1' }] }]);
  assert.equal(result.items[0].rows[0].rule_state, 'draft');
  assert.deepEqual(result.items[0].rows[0].undefined_variables, ['weather_code']);
  assert.equal(inspectExpression('weather_code = 1').ok, true);
  const active = validateFeeItems([{ rows: [{ item_type: 'daily_basic', rule_state: 'draft', condition_expression: 'total_distance > 10' }] }]);
  assert.equal(active.items[0].rows[0].rule_state, 'active');
});

test('同じ項目種別は上から最初に条件一致した行を採用する', () => {
  const item = { rows: [
    { id: 'far', item_type: 'daily_basic', condition_expression: 'total_distance > 100', billing: 20000, payment: 15000, sort_order: 10 },
    { id: 'default', item_type: 'daily_basic', condition_expression: '', billing: 16000, payment: 12000, sort_order: 20 },
  ] };
  assert.equal(firstMatchingRows(item, { total_distance: 120 }).selected.get('daily_basic').id, 'far');
  assert.equal(firstMatchingRows(item, { total_distance: 50 }).selected.get('daily_basic').id, 'default');
  const output = materializeFeeItem(item, { total_distance: 120 }, 'billing');
  assert.equal(output.item.matrix.daily.basic.billing, 20000);
});

test('有効な料金行がない場合は0円相当と要確認警告を返す', () => {
  const output = materializeFeeItem({ rows: [{ id: 'draft', item_type: 'daily_basic', condition_expression: 'future_code = 1', billing: 100 }] }, {}, 'billing');
  assert.equal(output.item.matrix.daily.basic, undefined);
  assert.equal(output.warnings[0].code, 'fee_rule_no_match');
});
