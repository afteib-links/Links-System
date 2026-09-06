const assert = require('node:assert/strict');
const test = require('node:test');
const {
  periodForCycle,
  periodFor,
  shiftMonth,
  baseSubmitDate,
  deadlineDate,
  overdueDays,
  parseGraceDays,
  parseOverdueDays,
  addUtcDays,
} = require('../src/services/closing_cycles');
const submissions = require('../src/routes/daily_report_submissions');

test('先払いと同じ5日系・10日系の期間を計算する', () => {
  assert.deepEqual(periodForCycle('2026-09', '5', 'early'), { start: '2026-08-26', end: '2026-09-05' });
  assert.deepEqual(periodForCycle('2026-09', '20', 'middle'), { start: '2026-09-11', end: '2026-09-20' });
  assert.deepEqual(periodFor('2026-09', 'end'), { start: '2026-09-21', end: '2026-09-30' });
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('基本提出日は対象期間最終日の翌日で、期限は猶予日を加算する', () => {
  assert.equal(baseSubmitDate('2026-09-10'), '2026-09-11');
  assert.equal(baseSubmitDate('2026-09-30'), '2026-10-01');
  assert.equal(deadlineDate('2026-09-11', 1), '2026-09-12');
  assert.equal(deadlineDate('2026-09-11', 0), '2026-09-11');
  assert.equal(addUtcDays('2026-12-31', 1), '2027-01-01');
});

test('猶予日の不正値は参照時1日、厳密時は拒否する', () => {
  assert.equal(parseGraceDays('1'), 1);
  assert.equal(parseGraceDays('abc'), 1);
  assert.throws(() => parseGraceDays('99', { strict: true }), /0〜30/);
});

test('遅延日数は提出済みなら提出日、未提出なら今日を判定日にする', () => {
  assert.equal(overdueDays({ submitted: true, submittedDate: '2026-09-12', deadline: '2026-09-12', today: '2026-09-20' }), 0);
  assert.equal(overdueDays({ submitted: true, submittedDate: '2026-09-13', deadline: '2026-09-12', today: '2026-09-20' }), 1);
  assert.equal(overdueDays({ submitted: false, submittedDate: null, deadline: '2026-09-12', today: '2026-09-15' }), 3);
  assert.equal(overdueDays({ submitted: false, submittedDate: null, deadline: '2026-09-12', today: '2026-09-12' }), 0);
});

test('提出トグルOFFは提出日を消し、ONで日付が無ければ今日を使う', () => {
  assert.deepEqual(submissions.resolveSubmittedDate({ is_submitted: false, submitted_date: '2026-09-10' }, '2026-09-06'), {
    is_submitted: 0, submitted_date: null,
  });
  assert.deepEqual(submissions.resolveSubmittedDate({ is_submitted: true }, '2026-09-06'), {
    is_submitted: 1, submitted_date: '2026-09-06',
  });
  assert.throws(() => submissions.resolveSubmittedDate({ is_submitted: true, submitted_date: '2026-09-07' }, '2026-09-06'), /未来日/);
});

test('セル状態と案件別合計を遅延優先で判定する', () => {
  const cycles = [
    { group_code: 'early', is_submitted: true, overdue_days: 0 },
    { group_code: 'middle', is_submitted: true, overdue_days: 1 },
    { group_code: 'late', is_submitted: false, overdue_days: 3 },
  ];
  assert.equal(submissions.cellStatus(cycles[0]), 'submitted');
  assert.equal(submissions.cellStatus(cycles[1]), 'overdue');
  assert.equal(submissions.cellStatus(cycles[2]), 'overdue');
  assert.deepEqual(submissions.projectTotals(cycles), { submitted_count: 2, overdue_count: 2, overdue_days: 4 });
});

test('提出予定日は期間最終日の翌日としてセルへ載せる', () => {
  const cycle = submissions.presentCycle('2026-09', '20', 'early', null, 1, '2026-09-06');
  assert.equal(cycle.period_end, '2026-09-10');
  assert.equal(cycle.planned_submit_date, '2026-09-11');
  assert.equal(cycle.deadline_date, '2026-09-12');
  assert.equal(cycle.is_submitted, false);
  assert.equal(cycle.overdue_days, 0);
  assert.equal(cycle.overdue_days_manual, false);
});

test('遅延日数の手修正は0〜365の整数だけ受け付ける', () => {
  assert.equal(parseOverdueDays(2), 2);
  assert.equal(parseOverdueDays('0'), 0);
  assert.throws(() => parseOverdueDays(-1), /0〜365/);
  assert.throws(() => parseOverdueDays(366), /0〜365/);
  assert.equal(submissions.resolveOverdueDays({}), null);
  assert.equal(submissions.resolveOverdueDays({ overdue_days: null }), null);
  assert.equal(submissions.resolveOverdueDays({ overdue_days: 5 }), 5);
});

test('保存済みの遅延日数があるときは自動計算より手修正値を使う', () => {
  const auto = submissions.presentCycle('2026-09', '5', 'early', { is_submitted: 0, submitted_date: null }, 1, '2026-09-10');
  assert.equal(auto.calculated_overdue_days, 3);
  assert.equal(auto.overdue_days, 3);
  assert.equal(auto.overdue_days_manual, false);
  const manual = submissions.presentCycle('2026-09', '5', 'early', { is_submitted: 0, submitted_date: null, overdue_days: 2 }, 1, '2026-09-10');
  assert.equal(manual.calculated_overdue_days, 3);
  assert.equal(manual.overdue_days, 2);
  assert.equal(manual.overdue_days_manual, true);
});
