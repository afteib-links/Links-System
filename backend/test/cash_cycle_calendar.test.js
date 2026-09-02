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
