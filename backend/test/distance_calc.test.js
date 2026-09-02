const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDistanceSide, calculateMonthlyDistance, validateDistanceRule } = require('../src/services/distance_calc');

const daily = (overrides = {}) => ({ mode: 'daily_excess', base_distance: 100, unit_price: 10, fixed_amount: 0, ...overrides });

test('日次基準距離は基準未満・一致・1km超過の境界を計算する', () => {
  assert.equal(calculateDistanceSide({ distance: 99, rule: daily() }).amount, 0);
  assert.equal(calculateDistanceSide({ distance: 100, rule: daily() }).amount, 0);
  const result = calculateDistanceSide({ distance: 101, rule: daily() });
  assert.equal(result.excess_distance_km, 1);
  assert.equal(result.quantity_km, 1);
  assert.equal(result.amount, 10);
});

test('月間累計は複数日を一度だけ計算できる', () => {
  const result = calculateMonthlyDistance({ distances: [60, 50, 10], rule: daily({ mode: 'monthly_excess' }) });
  assert.equal(result.accumulated_distance_km, 120);
  assert.equal(result.excess_distance_km, 20);
  assert.equal(result.amount, 200);
});

test('段階テーブルは100まで、101から次段階、最終上限なしを扱う', () => {
  const rule = { mode: 'tiered', base_distance: 0, tier_mode: 'excess_distance', tiers: [
    { upper_distance: 100, unit_price: 10 }, { upper_distance: null, unit_price: 20 },
  ] };
  assert.equal(calculateDistanceSide({ distance: 100, rule }).amount, 1000);
  assert.equal(calculateDistanceSide({ distance: 101, rule }).amount, 2020);
  assert.equal(calculateDistanceSide({ distance: 200, rule }).amount, 4000);
});

test('請求・支払で異なる丸め条件を独立適用できる', () => {
  const base = { mode: 'daily_excess', base_distance: 0, unit_price: 10.6 };
  assert.equal(calculateDistanceSide({ distance: 1, rule: { ...base, rounding: { amount_mode: 'floor' } } }).amount, 10);
  assert.equal(calculateDistanceSide({ distance: 1, rule: { ...base, rounding: { amount_mode: 'ceil' } } }).amount, 11);
});

test('段階の上限逆転・上限なし中間配置・上限なし欠落を拒否する', () => {
  assert.throws(() => validateDistanceRule({ mode: 'tiered', base_distance: 0, tiers: [{ upper_distance: 100 }, { upper_distance: 90 }, { upper_distance: null }] }));
  assert.throws(() => validateDistanceRule({ mode: 'tiered', base_distance: 0, tiers: [{ upper_distance: null }, { upper_distance: 100 }] }));
  assert.throws(() => validateDistanceRule({ mode: 'tiered', base_distance: 0, tiers: [{ upper_distance: 100 }] }));
});
