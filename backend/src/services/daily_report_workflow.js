const DAILY_STATUS_TRANSITIONS = {
  draft: ['confirmed'],
  rejected: ['draft', 'confirmed'],
  confirmed: ['rejected', 'draft'],
  approved: [],
};

function canChangeDailyStatus(current, next) {
  return (DAILY_STATUS_TRANSITIONS[current] || []).includes(next);
}

function uncheckedDatesForMonth(reports, targetYearMonth) {
  const [year, month] = String(targetYearMonth || '').split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return [];

  const statusesByDate = new Map();
  for (const row of reports || []) {
    const date = String(row.work_date || '').slice(0, 10);
    if (!date.startsWith(`${targetYearMonth}-`)) continue;
    if (!statusesByDate.has(date)) statusesByDate.set(date, []);
    statusesByDate.get(date).push(String(row.status || ''));
  }

  const confirmedDates = new Set(
    [...statusesByDate.entries()]
      .filter(([, statuses]) => statuses.length > 0 && statuses.every((status) => ['confirmed', 'approved'].includes(status)))
      .map(([date]) => date)
  );
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const unchecked = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${targetYearMonth}-${String(day).padStart(2, '0')}`;
    if (!confirmedDates.has(date)) unchecked.push(date);
  }
  return unchecked;
}

module.exports = {
  DAILY_STATUS_TRANSITIONS,
  canChangeDailyStatus,
  uncheckedDatesForMonth,
};
