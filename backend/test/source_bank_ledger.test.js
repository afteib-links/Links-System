const assert = require('node:assert/strict');
const test = require('node:test');
const { yenInteger, accountBalance, mapBalanceRow } = require('../src/services/source_bank_ledger');

test('口座残高は期首＋調整入金−調整出金', () => {
  assert.equal(accountBalance(100000, 20000, 8000), 112000);
  assert.equal(accountBalance(0, 0, 0), 0);
});

test('期首残高は整数円だけ受け付ける', () => {
  assert.equal(yenInteger('1500', '期首残高'), 1500);
  assert.equal(yenInteger('', '期首残高'), 0);
  assert.throws(() => yenInteger('1.5', '期首残高'), /整数円/);
});

test('残高行は表示用に数値化する', () => {
  const row = mapBalanceRow({
    source_bank_account_id: '3',
    account_label: '本口座',
    bank_name: 'りそな銀行',
    masked_account_number: '***4567',
    opening_balance: '10000',
    incoming_total: '2000',
    outgoing_total: '500',
  });
  assert.equal(row.balance, 11500);
});
