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

test('登録休日は実際の曜日より休日料金を優先し、手動選択はさらに優先する', () => {
  const items = [
    { id: 'weekday', name: '通常料金', mode: 'weekdays', weekdays: { weekday: true } },
    { id: 'holiday', name: '休日料金', mode: 'weekdays', weekdays: { holiday: true } },
  ];
  const automatic = resolveFeeItem(items, '2026-09-01', null, false, true);
  assert.equal(automatic.item.id, 'holiday');
  assert.equal(automatic.source, 'auto');
  const manual = resolveFeeItem(items, '2026-09-01', 'weekday', false, true);
  assert.equal(manual.item.id, 'weekday');
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
  assert.equal(config.work_rules.billing.standard_minutes, 480);
  assert.equal(config.work_rules.payment.standard_minutes, 480);
});

test('不足計算の基準時間を請求・支払で分けて保持する', () => {
  const config = normalizeConfig({
    work_rules: {
      standard_minutes: 480,
      billing: { standard_minutes: 450 },
      payment: { standard_minutes: 540 },
    },
  });
  assert.equal(config.work_rules.billing.standard_minutes, 450);
  assert.equal(config.work_rules.payment.standard_minutes, 540);
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

test('計算未対応の料金項目は日報計算の自動・手動選択から除外する', () => {
  const items = [
    { id:'custom', name:'独自料金', mode:'weekdays', calc_types:['custom'], weekdays:{ mon:true }, matrix:{ custom:{} } },
    { id:'daily', name:'通常料金', mode:'weekdays', calc_types:['daily'], weekdays:{ mon:true }, matrix:{ daily:{} } },
  ];
  assert.equal(resolveFeeItem(items, '2026-08-31', null, false).item.id, 'daily');
  assert.equal(resolveFeeItem(items, '2026-08-31', 'custom', false).item.id, 'daily');
});
