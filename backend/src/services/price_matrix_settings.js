const DEFAULT_PRICE_MATRIX_SETTINGS = Object.freeze({
  profit_warning_percent: 10,
  overtime_multiplier: 1.25,
  night_multiplier: 1.35,
  night_overtime_multiplier: 1.6,
});

const SETTING_KEYS = Object.freeze({
  profit_warning_percent: 'price_matrix_profit_warning_percent',
  overtime_multiplier: 'price_matrix_overtime_multiplier',
  night_multiplier: 'price_matrix_night_multiplier',
  night_overtime_multiplier: 'price_matrix_night_overtime_multiplier',
});

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
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
  };
}

module.exports = {
  DEFAULT_PRICE_MATRIX_SETTINGS,
  SETTING_KEYS,
  normalizePriceMatrixSettings,
};
