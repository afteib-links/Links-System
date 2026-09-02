const DEFAULT_SIDE_RULE = {
  periods: [{ start: '22:00', end: '29:00' }],
  night_mode: 'separate',
  night_overtime_mode: 'separate',
};

const DEFAULT_ROUNDING = {
  time_unit_minutes: 15,
  time_mode: 'floor',
  amount_mode: 'floor',
  amount_stage: 'detail',
};

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function jsWeekdayCode(workDate) {
  const d = new Date(`${String(workDate).slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDay();
  if (day === 6) return 'sat';
  if (day === 0) return 'sun';
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day];
}

function dayTypesForWorkDate(workDate, isHoliday = false) {
  if (isHoliday) return ['holiday'];
  const code = jsWeekdayCode(workDate);
  if (code === 'sat') return ['sat'];
  if (code === 'sun') return ['sun'];
  return ['weekday', code];
}

function feeItemMatchesDate(item, workDate, isHoliday = false) {
  if (!item || item.mode === 'distance') return false;
  if (isHoliday) return Boolean(item.weekdays?.holiday || item.weekdays?.all);
  const weekday = jsWeekdayCode(workDate);
  return Boolean(
    item.weekdays?.[weekday] ||
    item.weekdays?.all ||
    (item.weekdays?.weekday && !['sat', 'sun'].includes(weekday))
  );
}

function resolveFeeItem(items, workDate, selectedId, isTraining = false, isHoliday = false) {
  if (selectedId) {
    const selected = items.find((item) => String(item.id) === String(selectedId));
    if (selected) return { item: selected, source: 'manual' };
  }
  if (isTraining) {
    const training = items.find((item) => String(item.name || '').includes('研修'));
    if (training) return { item: training, source: 'auto' };
  }
  const matched = items.find((item) => feeItemMatchesDate(item, workDate, isHoliday));
  return { item: matched || items.find((item) => item.mode !== 'distance') || null, source: 'auto' };
}

function normalizeConfig(extraData) {
  const extra = parseJson(extraData, {}) || {};
  const legacyStandardMinutes = Math.max(0, Number(extra.work_rules?.standard_minutes ?? 480));
  return {
    night_rules: {
      billing: { ...DEFAULT_SIDE_RULE, ...(extra.night_rules?.billing || {}) },
      payment: { ...DEFAULT_SIDE_RULE, ...(extra.night_rules?.payment || {}) },
    },
    rounding: {
      billing: { ...DEFAULT_ROUNDING, ...(extra.rounding?.billing || {}) },
      payment: { ...DEFAULT_ROUNDING, ...(extra.rounding?.payment || {}) },
    },
    work_rules: {
      standard_minutes: legacyStandardMinutes,
      billing: {
        standard_minutes: Math.max(
          0,
          Number(extra.work_rules?.billing?.standard_minutes ?? legacyStandardMinutes)
        ),
      },
      payment: {
        standard_minutes: Math.max(
          0,
          Number(extra.work_rules?.payment?.standard_minutes ?? legacyStandardMinutes)
        ),
      },
    },
  };
}

function nightInputMode(config) {
  const billing = config?.night_rules?.billing || DEFAULT_SIDE_RULE;
  const payment = config?.night_rules?.payment || DEFAULT_SIDE_RULE;
  return JSON.stringify(billing) === JSON.stringify(payment) ? 'shared' : 'split';
}

module.exports = {
  DEFAULT_SIDE_RULE,
  DEFAULT_ROUNDING,
  parseJson,
  jsWeekdayCode,
  dayTypesForWorkDate,
  feeItemMatchesDate,
  resolveFeeItem,
  normalizeConfig,
  nightInputMode,
};
