'use strict';

const { inspectExpression, evaluateExpression } = require('./price_rule_expression');

// This validates named quantities supplied by the caller. It deliberately does
// not infer attendance, time, holiday eligibility, or execute workbook formulas.
function evaluateSemanticAmount(rule, quantity) {
  if (!rule || typeof quantity !== 'number' || !Number.isFinite(quantity)) throw new Error('計算数量が未設定または不正です');
  if (typeof rule.unit_price !== 'number' || !Number.isFinite(rule.unit_price)) throw new Error('単価が未設定または不正です');
  if (rule.quantity_normalization === 'absolute_value' && quantity < 0) throw new Error('不足数量は正の絶対値で指定してください');
  const inspection = inspectExpression(rule.amount_expression, ['quantity', 'unit_price']);
  if (!inspection.ok || inspection.undefined_variables.length || inspection.references.some(v => !['quantity', 'unit_price'].includes(v))) {
    throw new Error('名前付き金額式が不正です');
  }
  if (!inspection.references.includes('quantity') || !inspection.references.includes('unit_price')) throw new Error('数量と単価の参照が必要です');
  const amount = evaluateExpression(rule.amount_expression, { quantity, unit_price: rule.unit_price });
  if (!Number.isFinite(amount)) throw new Error('計算結果が数値ではありません');
  return amount;
}

function verifySemanticModel(model) {
  if (model?.schema_version !== 1 || !model.rules?.length) throw new Error('計算定義がありません');
  const result = { checked: 0, matched: 0, unavailable: 0, mismatches: [] };
  for (const item of model.rules) for (const side of ['billing', 'payment']) {
    const rule = item[side], sample = rule?.sample;
    if (sample?.quantity == null || sample?.source_amount == null) { result.unavailable++; continue; }
    const amount = evaluateSemanticAmount(rule, sample.quantity);
    result.checked++;
    if (Math.abs(amount - sample.source_amount) <= 0.01000001) result.matched++;
    else result.mismatches.push({ rule_id: item.id, side, calculated: amount, source: sample.source_amount });
  }
  return result;
}

module.exports = { evaluateSemanticAmount, verifySemanticModel };
