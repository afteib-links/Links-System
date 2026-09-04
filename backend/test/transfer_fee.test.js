const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveTransferFee } = require('../src/services/transfer_fee');

test('案件の手数料をパートナーより優先する', () => {
  assert.deepEqual(resolveTransferFee(
    { transfer_fee_pattern_id: 2, pattern_name: '案件用', amount: 330 },
    { transfer_fee_pattern_id: 1, pattern_name: '標準', amount: 550 }
  ), { patternId:2, patternName:'案件用', amount:330, source:'project' });
});

test('案件未設定時はパートナー、双方未設定時は0円とする', () => {
  assert.equal(resolveTransferFee(null, { transfer_fee_pattern_id:1, pattern_name:'標準', amount:550 }).amount, 550);
  assert.deepEqual(resolveTransferFee(null, null), { patternId:null, patternName:null, amount:0, source:'none' });
});
