const MINUTES_PER_DAY = 24 * 60;
const MAX_CLOCK_MINUTES = 47 * 60 + 59;
const PRICE_TYPES = ['basic', 'overtime', 'night', 'night_overtime'];

function validationError(message, code = 'validation_error') {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

function parseClockMinutes(value, fieldName = '時刻') {
  if (value == null || value === '') return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) throw validationError(`${fieldName}はH:MM形式で入力してください`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour * 60 + minute > MAX_CLOCK_MINUTES) {
    throw validationError(`${fieldName}は0:00～47:59で入力してください`);
  }
  return hour * 60 + minute;
}

function parseDurationMinutes(value, fallbackDecimalHours = null, fieldName = '時間') {
  if (value != null && value !== '') {
    if (typeof value === 'string' && value.includes(':')) {
      const match = value.trim().match(/^(\d{1,3}):(\d{2})$/);
      if (!match || Number(match[2]) > 59) {
        throw validationError(`${fieldName}はH:MM形式で入力してください`);
      }
      return Number(match[1]) * 60 + Number(match[2]);
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw validationError(`${fieldName}が不正です`);
    return Math.round(n);
  }
  if (fallbackDecimalHours != null && fallbackDecimalHours !== '') {
    const n = Number(fallbackDecimalHours);
    if (!Number.isFinite(n) || n < 0) throw validationError(`${fieldName}が不正です`);
    return Math.round(n * 60);
  }
  return 0;
}

function formatMinutes(minutes) {
  if (minutes == null) return null;
  const sign = Number(minutes) < 0 ? '-' : '';
  const abs = Math.abs(Math.round(Number(minutes)));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePeriods(periods) {
  const list = Array.isArray(periods) && periods.length ? periods : [{ start: '22:00', end: '29:00' }];
  return list.map((period, index) => {
    const start = parseClockMinutes(period.start, `深夜帯${index + 1}の開始`);
    let end = parseClockMinutes(period.end, `深夜帯${index + 1}の終了`);
    if (start == null || end == null) throw validationError('深夜帯の開始・終了は必須です');
    if (end <= start) end += MINUTES_PER_DAY;
    if (end - start > MINUTES_PER_DAY) throw validationError('1つの深夜帯は24時間以内にしてください');
    return { start, end, start_text: formatMinutes(start), end_text: formatMinutes(end) };
  });
}

function expandPeriods(periods, workStart, workEnd) {
  const normalized = normalizePeriods(periods);
  const expanded = [];
  for (const period of normalized) {
    const firstRepeat = Math.floor((workStart - period.end) / MINUTES_PER_DAY) - 1;
    const lastRepeat = Math.ceil((workEnd - period.start) / MINUTES_PER_DAY) + 1;
    for (let repeat = firstRepeat; repeat <= lastRepeat; repeat += 1) {
      const start = period.start + repeat * MINUTES_PER_DAY;
      const end = period.end + repeat * MINUTES_PER_DAY;
      if (end <= workStart || start >= workEnd) continue;
      expanded.push({ start: Math.max(start, workStart), end: Math.min(end, workEnd) });
    }
  }
  expanded.sort((a, b) => a.start - b.start || a.end - b.end);
  return expanded.filter((current, index, all) => {
    const previous = all[index - 1];
    return !previous || previous.start !== current.start || previous.end !== current.end;
  });
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function roundMinutes(minutes, unit = 1, mode = 'floor') {
  const safeUnit = Math.max(1, Number(unit) || 1);
  const ratio = Number(minutes || 0) / safeUnit;
  if (mode === 'ceil') return Math.ceil(ratio) * safeUnit;
  if (mode === 'round') return Math.round(ratio) * safeUnit;
  return Math.floor(ratio) * safeUnit;
}

function roundAmount(amount, mode = 'floor') {
  if (mode === 'ceil') return Math.ceil(Number(amount || 0));
  if (mode === 'round') return Math.round(Number(amount || 0));
  return Math.floor(Number(amount || 0));
}

function normalizeSideRule(rule = {}) {
  return {
    periods: normalizePeriods(rule.periods).map((p) => ({ start: p.start_text, end: p.end_text })),
    night_mode: ['separate', 'included', 'excluded'].includes(rule.night_mode)
      ? rule.night_mode
      : 'separate',
    night_overtime_mode: ['separate', 'included', 'excluded'].includes(rule.night_overtime_mode)
      ? rule.night_overtime_mode
      : 'separate',
  };
}

function calculateNightSide(input) {
  const start = parseClockMinutes(input.start_time, '開始時刻');
  const end = parseClockMinutes(input.end_time, '終了時刻');
  if (start == null || end == null) {
    return {
      start_minutes: start,
      end_minutes: end,
      work_minutes: 0,
      normal_minutes: 0,
      overtime_minutes: 0,
      regular_overtime_minutes: 0,
      night_minutes: 0,
      night_overtime_minutes: 0,
      warnings: [],
    };
  }
  if (end <= start) throw validationError('終了時刻は開始時刻より後にしてください。翌日は24時を加えた時刻で入力してください');

  const totalBreak = parseDurationMinutes(input.total_break_minutes, input.break_time, '合計休憩時間');
  const nightBreak = parseDurationMinutes(input.night_break_minutes, null, '深夜帯内休憩時間');
  if (nightBreak > totalBreak) throw validationError('深夜帯内休憩時間は合計休憩時間以下にしてください');

  const duration = end - start;
  if (totalBreak > duration) throw validationError('合計休憩時間は拘束時間以下にしてください');
  const workMinutes = Math.max(0, duration - totalBreak);
  const standardMinutes = Math.max(0, Number(input.standard_minutes ?? 480));
  const overtimeMinutes = Math.max(0, workMinutes - standardMinutes);
  const overtimeStart = end - overtimeMinutes;
  const rule = normalizeSideRule(input.rule);
  const shouldDetect = rule.night_mode !== 'excluded' || rule.night_overtime_mode !== 'excluded';
  const intersections = shouldDetect ? expandPeriods(rule.periods, start, end) : [];
  const rawNight = intersections.reduce((sum, interval) => sum + interval.end - interval.start, 0);
  const adjustment = Number(input.night_adjustment_minutes || 0);
  if (!Number.isInteger(adjustment)) throw validationError('深夜時間調整は1分単位で入力してください');
  let adjustedNight = clamp(rawNight - nightBreak + adjustment, 0, workMinutes);
  let nightOvertime = intersections.reduce(
    (sum, interval) => sum + overlapMinutes(interval.start, interval.end, overtimeStart, end),
    0
  );
  nightOvertime = clamp(nightOvertime, 0, Math.min(adjustedNight, overtimeMinutes));
  let night = Math.max(0, adjustedNight - nightOvertime);
  let regularOvertime = Math.max(0, overtimeMinutes - nightOvertime);
  let normal = Math.max(0, workMinutes - regularOvertime - night - nightOvertime);

  const storedNight = rule.night_mode === 'excluded' ? null : night;
  const storedNightOvertime = rule.night_overtime_mode === 'excluded' ? null : nightOvertime;
  if (rule.night_mode === 'excluded') {
    normal += night;
    night = 0;
  }
  if (rule.night_overtime_mode === 'excluded') {
    regularOvertime += nightOvertime;
    nightOvertime = 0;
  }

  const rounding = input.rounding || {};
  const unit = Number(rounding.time_unit_minutes || 1);
  const mode = rounding.time_mode || 'floor';
  const rounded = {
    normal_minutes: roundMinutes(normal, unit, mode),
    regular_overtime_minutes: roundMinutes(regularOvertime, unit, mode),
    night_minutes: rule.night_mode === 'excluded' ? null : roundMinutes(night, unit, mode),
    night_overtime_minutes:
      rule.night_overtime_mode === 'excluded' ? null : roundMinutes(nightOvertime, unit, mode),
  };
  const warnings = [];
  if (rawNight > 0 && totalBreak > 0 && nightBreak === 0) {
    warnings.push({ code: 'night_break_zero', message: '深夜帯と勤務が重なっていますが、深夜帯内休憩時間が0:00です' });
  }

  return {
    start_minutes: start,
    end_minutes: end,
    duration_minutes: duration,
    total_break_minutes: totalBreak,
    night_break_minutes: nightBreak,
    work_minutes: workMinutes,
    standard_minutes: standardMinutes,
    overtime_minutes: overtimeMinutes,
    raw_night_minutes: rawNight,
    night_adjustment_minutes: adjustment,
    adjusted_night_minutes: adjustedNight,
    raw_stored_night_minutes: storedNight,
    raw_stored_night_overtime_minutes: storedNightOvertime,
    intersections: intersections.map((p) => ({ start: formatMinutes(p.start), end: formatMinutes(p.end) })),
    modes: { night: rule.night_mode, night_overtime: rule.night_overtime_mode },
    rounding: { time_unit_minutes: unit, time_mode: mode },
    ...rounded,
    warnings,
  };
}

function hasCellValue(value) {
  return value !== '' && value != null && Number.isFinite(Number(value));
}

function rateFor(item, priceType, side) {
  const preferred = priceType === 'basic' ? ['daily', 'hourly'] : ['hourly', 'daily'];
  for (const calcType of preferred) {
    const cell = item?.matrix?.[calcType]?.[priceType];
    const value = cell?.[side];
    if (hasCellValue(value)) return { calc_type: calcType, rate: Number(value) };
  }
  return { calc_type: preferred[0], rate: 0 };
}

function calculateSideAmounts({ side, item, classified, overrides = {}, rounding = {} }) {
  const includedInBasicMinutes =
    (classified.modes?.night === 'included' ? Number(classified.night_minutes || 0) : 0) +
    (classified.modes?.night_overtime === 'included' ? Number(classified.night_overtime_minutes || 0) : 0);
  const minutesByType = {
    basic: Number(classified.normal_minutes || 0) + includedInBasicMinutes,
    overtime: classified.regular_overtime_minutes,
    night: classified.night_minutes,
    night_overtime: classified.night_overtime_minutes,
  };
  const modes = {
    basic: 'separate',
    overtime: 'separate',
    night: classified.modes?.night || 'separate',
    night_overtime: classified.modes?.night_overtime || 'separate',
  };
  const details = {};
  let rawTotal = 0;
  for (const priceType of PRICE_TYPES) {
    const configured = rateFor(item, priceType, side);
    const override = overrides?.[priceType];
    const rate = hasCellValue(override) ? Number(override) : configured.rate;
    const minutes = minutesByType[priceType];
    const mode = modes[priceType];
    let rawAmount = 0;
    if (mode === 'separate' && minutes != null) {
      rawAmount =
        configured.calc_type === 'daily'
          ? priceType === 'basic'
            ? Number(classified.work_minutes || 0) > 0
              ? rate
              : 0
            : Number(minutes) > 0
              ? rate
              : 0
          : rate * (Number(minutes) / 60);
    }
    const amount = rounding.amount_stage === 'detail' ? roundAmount(rawAmount, rounding.amount_mode) : rawAmount;
    rawTotal += amount;
    details[priceType] = {
      mode,
      calc_type: configured.calc_type,
      minutes,
      rate,
      original_rate: configured.rate,
      overridden: hasCellValue(override),
      raw_amount: rawAmount,
      amount,
    };
  }
  const total = rounding.amount_stage === 'day' ? roundAmount(rawTotal, rounding.amount_mode) : rawTotal;
  return { details, raw_total: rawTotal, total };
}

module.exports = {
  MINUTES_PER_DAY,
  MAX_CLOCK_MINUTES,
  PRICE_TYPES,
  parseClockMinutes,
  parseDurationMinutes,
  formatMinutes,
  normalizePeriods,
  expandPeriods,
  overlapMinutes,
  roundMinutes,
  roundAmount,
  normalizeSideRule,
  calculateNightSide,
  rateFor,
  calculateSideAmounts,
  validationError,
};
