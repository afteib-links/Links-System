const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFeeItem, normalizeConfig, nightInputMode } = require('../src/services/price_calc_config');

test('曜日条件から料金区分を自動選択し、手動選択を優先する', () => {
  const items = [
    { id: 'weekday', name: '通常料金', mode: 'weekdays', weekdays: { mon: true } },
    { id: 'holiday', name: '日祝料金', mode: 'weekdays', weekdays: { sun: true, holiday: true } },
  ];
  const automatic = resolveFeeItem(items, '2026-08-31', null, false);
  assert.equal(automatic.item.id, 'weekday');
  assert.equal(automatic.source, 'auto');
  const manual = resolveFeeItem(items, '2026-08-31', 'holiday', false);
  assert.equal(manual.item.id, 'holiday');
  assert.equal(manual.source, 'manual');
});

test('新規案件相当の深夜帯・丸め既定値を補完する', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config.night_rules.billing.periods, [{ start: '22:00', end: '29:00' }]);
  assert.deepEqual(config.night_rules.payment.periods, [{ start: '22:00', end: '29:00' }]);
  assert.equal(config.rounding.billing.time_unit_minutes, 15);
  assert.equal(config.rounding.billing.time_mode, 'floor');
  assert.equal(config.rounding.billing.amount_stage, 'detail');
  assert.equal(config.work_rules.standard_minutes, 480);
});

test('請求側と支払側の深夜条件を独立して保持する', () => {
  const config = normalizeConfig({
    night_rules: {
      billing: { periods: [{ start: '21:00', end: '28:00' }], night_mode: 'separate' },
      payment: { periods: [{ start: '23:00', end: '30:00' }], night_mode: 'included' },
    },
  });
  assert.equal(config.night_rules.billing.periods[0].start, '21:00');
  assert.equal(config.night_rules.payment.periods[0].start, '23:00');
  assert.equal(config.night_rules.payment.night_mode, 'included');
  assert.equal(nightInputMode(config), 'split');
});

test('請求側と支払側の深夜条件が同一なら共通入力と判定する', () => {
  const config = normalizeConfig({});
  assert.equal(nightInputMode(config), 'shared');
});
