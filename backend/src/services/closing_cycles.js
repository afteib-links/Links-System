const GROUPS = {
  early: { number: 1, label: '5日・10日締め', paymentCycle: '20', paymentMonthOffset: 0 },
  middle: { number: 2, label: '15日・20日締め', paymentCycle: 'end', paymentMonthOffset: 0 },
  late: { number: 3, label: '25日・末日締め', paymentCycle: '10', paymentMonthOffset: 1 },
};
const GROUP_ORDER = ['early', 'middle', 'late'];
const FIVE_DAY_TRACK = new Set(['5', '15', '25']);
const TEN_DAY_TRACK = new Set(['10', '20', 'end']);
const VALID_CLOSINGS = new Set([...FIVE_DAY_TRACK, ...TEN_DAY_TRACK]);

function shiftMonth(ym, offset) {
  const [year, month] = String(ym).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dateText(date) {
  return date.toISOString().slice(0, 10);
}

function monthDay(ym, day) {
  const [year, month] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return dateText(new Date(Date.UTC(year, month - 1, day === 'end' ? last : Number(day))));
}

function addUtcDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('日付が不正です');
  date.setUTCDate(date.getUTCDate() + days);
  return dateText(date);
}

function periodForCycle(ym, closing, groupCode) {
  if (!GROUPS[groupCode]) throw new Error('前払サイクルが不正です');
  const value = String(closing || '');
  if (!VALID_CLOSINGS.has(value)) throw new Error('案件の締日が不正です');
  if (FIVE_DAY_TRACK.has(value)) {
    if (groupCode === 'early') return { start: monthDay(shiftMonth(ym, -1), 26), end: monthDay(ym, 5) };
    if (groupCode === 'middle') return { start: monthDay(ym, 6), end: monthDay(ym, 15) };
    return { start: monthDay(ym, 16), end: monthDay(ym, 25) };
  }
  if (groupCode === 'early') return { start: monthDay(ym, 1), end: monthDay(ym, 10) };
  if (groupCode === 'middle') return { start: monthDay(ym, 11), end: monthDay(ym, 20) };
  return { start: monthDay(ym, 21), end: monthDay(ym, 'end') };
}

function periodFor(ym, closing) {
  const groupCode = FIVE_DAY_TRACK.has(String(closing))
    ? ({ 5: 'early', 15: 'middle', 25: 'late' })[String(closing)]
    : ({ 10: 'early', 20: 'middle', end: 'late' })[String(closing)];
  return periodForCycle(ym, closing, groupCode);
}

function todayJst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

function parseGraceDays(value, { strict = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 30) {
    if (strict) throw new Error('猶予日は0〜30の整数で指定してください');
    return 1;
  }
  return number;
}

function parseOverdueDays(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 365) {
    throw new Error('遅延日数は0〜365の整数で指定してください');
  }
  return number;
}

function baseSubmitDate(periodEnd) {
  return addUtcDays(String(periodEnd).slice(0, 10), 1);
}

function deadlineDate(plannedSubmitDate, graceDays) {
  return addUtcDays(String(plannedSubmitDate).slice(0, 10), parseGraceDays(graceDays));
}

function calendarDiffDays(fromYmd, toYmd) {
  const from = new Date(`${fromYmd}T00:00:00Z`);
  const to = new Date(`${toYmd}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function overdueDays({ submitted, submittedDate, deadline, today }) {
  const asOf = submitted ? String(submittedDate || '').slice(0, 10) : String(today || '').slice(0, 10);
  const limit = String(deadline || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !/^\d{4}-\d{2}-\d{2}$/.test(limit)) return 0;
  const days = calendarDiffDays(limit, asOf);
  return days > 0 ? days : 0;
}

module.exports = {
  GROUPS,
  GROUP_ORDER,
  FIVE_DAY_TRACK,
  TEN_DAY_TRACK,
  VALID_CLOSINGS,
  shiftMonth,
  dateText,
  monthDay,
  addUtcDays,
  periodForCycle,
  periodFor,
  todayJst,
  parseGraceDays,
  parseOverdueDays,
  baseSubmitDate,
  deadlineDate,
  calendarDiffDays,
  overdueDays,
};
