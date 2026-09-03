const assert = require('node:assert/strict');
const test = require('node:test');

const advancesRouter = require('../src/routes/advances');

test('案件締日を3つの前払グループへ重複なく分類する', () => {
  const classified = new Map();
  for (const [groupCode, config] of Object.entries(advancesRouter.GROUPS)) {
    for (const closing of config.closings) {
      assert.equal(classified.has(closing), false, `${closing}日締めが重複しています`);
      classified.set(closing, groupCode);
    }
  }
  assert.deepEqual(Object.fromEntries(classified), {
    5:'early', 10:'early', 15:'middle', 20:'middle', 25:'late', end:'late',
  });
  assert.equal(advancesRouter.GROUPS.early.paymentCycle, '20');
  assert.equal(advancesRouter.GROUPS.middle.paymentCycle, 'end');
  assert.equal(advancesRouter.GROUPS.late.paymentCycle, '10');
  assert.equal(advancesRouter.GROUPS.late.paymentMonthOffset, 1);
});

test('締月と締日から対象期間を計算する', () => {
  assert.deepEqual(advancesRouter.periodFor('2026-05', '10'), {
    start:'2026-04-11', end:'2026-05-10',
  });
  assert.deepEqual(advancesRouter.periodFor('2026-03', 'end'), {
    start:'2026-03-01', end:'2026-03-31',
  });
  assert.equal(advancesRouter.shiftMonth('2026-12', 1), '2027-01');
});
