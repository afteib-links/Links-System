const EXTRA_FIELDS = ['work_interval', 'reported_overtime', 'reported_excess_distance', 'business_expense', 'alcohol_check', 'confirmation_mark'];
const text = value => String(value ?? '').normalize('NFKC').trim();
function quantity(value, unit) {
  const source = text(value).replaceAll(',', '').replace(new RegExp(`\\s*(?:${unit})\\s*$`, 'i'), '').trim();
  if (!source) return null;
  if (!/^\d+(?:\.\d+)?$/.test(source)) throw new Error('数値と単位を原本で確認してください');
  const number = Number(source);
  if (!Number.isFinite(number) || number > 99999999) throw new Error('数値が範囲外です');
  return number;
}
function documentFields(raw) {
  const normalized = {...raw}, observations = {}, warnings = {};
  const date = text(raw.work_date);
  if (/^[※*＊]+\s*\d/.test(date)) {
    observations.date_annotation = date.match(/^[※*＊]+/)[0];
    normalized.work_date = date.replace(/^[※*＊]+\s*/, '');
  }
  const interval = text(raw.work_interval);
  if (interval) {
    const parts = interval.split(/[~〜～]/);
    if (parts.length === 2 && parts.every(p => /^\s*\d{1,2}\s*[:.]\s*\d{2}\s*$/.test(p))) {
      normalized.start_time = parts[0].replace(/\s/g, '');
      normalized.end_time = parts[1].replace(/\s/g, '');
    } else if (/[0-9a-z]/i.test(interval)) warnings.time = '勤務時間の訂正・開始と終了の区切りを確認してください';
  }
  for (const key of ['start_time','end_time','break_minutes']) {
    if (normalized[key] != null && /^[\s:：~〜～.]*$/.test(text(normalized[key]))) normalized[key] = '';
  }
  for (const [key,unit] of [['reported_overtime','h|時間'],['reported_excess_distance','km|キロ'],['business_expense','円']]) {
    try {
      const number = quantity(raw[key], unit);
      if (number != null && key === 'business_expense' && !Number.isSafeInteger(number)) throw new Error('金額は整数円で確認してください');
      if (number != null && key === 'reported_overtime' && Math.abs(number*60-Math.round(number*60))>1e-6) throw new Error('時間超過は1分単位で確認してください');
      observations[key] = number;
    } catch (e) { observations[key] = null; warnings[key] = e.message; }
  }
  for (const key of ['alcohol_check','confirmation_mark']) {
    const value = text(raw[key]);
    observations[key] = !value ? 'blank' : /^[✓✔☑レvV]$/.test(value) && key === 'alcohol_check' ? 'marked' : 'unknown';
  }
  for (const [key,value] of Object.entries(raw)) if (/^extra_[a-z0-9_]{1,40}$/.test(key)) observations[key] = text(value);
  return {normalized,observations,warnings};
}
module.exports = {EXTRA_FIELDS, documentFields, quantity};
