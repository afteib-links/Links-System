const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRuleSet,definitionChecksum,executeRuleSet,roundAmount } = require('../src/services/calculation_rule_engine');

const set = { calculation_rule_set_id:1,rule_set_code:'standard',rule_set_name:'標準',version_no:1 };
const rules = [
  { rule_code:'daily',rule_name:'日次',stage_code:'daily',side_code:'both',handler_code:'daily_price_v1',sort_order:10,is_active:1,parameter_json:{} },
  { rule_code:'aggregate',rule_name:'集約',stage_code:'aggregate',side_code:'both',handler_code:'aggregate_sum_v1',sort_order:20,is_active:1,parameter_json:{} },
  { rule_code:'deduction',rule_name:'控除',stage_code:'deduction',side_code:'payment',handler_code:'deduction_sum_v1',sort_order:30,is_active:1,parameter_json:{} },
  { rule_code:'tax',rule_name:'税',stage_code:'tax',side_code:'billing',handler_code:'tax_v1',sort_order:40,is_active:1,parameter_json:{ rate:0.1 },rounding_json:{ mode:'floor',unit:1 } },
  { rule_code:'finalize',rule_name:'最終',stage_code:'finalize',side_code:'both',handler_code:'finalize_v1',sort_order:50,is_active:1,parameter_json:{} },
];

test('型付きルールは段階・処理・安全式を公開前に検証する',() => {
  assert.equal(validateRuleSet(set,rules).ok,true);
  assert.match(definitionChecksum(set,rules),/^[a-f0-9]{64}$/);
  assert.equal(definitionChecksum(set,rules),definitionChecksum(set,[...rules].reverse()));
  const invalid = validateRuleSet(set,[...rules,{ ...rules[0],rule_code:'bad',handler_code:'eval_js',condition_expression:'process.exit()' }]);
  assert.equal(invalid.ok,false);
  assert.match(invalid.errors.join(' '),/未対応の処理/);
});

test('請求は集約後に課税・丸め・合計を順番どおり計算する',async () => {
  const result = await executeRuleSet(set,rules,{ side:'billing',lines:[{ amount:10005,tax_category:'taxable' },{ amount:500,tax_category:'non_taxable' }],input:{} },{ dailyCalculator:async () => ({ calculated_billing_amount:0,calculated_payment_amount:0 }) });
  assert.equal(result.subtotal_amount,10505);
  assert.equal(result.taxable_amount,10005);
  assert.equal(result.tax_amount,1000);
  assert.equal(result.total_amount,11505);
  assert.deepEqual(result.trace.map((row) => row.rule_code),['daily','aggregate','tax','finalize']);
});

test('支払は控除を差し引き、日次だけの実行では既存計算器を版付きで包む',async () => {
  const payment = await executeRuleSet(set,rules,{ side:'payment',lines:[{ amount:20000 }],deductions:[{ amount:1100 },{ amount:-500 }],input:{} },{ dailyCalculator:async () => ({ calculated_billing_amount:0,calculated_payment_amount:0 }) });
  assert.equal(payment.deduction_total,1600);
  assert.equal(payment.total_amount,18400);
  const daily = await executeRuleSet(set,rules,{ side:'billing',stages:['daily'],input:{ marker:1 } },{ dailyCalculator:async (input) => ({ calculated_billing_amount:40000,calculated_payment_amount:18500,marker:input.marker }) });
  assert.equal(daily.billing_amount,40000);
  assert.equal(daily.payment_amount,18500);
  assert.equal(daily.calculation_engine_code,'typed-rules-v1');
});

test('丸め単位と方式を固定処理として適用する',() => {
  assert.equal(roundAmount(1259,{ mode:'floor',unit:10 }),1250);
  assert.equal(roundAmount(1251,{ mode:'ceil',unit:10 }),1260);
});

test('契約・案件側の税率と丸め指定を公開版の既定値より優先する',async () => {
  const result = await executeRuleSet(set,rules,{ side:'billing',lines:[{ amount:10009,tax_category:'taxable' }],tax_rate:0.08,tax_rounding:{ mode:'ceil',unit:10 },input:{} },{ dailyCalculator:async () => ({ calculated_billing_amount:0,calculated_payment_amount:0 }) });
  assert.equal(result.tax_amount,810);
  assert.equal(result.total_amount,10819);
});

test('請求・支払の必須処理が欠けた版や条件付きだけの版を公開前に拒否する',() => {
  const billingOnlyFinal = rules.map((rule) => rule.handler_code === 'finalize_v1' ? { ...rule,side_code:'billing' } : rule);
  const missingPayment = validateRuleSet(set,billingOnlyFinal);
  assert.equal(missingPayment.ok,false);
  assert.match(missingPayment.errors.join(' '),/支払側に条件なしの必須処理がありません: finalize_v1/);

  const missingBillingTax = validateRuleSet(set,rules.filter((rule) => rule.handler_code !== 'tax_v1'));
  assert.equal(missingBillingTax.ok,false);
  assert.match(missingBillingTax.errors.join(' '),/請求側に条件なしの必須処理がありません: tax_v1/);

  const conditionalDeduction = rules.map((rule) => rule.handler_code === 'deduction_sum_v1' ? { ...rule,condition_expression:'subtotal_amount > 0' } : rule);
  const missingUnconditional = validateRuleSet(set,conditionalDeduction);
  assert.equal(missingUnconditional.ok,false);
  assert.match(missingUnconditional.errors.join(' '),/支払側に条件なしの必須処理がありません: deduction_sum_v1/);

  const wrongStage = rules.map((rule) => rule.handler_code === 'finalize_v1' ? { ...rule,stage_code:'aggregate' } : rule);
  assert.match(validateRuleSet(set,wrongStage).errors.join(' '),/処理と計算段階が一致しません/);
});

test('計算途中の非数値を0円に読み替えず止め、正しい0円は許可する',async () => {
  const calculate = (lines) => executeRuleSet(set,rules,{ side:'payment',lines,deductions:[],input:{} },{
    dailyCalculator:async () => ({ calculated_billing_amount:0,calculated_payment_amount:0 }),
  });
  await assert.rejects(calculate([{ amount:'not-a-number' }]),/支払側の計算結果が不正です: subtotal_amount/);
  const zero = await calculate([{ amount:0 }]);
  assert.equal(zero.total_amount,0);
});
