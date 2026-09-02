const CYCLE_DAYS = [['05', 5], ['10', 10], ['15', 15], ['20', 20], ['25', 25], ['end', null]];

function asDate(date) {
  return date.toISOString().slice(0, 10);
}

function businessDate(base, direction, holidays = new Set()) {
  const date = new Date(`${base}T00:00:00Z`);
  const step = direction === 'outgoing' ? -1 : 1;
  while ([0, 6].includes(date.getUTCDay()) || holidays.has(asDate(date))) {
    date.setUTCDate(date.getUTCDate() + step);
  }
  return asDate(date);
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

module.exports = { CYCLE_DAYS, asDate, businessDate, cycleDefinitions };
