const { query } = require('../db');
const { listPriceSetsForProject } = require('./price_set_lifecycle');
const {
  calculateNightSide,
  calculateSideAmounts,
  parseDurationMinutes,
  validationError,
} = require('./night_calc');
const {
  DEFAULT_SIDE_RULE,
  DEFAULT_ROUNDING,
  parseJson,
  jsWeekdayCode,
  dayTypesForWorkDate,
  resolveFeeItem,
  normalizeConfig,
  nightInputMode,
} = require('./price_calc_config');

const DAY_TYPE_FALLBACK_ORDER = [
  'weekday', 'half', 'sat', 'sun', 'holiday', 'other', 'all',
  'mon', 'tue', 'wed', 'thu', 'fri',
];

function normYmd(d) {
  if (!d) return null;
  return String(d).slice(0, 10) || null;
}

function isPriceSetCandidate(workDate, priceSet) {
  const work = normYmd(workDate);
  const start = normYmd(priceSet.apply_start_date);
  const end = normYmd(priceSet.apply_end_date);
  return Boolean(work && start && start <= work && (!end || work <= end));
}

async function pickPriceSetForDate(projectId, workDate) {
  const sets = await listPriceSetsForProject(projectId);
  const hits = sets.filter((set) => isPriceSetCandidate(workDate, set));
  hits.sort((a, b) => {
    const dateOrder = String(b.apply_start_date || '').localeCompare(String(a.apply_start_date || ''));
    return dateOrder || Number(b.price_set_id) - Number(a.price_set_id);
  });
  return hits[0] || null;
}

function resolvePriceRow(lines, workDate, calcType = 'daily') {
  const dayTypes = [...dayTypesForWorkDate(workDate), ...DAY_TYPE_FALLBACK_ORDER];
  const seen = new Set();
  for (const dayType of dayTypes) {
    if (seen.has(dayType)) continue;
    seen.add(dayType);
    const exact = lines.find(
      (line) => String(line.weekday_code || '') === dayType && String(line.calc_type_code || '') === calcType
    );
    if (exact) return exact;
    const fallback = lines.find((line) => String(line.weekday_code || '') === dayType);
    if (fallback) return fallback;
  }
  return lines[0] || null;
}

function getHourlyRate(dailyPrice, stdRestraintHours, stdBreakMinutes) {
  const net = Math.max(0, Number(stdRestraintHours || 0) - Number(stdBreakMinutes || 0) / 60);
  return net > 0 ? Number(dailyPrice || 0) / net : 0;
}

function emptyCell() {
  return { billing: '', payment: '', lineIds: {} };
}

function legacyFeeItem(lines, workDate) {
  const item = {
    id: 'legacy_auto',
    name: '料金項目',
    mode: 'weekdays',
    weekdays: { [jsWeekdayCode(workDate)]: true },
    matrix: { daily: {}, hourly: {} },
  };
  for (const priceType of ['basic', 'overtime', 'night', 'night_overtime']) {
    for (const calcType of ['daily', 'hourly']) {
      const candidates = lines.filter((line) => String(line.price_type_code || 'basic') === priceType);
      const hit = resolvePriceRow(candidates, workDate, calcType);
      const value = emptyCell();
      if (hit && String(hit.calc_type_code || '') === calcType) {
        value.billing = hit.billing_unit_price;
        value.payment = hit.payment_unit_price;
        value.lineIds.legacy = hit.price_set_line_id;
      }
      item.matrix[calcType][priceType] = value;
    }
  }
  return item;
}

async function loadPriceSetContext(projectId, workDate) {
  const priceSet = await pickPriceSetForDate(projectId, workDate);
  if (!priceSet) return null;
  const lines = await query(
    `SELECT * FROM price_set_lines
     WHERE price_set_id = ? AND is_deleted = 0
     ORDER BY sort_order ASC, price_set_line_id ASC`,
    [Number(priceSet.price_set_id)]
  );
  const extra = parseJson(priceSet.extra_data, {}) || {};
  const items = Array.isArray(extra.fee_items) && extra.fee_items.length
    ? extra.fee_items
    : [legacyFeeItem(lines, workDate)];
  return { priceSet, lines, extra, items, config: normalizeConfig(extra) };
}

async function buildDailyCalculationContext(projectId, workDate, selectedFeeItemId = null, isTraining = false) {
  if (!projectId || !workDate) return null;
  const context = await loadPriceSetContext(projectId, workDate);
  if (!context) return null;
  const resolved = resolveFeeItem(context.items, workDate, selectedFeeItemId, isTraining);
  return {
    price_set_id: context.priceSet.price_set_id,
    price_set_name: context.priceSet.price_set_name,
    selected_fee_item_id: resolved.item?.id || null,
    selected_fee_item_name: resolved.item?.name || null,
    fee_item_selection_source: resolved.source,
    fee_item: resolved.item,
    fee_items: context.items
      .filter((item) => item.mode !== 'distance')
      .map((item) => ({ id: item.id, name: item.name || '料金項目' })),
    ...context.config,
  };
}

function hasOverrides(overrides) {
  return ['billing', 'payment'].some((side) =>
    Object.values(overrides?.[side] || {}).some((value) => value !== '' && value != null)
  );
}

function validateAdjustmentReason(data, side) {
  const adjustment = Number(data[`night_adjustment_minutes_${side}`] || 0);
  const reason = String(data[`night_adjustment_reason_${side}`] || '').trim();
  if (!Number.isInteger(adjustment)) throw validationError('深夜時間調整は1分単位で入力してください');
  if (adjustment !== 0 && !reason) throw validationError('深夜時間を調整する場合は理由を入力してください');
}

async function applyDailyPriceCalc(data) {
  if (!data.project_id || !data.work_date) return data;
  const manuallySelected = data.fee_item_selection_source === 'manual';
  const selectedIdForResolution = manuallySelected ? data.selected_fee_item_id : null;
  const context = await buildDailyCalculationContext(
    data.project_id,
    data.work_date,
    selectedIdForResolution,
    Boolean(Number(data.is_training || 0))
  );
  if (!context || !context.fee_item) {
    data.applied_price_set_id = null;
    data.calculated_billing_amount = 0;
    data.calculated_payment_amount = 0;
    data.calculation_detail = JSON.stringify({
      version: 1,
      warnings: [{ code: 'price_set_missing', message: '適用可能な料金設定がありません' }],
    });
    return data;
  }

  validateAdjustmentReason(data, 'billing');
  validateAdjustmentReason(data, 'payment');
  const overrides = parseJson(data.rate_overrides, {}) || {};
  if (hasOverrides(overrides) && !String(data.rate_override_reason || '').trim()) {
    throw validationError('料金単価等を一時変更する場合は変更理由を入力してください');
  }

  const breakMinutes = parseDurationMinutes(data.break_minutes, data.break_time, '合計休憩時間');
  const sideResults = {};
  const amountResults = {};
  for (const side of ['billing', 'payment']) {
    const classified = calculateNightSide({
      start_time: data.start_time,
      end_time: data.end_time,
      total_break_minutes: breakMinutes,
      night_break_minutes: data[`night_break_minutes_${side}`] || 0,
      night_adjustment_minutes: data[`night_adjustment_minutes_${side}`] || 0,
      standard_minutes: context.work_rules.standard_minutes,
      rule: context.night_rules[side],
      rounding: context.rounding[side],
    });
    sideResults[side] = classified;
    amountResults[side] = calculateSideAmounts({
      side,
      item: context.fee_item,
      classified,
      overrides: overrides[side] || {},
      rounding: context.rounding[side],
    });
  }

  data.applied_price_set_id = context.price_set_id;
  data.selected_fee_item_id = context.selected_fee_item_id;
  data.selected_fee_item_name = context.selected_fee_item_name;
  data.fee_item_selection_source = manuallySelected ? 'manual' : 'auto';
  data.break_minutes = breakMinutes;
  data.break_time = breakMinutes / 60;
  data.binding_hours = sideResults.billing.duration_minutes == null ? null : sideResults.billing.duration_minutes / 60;
  data.work_hours = sideResults.billing.work_minutes / 60;
  data.overtime_hours = sideResults.billing.overtime_minutes / 60;
  data.night_hours = sideResults.billing.night_minutes == null ? null : sideResults.billing.night_minutes / 60;
  data.night_minutes_billing = sideResults.billing.night_minutes;
  data.night_minutes_payment = sideResults.payment.night_minutes;
  data.night_overtime_minutes_billing = sideResults.billing.night_overtime_minutes;
  data.night_overtime_minutes_payment = sideResults.payment.night_overtime_minutes;
  data.regular_overtime_minutes_billing = sideResults.billing.regular_overtime_minutes;
  data.regular_overtime_minutes_payment = sideResults.payment.regular_overtime_minutes;
  data.calculated_billing_amount = amountResults.billing.total;
  data.calculated_payment_amount = amountResults.payment.total;
  data.calculation_detail = JSON.stringify({
    version: 1,
    price_set: { id: context.price_set_id, name: context.price_set_name },
    fee_item: {
      id: context.selected_fee_item_id,
      name: context.selected_fee_item_name,
      selection_source: data.fee_item_selection_source,
    },
    standard_minutes: context.work_rules.standard_minutes,
    night_input_mode: nightInputMode(context),
    available_fee_items: context.fee_items,
    billing: { ...sideResults.billing, amounts: amountResults.billing },
    payment: { ...sideResults.payment, amounts: amountResults.payment },
    rate_override_reason: data.rate_override_reason || null,
  });
  return data;
}

module.exports = {
  applyDailyPriceCalc,
  buildDailyCalculationContext,
  pickPriceSetForDate,
  resolvePriceRow,
  resolveFeeItem,
  normalizeConfig,
  getHourlyRate,
  DAY_TYPE_FALLBACK_ORDER,
  DEFAULT_SIDE_RULE,
  DEFAULT_ROUNDING,
  parseJson,
};
