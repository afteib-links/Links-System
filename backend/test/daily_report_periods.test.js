const test = require('node:test');
const assert = require('node:assert/strict');
const { closingPeriod, resolvePeriod, periodDates, shiftMonth } = require('../src/services/daily_report_periods');
const { uncheckedDatesForMonth } = require('../src/services/daily_report_workflow');

test('20日締め11月は10月21日から11月20日までの31日', () => {
  const period = closingPeriod('2026-11', '20');
  assert.equal(period.period_start, '2026-10-21');
  assert.equal(period.period_end, '2026-11-20');
  assert.equal(periodDates(period).length, 31);
  const warnings = uncheckedDatesForMonth([{ work_date: '2026-10-21', status: 'confirmed' }], '2026-11', period);
  assert.equal(warnings.length, 30);
  assert.equal(warnings[0], '2026-10-22');
  assert.equal(warnings.at(-1), '2026-11-20');
});
test('末締め・閏年・年跨ぎ・短い月を正しく解決する', () => {
  assert.equal(periodDates(closingPeriod('2028-02', 'end')).length, 29);
  assert.equal(closingPeriod('2026-01', '20').period_start, '2025-12-21');
  assert.equal(closingPeriod('2026-02', '30').period_end, '2026-02-28');
  assert.equal(closingPeriod('2026-03', '30').period_start, '2026-03-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.throws(() => closingPeriod('2026-13', '20'));
  assert.throws(() => closingPeriod('2026-11', 'bad'));
});
test('既存暦月の次は移行期間で連続させ、締日変更で過去期間を変えない', () => {
  const old = { ...closingPeriod('2026-10', 'end'), period_mode: 'legacy_calendar' };
  const period = resolvePeriod('2026-11', '20', [old]);
  assert.equal(period.period_start, '2026-11-01');
  assert.equal(period.period_end, '2026-11-20');
  assert.equal(period.period_mode, 'transition');
  assert.equal(resolvePeriod('2026-10', '20', [old]).period_end, '2026-10-31');
  assert.equal(resolvePeriod('2026-12', '20', [old, period]).period_start, '2026-11-21');
});
test('締日が遅くなった場合も前期間の翌日から連続する', () => {
  const old = closingPeriod('2026-10', '5');
  const period = resolvePeriod('2026-11', '20', [old]);
  assert.equal(period.period_start, '2026-10-06');
  assert.equal(periodDates(period).length, 46);
});
test('保存済み後続期間との不一致は黙って重複させない', () => {
  assert.throws(() => resolvePeriod('2026-10', '20', [closingPeriod('2026-11', 'end')]));
});
