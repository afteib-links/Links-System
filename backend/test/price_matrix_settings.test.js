const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PRICE_MATRIX_SETTINGS,
  SETTING_KEYS,
  normalizePriceMatrixSettings,
} = require('../src/services/price_matrix_settings');

test('料金マトリクス設定は未登録時に既定値を使う', () => {
  assert.deepEqual(normalizePriceMatrixSettings(), DEFAULT_PRICE_MATRIX_SETTINGS);
});

test('料金マトリクス設定は有効な共通設定を読み込む', () => {
  const settings = normalizePriceMatrixSettings([
    { setting_key: SETTING_KEYS.profit_warning_percent, setting_value: '12.5' },
    { setting_key: SETTING_KEYS.overtime_multiplier, setting_value: '1.3' },
    { setting_key: SETTING_KEYS.night_multiplier, setting_value: '1.4' },
    { setting_key: SETTING_KEYS.night_overtime_multiplier, setting_value: '1.7' },
  ]);
  assert.deepEqual(settings, {
    ...DEFAULT_PRICE_MATRIX_SETTINGS,
    profit_warning_percent: 12.5,
    overtime_multiplier: 1.3,
    night_multiplier: 1.4,
    night_overtime_multiplier: 1.7,
  });
});

test('料金マトリクス設定は不正な値を既定値へ戻す', () => {
  const settings = normalizePriceMatrixSettings([
    { setting_key: SETTING_KEYS.profit_warning_percent, setting_value: '101' },
    { setting_key: SETTING_KEYS.overtime_multiplier, setting_value: '-1' },
  ]);
  assert.equal(settings.profit_warning_percent, 10);
  assert.equal(settings.overtime_multiplier, 1.25);
});

test('金額データ画面の色は有効なカラーコードだけを使う', () => {
  const settings = normalizePriceMatrixSettings([
    { setting_key: SETTING_KEYS.billing_amount_color, setting_value: '#123abc' },
    { setting_key: SETTING_KEYS.payment_amount_color, setting_value: 'orange' },
  ]);
  assert.equal(settings.billing_amount_color, '#123ABC');
  assert.equal(settings.payment_amount_color, DEFAULT_PRICE_MATRIX_SETTINGS.payment_amount_color);
});
