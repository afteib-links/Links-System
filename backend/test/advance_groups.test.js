const assert = require('node:assert/strict');
const test = require('node:test');

const advancesRouter = require('../src/routes/advances_matrix');

test('3サイクルの支払管理回を定義する', () => {
  assert.equal(advancesRouter.GROUPS.early.paymentCycle, '20');
  assert.equal(advancesRouter.GROUPS.middle.paymentCycle, 'end');
  assert.equal(advancesRouter.GROUPS.late.paymentCycle, '10');
  assert.equal(advancesRouter.GROUPS.late.paymentMonthOffset, 1);
});

test('5日系の3対象期間を計算する', () => {
  assert.deepEqual(advancesRouter.periodForCycle('2026-05', '5', 'early'), {
    start:'2026-04-26', end:'2026-05-05',
  });
  assert.deepEqual(advancesRouter.periodForCycle('2026-05', '15', 'middle'), {
    start:'2026-05-06', end:'2026-05-15',
  });
  assert.deepEqual(advancesRouter.periodForCycle('2026-05', '25', 'late'), {
    start:'2026-05-16', end:'2026-05-25',
  });
});

test('10日系の3対象期間を月末・うるう年込みで計算する', () => {
  assert.deepEqual(advancesRouter.periodFor('2026-05', '10'), {
    start:'2026-05-01', end:'2026-05-10',
  });
  assert.deepEqual(advancesRouter.periodForCycle('2024-02', 'end', 'late'), {
    start:'2024-02-21', end:'2024-02-29',
  });
  assert.deepEqual(advancesRouter.periodForCycle('2025-02', 'end', 'late'), {
    start:'2025-02-21', end:'2025-02-28',
  });
});

test('年越しの月移動を計算する', () => {
  assert.equal(advancesRouter.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(advancesRouter.shiftMonth('2026-01', -1), '2025-12');
});

test('先払ONかつ1円以上だけを合計する', () => {
  const cycles = ['early','middle','late'].map((group_code, index) => ({ group_code, is_target:index !== 1, advance_amount:[100,200,0][index], transfer_fee_amount:550 }));
  const summary = advancesRouter.summarize([{ cycles }]);
  assert.equal(summary.advance_count, 1);
  assert.equal(summary.advance_amount, 100);
  assert.equal(summary.transfer_fee_amount, 550);
});
