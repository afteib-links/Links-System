const test = require('node:test');
const assert = require('node:assert/strict');
const { getCalculationFunctionCatalog } = require('../src/services/calculation_function_catalog');

test('現行の業務計算と基本演算を選別前の参照カタログとして一覧化する',() => {
  const rows = getCalculationFunctionCatalog();
  const codes = new Set(rows.map((row) => row.function_code));
  for (const code of [
    'daily_price_v1','aggregate_sum_v1','deduction_sum_v1','tax_v1','finalize_v1',
    'classify_work_minutes','calculate_time_amounts','calculate_distance_daily','calculate_distance_monthly',
    'effective_report_amount','build_monthly_lines','resolve_invoice_tax',
    'ADD','SUBTRACT','MULTIPLY','DIVIDE','MOD','POWER',
    'EQUAL','NOT_EQUAL','LESS_THAN','LESS_OR_EQUAL','GREATER_THAN','GREATER_OR_EQUAL',
    'IF','AND','OR','NOT','ABS','MIN','MAX','ROUND','ROUNDDOWN','ROUNDUP',
  ]) assert.equal(codes.has(code),true,`${code} が一覧にありません`);
  assert.equal(rows.every((row) => row.selection_status === 'unselected'),true);
  assert.equal(rows.every((row) => row.category_name && row.summary && row.formula && row.source),true);
});

test('APIへ渡すカタログは呼び出しごとに配列を複製する',() => {
  const first = getCalculationFunctionCatalog();
  const second = getCalculationFunctionCatalog();
  first[0].inputs.push('mutation');
  assert.equal(second[0].inputs.includes('mutation'),false);
});
