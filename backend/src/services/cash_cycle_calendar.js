const CYCLE_DAYS = [['05', 5], ['10', 10], ['15', 15], ['20', 20], ['25', 25], ['end', null]];

function asDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return asDate(date);
}

function paddedMonthRange(ym, pad = 14) {
  const [year, month] = String(ym).split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [addUtcDays(`${ym}-01`, -pad), addUtcDays(`${ym}-${String(last).padStart(2, '0')}`, pad)];
}

function paddedDateRange(ymd, pad = 14) {
  return [addUtcDays(ymd, -pad), addUtcDays(ymd, pad)];
}

function businessDate(base, direction, holidays = new Set()) {
  const date = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('日付が不正です');
  const step = direction === 'outgoing' ? -1 : 1;
  let guard = 0;
  while (([0, 6].includes(date.getUTCDay()) || holidays.has(asDate(date))) && guard < 31) {
    date.setUTCDate(date.getUTCDate() + step);
    guard += 1;
  }
  return asDate(date);
}

function normalizeCashDate(requested, direction, defaultYmd, holidays = new Set()) {
  const fallback = String(defaultYmd || '').slice(0, 10);
  const source = /^\d{4}-\d{2}-\d{2}$/.test(String(requested || '')) ? String(requested).slice(0, 10) : fallback;
  const scheduled = businessDate(source, direction, holidays);
  return {
    source,
    scheduled,
    overridden: scheduled !== fallback,
    weekendShifted: scheduled !== source,
  };
}

function cycleDefinitions(ym, holidays = new Set()) {
  const [year, month] = String(ym).split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) throw new Error('対象年月は YYYY-MM で指定してください');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return CYCLE_DAYS.map(([cycleCode, day]) => {
    const baseDate = `${ym}-${String(day || last).padStart(2, '0')}`;
    return {
      cycleCode,
      baseDate,
      plannedIncomingDate: businessDate(baseDate, 'incoming', holidays),
      plannedOutgoingDate: businessDate(baseDate, 'outgoing', holidays),
    };
  });
}

module.exports = {
  CYCLE_DAYS,
  asDate,
  addUtcDays,
  paddedMonthRange,
  paddedDateRange,
  businessDate,
  normalizeCashDate,
  cycleDefinitions,
};
