const time = require('../../../frontend/js/time-input');
const { periodDates, periodError } = require('./daily_report_periods');

const FIELDS = ['work_date', 'start_time', 'end_time', 'break_minutes', 'total_distance', 'toll_fee', 'parking_fee', 'transport_fee', 'row_comment'];
const SYSTEM_FIELDS = ['applied_price_set_id', 'selected_fee_item_id', 'selected_fee_item_name', 'fee_item_selection_source',
  'break_time', 'break_minutes', 'binding_hours', 'work_hours', 'overtime_hours', 'shortage_hours',
  'shortage_minutes_billing', 'shortage_minutes_payment', 'shortage_amount_billing', 'shortage_amount_payment',
  'distance_amount_billing', 'distance_amount_payment', 'distance_calculation_mode', 'night_hours',
  'night_minutes_billing', 'night_minutes_payment', 'night_overtime_minutes_billing', 'night_overtime_minutes_payment',
  'regular_overtime_minutes_billing', 'regular_overtime_minutes_payment', 'calculated_billing_amount',
  'calculated_payment_amount', 'calculation_detail', 'calculation_rule_set_id', 'calculation_engine_code'];
function json(value, fallback = {}) {
  if (value == null) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}
function validateTemplate(value) {
  if (!value || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 20) throw periodError('様式のページ設定は1〜20ページで指定してください', 400);
  const pages = value.pages.map((page, index) => {
    const number = Number(page.page_number || index + 1);
    const top = Number(page.top), bottom = Number(page.bottom), count = Number(page.row_count);
    const rotation = Number(page.rotation || 0);
    if (!Number.isInteger(number) || number < 1 || number > 20 || ![0, 90, 180, 270].includes(rotation)
      || !(top >= 0 && bottom <= 1 && bottom > top) || !Number.isInteger(count) || count < 1 || count > 100) throw periodError('表の範囲・行数・回転を確認してください', 400);
    const columns = {};
    for (const [key, region] of Object.entries(page.columns || {})) {
      if (!FIELDS.includes(key) || !Array.isArray(region) || region.length !== 2) throw periodError('様式の列指定が不正です', 400);
      const [left, right] = region.map(Number);
      if (!(left >= 0 && right <= 1 && right > left)) throw periodError('列の左端・右端は0〜100%の範囲で指定してください', 400);
      columns[key] = [left, right];
    }
    if (!columns.work_date || !columns.start_time || !columns.end_time) throw periodError('日付・開始・終了の列を指定してください', 400);
    return { page_number: number, top, bottom, row_count: count, rotation, deskew: page.deskew !== false, columns };
  });
  if (new Set(pages.map(p => p.page_number)).size !== pages.length) throw periodError('ページ番号が重複しています', 400);
  return { pages };
}
function normalizeField(key, value) {
  const text = String(value ?? '').normalize('NFKC').trim();
  if (text === '') return null;
  if (key === 'work_date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))
      || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) throw periodError('勤務日は年月日で確認してください', 400);
    return text;
  }
  if (['start_time', 'end_time'].includes(key)) return time.normalize(text, { maxMinutes: 2879 });
  if (key === 'break_minutes') {
    const minutes = typeof value === 'number' ? value : time.parse(text, { maxMinutes: 2879 });
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 2879) throw periodError('休憩時間を確認してください', 400);
    return minutes;
  }
  if (key === 'row_comment') return text.slice(0, 1000);
  const number = Number(text.replaceAll(',', ''));
  if (!Number.isFinite(number) || number < 0 || number > 99999999 || (key !== 'total_distance' && !Number.isInteger(number))) throw periodError('金額は整数円、距離は0以上で入力してください', 400);
  return number;
}
function candidate(raw, confidence, period) {
  const values = {}, warnings = {};
  for (const field of FIELDS) {
    const text = String(raw?.[field] ?? '').normalize('NFKC').trim();
    if (!text) { values[field] = null; continue; }
    try {
      let value = text;
      if (field === 'work_date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const match = text.match(/^(?:(\d{1,2})[\/月.-])?(\d{1,2})日?$/);
        if (!match) throw new Error('日付の文字を原本で確認してください');
        const matches = periodDates(period).filter(d => Number(d.slice(8)) === Number(match[2]) && (!match[1] || Number(d.slice(5, 7)) === Number(match[1])));
        if (matches.length !== 1) throw new Error('日付を一意に決められません');
        value = matches[0];
      }
      values[field] = normalizeField(field, value);
      if (field === 'work_date' && (values[field] < period.period_start || values[field] > period.period_end)) warnings[field] = '対象期間外の日付です';
      if (Number(confidence?.[field] ?? 0) < 0.95) warnings[field] = '読取りが不確かです。原本を確認してください';
    } catch (error) { values[field] = null; warnings[field] = error.message; }
  }
  if (!values.work_date) warnings.work_date ||= '勤務日の確認が必要です';
  if (!values.start_time || !values.end_time) warnings.time = '開始・終了の確認が必要です';
  if (values.start_time && values.end_time && time.parse(values.end_time) <= time.parse(values.start_time)) warnings.end_time = '終了は開始より後の時刻を指定してください。翌日は24時以降で入力します';
  return { values, warnings };
}
function mergeFields(current, request) {
  if (!request || !Array.isArray(request.fields) || (request.clear_fields != null && !Array.isArray(request.clear_fields))
    || !request.values || typeof request.values !== 'object' || Array.isArray(request.values)) throw periodError('反映項目と修正値の形式を確認してください', 400);
  const fields = [...new Set(request.fields || [])];
  const clears = new Set(request.clear_fields || []);
  if (!fields.length || fields.some(key => !FIELDS.includes(key)) || [...clears].some(key => !fields.includes(key) || key === 'work_date')) throw periodError('反映する項目を確認してください', 400);
  const result = { ...current };
  for (const field of fields) {
    const normalized = normalizeField(field, request.values?.[field]);
    if (normalized != null || clears.has(field)) result[field] = clears.has(field) && normalized == null && field === 'break_minutes' ? 0 : normalized;
  }
  if (!result.work_date) throw periodError('勤務日を指定してください', 400);
  if (!result.is_absent && (!result.start_time || !result.end_time)) throw periodError('開始・終了時刻を入力してください', 400);
  if (result.start_time && result.end_time) {
    const duration = time.parse(String(result.end_time).slice(0, 5)) - time.parse(String(result.start_time).slice(0, 5));
    if (duration <= 0 || Number(result.break_minutes || 0) > duration) throw periodError('開始・終了・休憩の前後関係を確認してください', 400);
  }
  return result;
}
function sameFields(a, b) {
  return FIELDS.every(key => {
    const normalized = value => ['start_time', 'end_time'].includes(key) ? String(value || '').slice(0, 5)
      : ['work_date', 'row_comment'].includes(key) ? String(value || '') : Number(value || 0);
    return normalized(a[key]) === normalized(b[key]);
  });
}
module.exports = { FIELDS, SYSTEM_FIELDS, json, validateTemplate, candidate, normalizeField, mergeFields, sameFields };
