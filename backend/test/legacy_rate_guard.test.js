const test = require('node:test');
const assert = require('node:assert/strict');
const { assertLegacyRateReady } = require('../src/services/legacy_rate_guard');
test('legacy rates: unreviewed arithmetic cannot silently recalculate saved amounts', () => {
  assert.throws(() => assertLegacyRateReady({ calculation_status: 'review_required' }), e => e.status === 422 && e.code === 'legacy_rate_review_required');
});
test('legacy rates: ready and ordinary rates retain the existing calculation path', () => {
  for (const value of [undefined, null, {}, { calculation_status: 'ready' }]) assert.doesNotThrow(() => assertLegacyRateReady(value));
});
