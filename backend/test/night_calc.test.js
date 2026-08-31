const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseClockMinutes,
  expandPeriods,
  calculateNightSide,
  calculateSideAmounts,
} = require('../src/services/night_calc');

const rounding = {
  time_unit_minutes: 15,
  time_mode: 'floor',
  amount_mode: 'floor',
  amount_stage: 'detail',
};

function rateCell(billing, payment) {
  return { billing, payment, lineIds: {} };
}

const holidayItem = {
  id: 'holiday',
  name: '日祝料金',
  mode: 'weekdays',
  weekdays: { sun: true, holiday: true },
  matrix: {
    daily: {
      basic: rateCell(20000, 15000),
      overtime: rateCell('', ''),
      night: rateCell('', ''),
      night_overtime: rateCell('', ''),
    },
    hourly: {
      basic: rateCell('', ''),
      overtime: rateCell(2000, 1500),
      night: rateCell(2500, 9999),
      night_overtime: rateCell(3000, 2000),
    },
  },
};

test('48時間表記を1分単位で解釈する', () => {
  assert.equal(parseClockMinutes('20:00'), 1200);
  assert.equal(parseClockMinutes('28:00'), 1680);
  assert.equal(parseClockMinutes('47:59'), 2879);
});

test('24時間を超える勤務では深夜帯を繰り返す', () => {
  const periods = expandPeriods([{ start: '22:00', end: '29:00' }], 20 * 60, 47 * 60);
  assert.deepEqual(periods, [
    { start: 22 * 60, end: 29 * 60 },
    { start: 46 * 60, end: 47 * 60 },
  ]);
});

test('通常・超過・深夜・深夜超過を排他的に分類する', () => {
  const result = calculateNightSide({
    start_time: '20:00',
    end_time: '30:00',
    total_break_minutes: 0,
    night_break_minutes: 0,
    night_adjustment_minutes: 0,
    standard_minutes: 480,
    rule: {
      periods: [{ start: '22:00', end: '29:00' }],
      night_mode: 'separate',
      night_overtime_mode: 'separate',
    },
    rounding,
  });
  assert.equal(result.work_minutes, 600);
  assert.equal(result.normal_minutes, 120);
  assert.equal(result.night_minutes, 360);
  assert.equal(result.night_overtime_minutes, 60);
  assert.equal(result.regular_overtime_minutes, 60);
});

test('仕様書の請求40,000円・支払18,500円を再現する', () => {
  const billingClassified = calculateNightSide({
    start_time: '20:00', end_time: '30:00', total_break_minutes: 0,
    standard_minutes: 480,
    rule: { periods: [{ start: '22:00', end: '29:00' }], night_mode: 'separate', night_overtime_mode: 'separate' },
    rounding,
  });
  const paymentClassified = calculateNightSide({
    start_time: '20:00', end_time: '30:00', total_break_minutes: 0,
    standard_minutes: 480,
    rule: { periods: [{ start: '22:00', end: '29:00' }], night_mode: 'included', night_overtime_mode: 'separate' },
    rounding,
  });
  const billing = calculateSideAmounts({ side: 'billing', item: holidayItem, classified: billingClassified, rounding });
  const payment = calculateSideAmounts({ side: 'payment', item: holidayItem, classified: paymentClassified, rounding });
  assert.equal(billing.total, 40000);
  assert.equal(payment.total, 18500);
  assert.equal(payment.details.night.amount, 0);
});

test('深夜休憩控除と理由付き調整を丸め前に反映する', () => {
  const result = calculateNightSide({
    start_time: '20:00',
    end_time: '28:00',
    total_break_minutes: 60,
    night_break_minutes: 30,
    night_adjustment_minutes: 15,
    standard_minutes: 600,
    rule: {
      periods: [{ start: '22:00', end: '29:00' }],
      night_mode: 'separate',
      night_overtime_mode: 'separate',
    },
    rounding,
  });
  assert.equal(result.raw_night_minutes, 360);
  assert.equal(result.adjusted_night_minutes, 345);
  assert.equal(result.night_minutes, 345);
});

test('深夜対象外は深夜時間を保存せず通常へ戻す', () => {
  const result = calculateNightSide({
    start_time: '20:00', end_time: '28:00', total_break_minutes: 0,
    standard_minutes: 600,
    rule: { periods: [{ start: '22:00', end: '29:00' }], night_mode: 'excluded', night_overtime_mode: 'excluded' },
    rounding,
  });
  assert.equal(result.night_minutes, null);
  assert.equal(result.night_overtime_minutes, null);
  assert.equal(result.normal_minutes, 480);
});

test('基本料金に含む深夜時間は時間給の基本数量へ含める', () => {
  const item = {
    matrix: {
      daily: { basic: rateCell('', '') },
      hourly: {
        basic: rateCell(1000, 800),
        overtime: rateCell(0, 0),
        night: rateCell(500, 500),
        night_overtime: rateCell(0, 0),
      },
    },
  };
  const classified = calculateNightSide({
    start_time: '20:00', end_time: '24:00', total_break_minutes: 0,
    standard_minutes: 480,
    rule: { periods: [{ start: '22:00', end: '29:00' }], night_mode: 'included', night_overtime_mode: 'separate' },
    rounding,
  });
  const result = calculateSideAmounts({ side: 'billing', item, classified, rounding });
  assert.equal(result.details.basic.minutes, 240);
  assert.equal(result.details.basic.amount, 4000);
  assert.equal(result.details.night.amount, 0);
});
