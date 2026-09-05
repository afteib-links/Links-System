const assert = require('node:assert/strict');
const test = require('node:test');
const paymentsRouter = require('../src/routes/payments');

test('支払再締めは有効な前払配賦だけを残高から控除する', () => {
  assert.match(paymentsRouter.ACTIVE_ADVANCE_ALLOCATION_JOIN, /aa\.status = 'active'/);
});
