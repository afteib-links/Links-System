const test = require('node:test');
const assert = require('node:assert/strict');
const { businessDate, cycleDefinitions } = require('../src/services/cash_cycle_calendar');

test('出金予定日は休日・週末を前営業日へ移す', () => {
  const holidays = new Set(['2026-09-21']);
  assert.equal(businessDate('2026-09-21', 'outgoing', holidays), '2026-09-18');
});

test('入金予定日は休日・週末を翌営業日へ移す', () => {
  const holidays = new Set(['2026-09-21']);
  assert.equal(businessDate('2026-09-21', 'incoming', holidays), '2026-09-22');
});

test('管理回は末日を含む6回を生成する', () => {
  const cycles = cycleDefinitions('2026-02');
  assert.equal(cycles.length, 6);
  assert.deepEqual(cycles.at(-1), {
    cycleCode: 'end', baseDate: '2026-02-28', plannedIncomingDate: '2026-03-02', plannedOutgoingDate: '2026-02-27',
  });
});

test('月初の日曜は出金が前月、入金が当月翌営業日になる', () => {
  assert.equal(businessDate('2026-02-01', 'outgoing'), '2026-01-30');
  assert.equal(businessDate('2026-02-01', 'incoming'), '2026-02-02');
});

test('月末の日曜は入金が翌月、出金が当月前営業日になる', () => {
  assert.equal(businessDate('2026-05-31', 'incoming'), '2026-06-01');
  assert.equal(businessDate('2026-05-31', 'outgoing'), '2026-05-29');
});

test('手動予定の土日は締日の既定日へ戻れば変更扱いにしない', () => {
  const { normalizeCashDate } = require('../src/services/cash_cycle_calendar');
  const outgoing = normalizeCashDate('2026-09-05', 'outgoing', '2026-09-04');
  assert.equal(outgoing.scheduled, '2026-09-04');
  assert.equal(outgoing.weekendShifted, true);
  assert.equal(outgoing.overridden, false);
  const incoming = normalizeCashDate('2026-09-05', 'incoming', '2026-09-07');
  assert.equal(incoming.scheduled, '2026-09-07');
  assert.equal(incoming.overridden, false);
});
