'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSemanticAmount, verifySemanticModel } = require('../src/services/legacy_semantic_amount');
const rule = (expression, price, extra = {}) => ({amount_expression: expression, unit_price: price, ...extra});
test('day count and independent bill/payment rates', () => {
  assert.equal(evaluateSemanticAmount(rule('unit_price * quantity', 20000), 21), 420000);
  assert.equal(evaluateSemanticAmount(rule('unit_price * quantity', 15455), 21), 324555);
});
test('shortage uses positive quantity and one deduction', () => {
  const r = rule('-(unit_price * quantity)', 3375, {quantity_normalization: 'absolute_value'});
  assert.equal(evaluateSemanticAmount(r, 7), -23625);
  assert.throws(() => evaluateSemanticAmount(r, -7));
  assert.equal(evaluateSemanticAmount(r, 0), -0);
});
test('monthly minutes and amount round up', () => {
  assert.equal(evaluateSemanticAmount(rule('ROUNDUP(unit_price * quantity / 60, 0)', 2968.75), 871), 43097);
});
test('negative half yen rounds away from zero through positive magnitude', () => {
  assert.equal(evaluateSemanticAmount(rule('-(ROUND(unit_price * quantity, 0))', 2.5), 1), -3);
});
test('zero is valid, missing/nonfinite inputs and unsafe expressions are rejected', () => {
  assert.equal(evaluateSemanticAmount(rule('unit_price * quantity', 0), 12), 0);
  for (const q of [null, undefined, NaN, Infinity, '2']) assert.throws(() => evaluateSemanticAmount(rule('unit_price * quantity', 2), q));
  for (const e of ['B39*D39', 'process.exit()', 'billing * quantity', 'unit_price / 0', '1']) assert.throws(() => evaluateSemanticAmount(rule(e, 2), 1));
});
test('verification exposes missing and mismatching source controls', () => {
  const sample = q => ({quantity:q, source_amount:10});
  const model = {schema_version:1, rules:[{id:'a',billing:{...rule('unit_price * quantity', 5),sample:sample(2)},payment:{...rule('unit_price * quantity', 3),sample:sample(2)}},
    {id:'b',billing:{sample:sample(null)},payment:{sample:sample(null)}}]};
  const result = verifySemanticModel(model);
  assert.equal(result.matched,1);assert.equal(result.mismatches.length,1);assert.equal(result.unavailable,2);
});
