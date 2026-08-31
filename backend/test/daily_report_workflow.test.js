const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canChangeDailyStatus,
  uncheckedDatesForMonth,
} = require('../src/services/daily_report_workflow');

test('日次確認は付け外しできるが、日報行を直接承認済みにはできない', () => {
  assert.equal(canChangeDailyStatus('draft', 'confirmed'), true);
  assert.equal(canChangeDailyStatus('confirmed', 'draft'), true);
  assert.equal(canChangeDailyStatus('confirmed', 'approved'), false);
});

test('同じ日に複数行ある場合は全行確認済みのときだけ日次確認済みと判定する', () => {
  const reports = [
    { work_date: '2026-02-01', status: 'confirmed' },
    { work_date: '2026-02-01', status: 'draft' },
    { work_date: '2026-02-02', status: 'confirmed' },
    { work_date: '2026-02-02', status: 'approved' },
  ];
  const unchecked = uncheckedDatesForMonth(reports, '2026-02');
  assert.equal(unchecked.includes('2026-02-01'), true);
  assert.equal(unchecked.includes('2026-02-02'), false);
  assert.equal(unchecked.length, 27);
});

test('日報行がない日も月次承認依頼時の未確認警告対象にする', () => {
  const unchecked = uncheckedDatesForMonth(
    [{ work_date: '2026-04-01', status: 'confirmed' }],
    '2026-04'
  );
  assert.equal(unchecked[0], '2026-04-02');
  assert.equal(unchecked.at(-1), '2026-04-30');
  assert.equal(unchecked.length, 29);
});
