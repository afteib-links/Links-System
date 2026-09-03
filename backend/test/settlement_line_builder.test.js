const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAggregatedLines } = require('../src/services/settlement_line_builder');

function report({
  id,
  projectId = 10,
  projectName = '検証案件',
  basic = 20000,
  overtime = 0,
  billingOverride = null,
  paymentOverride = null,
}) {
  return {
    daily_report_id: id,
    monthly_approval_id: 100,
    project_id: projectId,
    project_name: projectName,
    calculated_billing_amount: basic + overtime,
    calculated_payment_amount: basic + overtime,
    override_billing_amount: billingOverride,
    override_payment_amount: paymentOverride,
    calculation_detail: JSON.stringify({
      billing: {
        amounts: {
          details: {
            basic: { calc_type: 'daily', rate: basic, amount: basic },
            overtime: { calc_type: 'hourly', minutes: overtime ? 60 : 0, rate: overtime, amount: overtime },
          },
        },
      },
      payment: {
        amounts: {
          details: {
            basic: { calc_type: 'daily', rate: basic, amount: basic },
            overtime: { calc_type: 'hourly', minutes: overtime ? 60 : 0, rate: overtime, amount: overtime },
          },
        },
      },
    }),
  };
}

test('同じ案件・項目・単価・税区分の日報を月額明細へ集約する', () => {
  const lines = buildAggregatedLines([
    report({ id: 1 }),
    report({ id: 2 }),
  ], 'invoice');

  assert.equal(lines.length, 1);
  assert.equal(lines[0].item_name, '検証案件 基本料金');
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].unit_price, 20000);
  assert.equal(lines[0].amount, 40000);
  assert.deepEqual(lines[0].sources.map((source) => source.daily_report_id), [1, 2]);
});

test('異なる単価と料金項目は別の月額明細として保持する', () => {
  const lines = buildAggregatedLines([
    report({ id: 1, basic: 20000, overtime: 2000 }),
    report({ id: 2, basic: 21000, overtime: 2000 }),
  ], 'payment');

  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => [line.item_name, line.unit_price, line.quantity, line.amount]), [
    ['検証案件 基本料金', 20000, 1, 20000],
    ['検証案件 時間超過', 2000, 2, 4000],
    ['検証案件 基本料金', 21000, 1, 21000],
  ]);
});

test('日報で金額上書きされた場合は調整後料金として集約する', () => {
  const lines = buildAggregatedLines([
    report({ id: 1, billingOverride: 25000 }),
    report({ id: 2, billingOverride: 25000 }),
  ], 'invoice');

  assert.equal(lines.length, 1);
  assert.equal(lines[0].item_name, '検証案件 金額調整後料金');
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].amount, 50000);
});
