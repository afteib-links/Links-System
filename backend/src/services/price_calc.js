const { query } = require('../db');
const { listPriceSetsForProject } = require('./price_set_lifecycle');

/** 仕様: 平日 → 半日 → 土曜 → 日曜 → 祝日 → その他 */
const DAY_TYPE_FALLBACK_ORDER = [
  'weekday',
  'half',
  'sat',
  'sun',
  'holiday',
  'other',
  'all',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
];

function jsWeekdayCode(workDate) {
  const d = new Date(`${String(workDate).slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDay();
  if (day === 6) return 'sat';
  if (day === 0) return 'sun';
  const map = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[day];
}

function dayTypesForWorkDate(workDate) {
  const code = jsWeekdayCode(workDate);
  const types = [];
  if (code === 'sat') types.push('sat');
  else if (code === 'sun') types.push('sun');
  else types.push('weekday', code);
  return types;
}

function dateInRange(workDate, start, end) {
  const w = String(workDate).slice(0, 10);
  const s = start ? String(start).slice(0, 10) : '1900-01-01';
  const e = end ? String(end).slice(0, 10) : '9999-12-31';
  return w >= s && w <= e;
}

async function pickPriceSetForDate(projectId, workDate) {
  const sets = await listPriceSetsForProject(projectId);
  const hits = sets.filter((ps) => dateInRange(workDate, ps.apply_start_date, ps.apply_end_date));
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const as = String(a.apply_start_date || '').localeCompare(String(b.apply_start_date || ''));
    if (as !== 0) return -as;
    return Number(b.price_set_id) - Number(a.price_set_id);
  });
  return hits[0];
}

function resolvePriceRow(lines, workDate, calcType = 'daily') {
  const tryDayTypes = [...dayTypesForWorkDate(workDate), ...DAY_TYPE_FALLBACK_ORDER];
  const seen = new Set();
  for (const dayType of tryDayTypes) {
    if (seen.has(dayType)) continue;
    seen.add(dayType);
    let row = lines.find(
      (l) => String(l.weekday_code || '') === dayType && String(l.calc_type_code || '') === calcType
    );
    if (row) return row;
    row = lines.find((l) => String(l.weekday_code || '') === dayType);
    if (row) return row;
  }
  return lines[0] || null;
}

function getHourlyRate(dailyPrice, stdRestraintHours, stdBreakMinutes) {
  const net = Math.max(0, Number(stdRestraintHours || 0) - Number(stdBreakMinutes || 0) / 60);
  return net > 0 ? Number(dailyPrice || 0) / net : 0;
}

async function pickLineForDay(priceSetId, workDate) {
  const lines = await query(
    `SELECT * FROM price_set_lines
     WHERE price_set_id = ? AND is_deleted = 0
     ORDER BY sort_order ASC, price_set_line_id ASC`,
    [Number(priceSetId)]
  );
  if (!lines.length) return null;
  return resolvePriceRow(lines, workDate, 'daily');
}

/**
 * 日報1行の計算（最小仮組）
 * - spot_amount があればマスタ無視（useSpotPrice 相当）
 * - それ以外は validFrom/validTo で PriceSet を選択し PriceRow を解決
 */
async function applyDailyPriceCalc(data) {
  const spot = data.spot_amount != null && data.spot_amount !== '' ? Number(data.spot_amount) : null;
  if (spot != null && !Number.isNaN(spot) && spot !== 0) {
    data.applied_price_set_id = null;
    if (data.calculated_billing_amount == null) data.calculated_billing_amount = spot;
    if (data.calculated_payment_amount == null) data.calculated_payment_amount = spot;
    return data;
  }

  if (!data.project_id || !data.work_date) {
    return data;
  }

  const priceSet = await pickPriceSetForDate(data.project_id, data.work_date);
  if (!priceSet) {
    data.applied_price_set_id = null;
    if (data.calculated_billing_amount == null) data.calculated_billing_amount = 0;
    if (data.calculated_payment_amount == null) data.calculated_payment_amount = 0;
    return data;
  }

  data.applied_price_set_id = priceSet.price_set_id;
  const line = await pickLineForDay(priceSet.price_set_id, data.work_date);
  if (line) {
    const billingBase = Number(line.billing_unit_price || 0);
    const paymentBase = Number(line.payment_unit_price || 0);
    if (data.calculated_billing_amount == null) {
      data.calculated_billing_amount = billingBase;
    }
    if (data.calculated_payment_amount == null) {
      data.calculated_payment_amount = paymentBase;
    }
    // 不足時間控除（次段で拘束時間を案件から取得して拡張）
    const workHours = data.work_hours != null ? Number(data.work_hours) : null;
    const binding = data.binding_hours != null ? Number(data.binding_hours) : null;
    const breakH = data.break_time != null ? Number(data.break_time) : 0;
    if (workHours != null && binding != null && workHours < binding - breakH) {
      const hourlyBill = getHourlyRate(billingBase, binding, breakH * 60);
      const hourlyPay = getHourlyRate(paymentBase, binding, breakH * 60);
      if (data.calculated_billing_amount == null || data.calculated_billing_amount === billingBase) {
        data.calculated_billing_amount = Math.round(workHours * hourlyBill * 100) / 100;
      }
      if (data.calculated_payment_amount == null || data.calculated_payment_amount === paymentBase) {
        data.calculated_payment_amount = Math.round(workHours * hourlyPay * 100) / 100;
      }
    }
  } else {
    if (data.calculated_billing_amount == null) data.calculated_billing_amount = 0;
    if (data.calculated_payment_amount == null) data.calculated_payment_amount = 0;
  }
  return data;
}

module.exports = {
  applyDailyPriceCalc,
  pickPriceSetForDate,
  resolvePriceRow,
  DAY_TYPE_FALLBACK_ORDER,
};
