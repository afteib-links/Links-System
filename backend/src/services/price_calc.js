const { query } = require('../db');
const { listPriceSetsForProject } = require('./price_set_lifecycle');

const WEEKDAY_FALLBACK = ['all', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function jsWeekdayCode(workDate) {
  const d = new Date(`${String(workDate).slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDay();
  if (day === 6) return 'sat';
  if (day === 0) return 'sun';
  const map = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[day];
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
  // 期間が狭い（より新しい開始）を優先
  hits.sort((a, b) => {
    const as = String(a.apply_start_date || '').localeCompare(String(b.apply_start_date || ''));
    if (as !== 0) return -as;
    return Number(b.price_set_id) - Number(a.price_set_id);
  });
  return hits[0];
}

async function pickLineForDay(priceSetId, workDate) {
  const lines = await query(
    `SELECT * FROM price_set_lines
     WHERE price_set_id = ? AND is_deleted = 0
     ORDER BY sort_order ASC, price_set_line_id ASC`,
    [Number(priceSetId)]
  );
  if (!lines.length) return null;
  const dayCode = jsWeekdayCode(workDate);
  const tryKeys = [dayCode, ...WEEKDAY_FALLBACK.filter((k) => k !== dayCode)];
  for (const key of tryKeys) {
    const hit = lines.find((l) => String(l.weekday_code || '') === key);
    if (hit) return hit;
  }
  return lines[0];
}

/**
 * 日報1行の計算（最小仮組）
 * - spot_amount があればマスタ無視
 * - それ以外は案件紐づき PriceSet から基本単価
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
    if (data.calculated_billing_amount == null) {
      data.calculated_billing_amount = Number(line.billing_unit_price || 0);
    }
    if (data.calculated_payment_amount == null) {
      data.calculated_payment_amount = Number(line.payment_unit_price || 0);
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
};
