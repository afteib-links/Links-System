const test = require('node:test');
const assert = require('node:assert/strict');
const { applyDailyPriceCalcWithRules } = require('../src/services/price_calc_rules');

const selected = {
  rule_set:{ calculation_rule_set_id:7,rule_set_code:'standard',version_no:2,definition_checksum:'abc' },
  rules:[
    { rule_code:'daily',rule_name:'日次',stage_code:'daily',side_code:'both',handler_code:'daily_price_v1',sort_order:10,is_active:1 },
    { rule_code:'aggregate',rule_name:'集約',stage_code:'aggregate',side_code:'both',handler_code:'aggregate_sum_v1',sort_order:20,is_active:1 },
    { rule_code:'finalize',rule_name:'最終',stage_code:'finalize',side_code:'both',handler_code:'finalize_v1',sort_order:30,is_active:1 },
  ],
};

test('日次計算結果へ適用ルール版と実行履歴を保存する',async () => {
  const result = await applyDailyPriceCalcWithRules({ work_date:'2026-09-12' },{
    resolveRuleSet:async () => selected,
    dailyCalculator:async () => ({ calculated_billing_amount:40000,calculated_payment_amount:18500,calculation_detail:'{"source":"legacy"}' }),
  });
  assert.equal(result.calculation_rule_set_id,7);
  assert.equal(result.calculation_engine_code,'typed-rules-v1');
  const detail = JSON.parse(result.calculation_detail);
  assert.equal(detail.source,'legacy');
  assert.equal(detail.rule_engine.definition_checksum,'abc');
  assert.deepEqual(detail.rule_engine.trace.map((row) => row.rule_code),['daily']);
});

test('適用できる公開版がない日付は暗黙の計算をしない',async () => {
  await assert.rejects(() => applyDailyPriceCalcWithRules({ work_date:'1999-01-01' },{ resolveRuleSet:async () => null,dailyCalculator:async () => ({}) }),/公開計算ルールがありません/);
});
