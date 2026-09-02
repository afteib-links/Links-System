const DEFAULT_DAILY_REPORT_UI_SETTINGS = Object.freeze({
  input_font_size_px: 16,
  reference_text_color: '#A7B0BE',
  saturday_background_color: '#EAF4FF',
  saturday_text_color: '#1D4ED8',
  holiday_background_color: '#FDECEC',
  holiday_text_color: '#B42318',
  fallback_time_step_minutes: 5,
  distance_step: 1,
  expense_step: 100,
});

const SETTING_KEYS = Object.freeze({
  input_font_size_px: 'daily_report_input_font_size_px',
  reference_text_color: 'daily_report_reference_text_color',
  saturday_background_color: 'daily_report_saturday_background_color',
  saturday_text_color: 'daily_report_saturday_text_color',
  holiday_background_color: 'daily_report_holiday_background_color',
  holiday_text_color: 'daily_report_holiday_text_color',
  fallback_time_step_minutes: 'daily_report_fallback_time_step_minutes',
  distance_step: 'daily_report_distance_step',
  expense_step: 'daily_report_expense_step',
});

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function colorValue(value, fallback) {
  const color = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : fallback;
}

function normalizeDailyReportUiSettings(rows = []) {
  const values = new Map((rows || []).map((row) => [row.setting_key, row.setting_value]));
  return {
    input_font_size_px: numberInRange(values.get(SETTING_KEYS.input_font_size_px), DEFAULT_DAILY_REPORT_UI_SETTINGS.input_font_size_px, 12, 24),
    reference_text_color: colorValue(values.get(SETTING_KEYS.reference_text_color), DEFAULT_DAILY_REPORT_UI_SETTINGS.reference_text_color),
    saturday_background_color: colorValue(values.get(SETTING_KEYS.saturday_background_color), DEFAULT_DAILY_REPORT_UI_SETTINGS.saturday_background_color),
    saturday_text_color: colorValue(values.get(SETTING_KEYS.saturday_text_color), DEFAULT_DAILY_REPORT_UI_SETTINGS.saturday_text_color),
    holiday_background_color: colorValue(values.get(SETTING_KEYS.holiday_background_color), DEFAULT_DAILY_REPORT_UI_SETTINGS.holiday_background_color),
    holiday_text_color: colorValue(values.get(SETTING_KEYS.holiday_text_color), DEFAULT_DAILY_REPORT_UI_SETTINGS.holiday_text_color),
    fallback_time_step_minutes: numberInRange(values.get(SETTING_KEYS.fallback_time_step_minutes), DEFAULT_DAILY_REPORT_UI_SETTINGS.fallback_time_step_minutes, 1, 60),
    distance_step: numberInRange(values.get(SETTING_KEYS.distance_step), DEFAULT_DAILY_REPORT_UI_SETTINGS.distance_step, 1, 1000),
    expense_step: numberInRange(values.get(SETTING_KEYS.expense_step), DEFAULT_DAILY_REPORT_UI_SETTINGS.expense_step, 1, 100000),
  };
}

module.exports = {
  DEFAULT_DAILY_REPORT_UI_SETTINGS,
  SETTING_KEYS,
  normalizeDailyReportUiSettings,
};
