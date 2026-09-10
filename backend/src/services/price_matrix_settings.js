const DEFAULT_PRICE_MATRIX_SETTINGS = Object.freeze({
  profit_warning_percent: 10,
  overtime_multiplier: 1.25,
  night_multiplier: 1.35,
  night_overtime_multiplier: 1.6,
  weekday_color: '#34C759',
  saturday_color: '#1683EA',
  sunday_holiday_color: '#FFB8BD',
  project_holiday_color: '#FF3B46',
  billing_amount_color: '#1D4ED8',
  payment_amount_color: '#C65D00',
});

const SETTING_KEYS = Object.freeze({
  profit_warning_percent: 'price_matrix_profit_warning_percent',
  overtime_multiplier: 'price_matrix_overtime_multiplier',
  night_multiplier: 'price_matrix_night_multiplier',
  night_overtime_multiplier: 'price_matrix_night_overtime_multiplier',
  weekday_color: 'price_screen_weekday_color',
  saturday_color: 'price_screen_saturday_color',
  sunday_holiday_color: 'price_screen_sunday_holiday_color',
  project_holiday_color: 'price_screen_project_holiday_color',
  billing_amount_color: 'price_screen_billing_amount_color',
  payment_amount_color: 'price_screen_payment_amount_color',
});

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function colorValue(value, fallback) {
  const color = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : fallback;
}

function normalizePriceMatrixSettings(rows = []) {
  const values = new Map((rows || []).map((row) => [row.setting_key, row.setting_value]));
  return {
    profit_warning_percent: numberInRange(
      values.get(SETTING_KEYS.profit_warning_percent),
      DEFAULT_PRICE_MATRIX_SETTINGS.profit_warning_percent,
      0,
      100
    ),
    overtime_multiplier: numberInRange(
      values.get(SETTING_KEYS.overtime_multiplier),
      DEFAULT_PRICE_MATRIX_SETTINGS.overtime_multiplier,
      0,
      100
    ),
    night_multiplier: numberInRange(
      values.get(SETTING_KEYS.night_multiplier),
      DEFAULT_PRICE_MATRIX_SETTINGS.night_multiplier,
      0,
      100
    ),
    night_overtime_multiplier: numberInRange(
      values.get(SETTING_KEYS.night_overtime_multiplier),
      DEFAULT_PRICE_MATRIX_SETTINGS.night_overtime_multiplier,
      0,
      100
    ),
    weekday_color: colorValue(values.get(SETTING_KEYS.weekday_color), DEFAULT_PRICE_MATRIX_SETTINGS.weekday_color),
    saturday_color: colorValue(values.get(SETTING_KEYS.saturday_color), DEFAULT_PRICE_MATRIX_SETTINGS.saturday_color),
    sunday_holiday_color: colorValue(values.get(SETTING_KEYS.sunday_holiday_color), DEFAULT_PRICE_MATRIX_SETTINGS.sunday_holiday_color),
    project_holiday_color: colorValue(values.get(SETTING_KEYS.project_holiday_color), DEFAULT_PRICE_MATRIX_SETTINGS.project_holiday_color),
    billing_amount_color: colorValue(values.get(SETTING_KEYS.billing_amount_color), DEFAULT_PRICE_MATRIX_SETTINGS.billing_amount_color),
    payment_amount_color: colorValue(values.get(SETTING_KEYS.payment_amount_color), DEFAULT_PRICE_MATRIX_SETTINGS.payment_amount_color),
  };
}

module.exports = {
  DEFAULT_PRICE_MATRIX_SETTINGS,
  SETTING_KEYS,
  normalizePriceMatrixSettings,
};
