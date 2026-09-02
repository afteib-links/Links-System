const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_DAILY_REPORT_UI_SETTINGS,
  normalizeDailyReportUiSettings,
} = require('../src/services/daily_report_ui_settings');

test('日報画面設定は未登録時に見やすい既定値を使う', () => {
  assert.deepEqual(normalizeDailyReportUiSettings([]), DEFAULT_DAILY_REPORT_UI_SETTINGS);
});

test('日報画面設定はマスター値を反映する', () => {
  const actual = normalizeDailyReportUiSettings([
    { setting_key: 'daily_report_input_font_size_px', setting_value: '18' },
    { setting_key: 'daily_report_saturday_background_color', setting_value: '#ddeeff' },
    { setting_key: 'daily_report_expense_step', setting_value: '500' },
  ]);
  assert.equal(actual.input_font_size_px, 18);
  assert.equal(actual.saturday_background_color, '#DDEEFF');
  assert.equal(actual.expense_step, 500);
});

test('日報画面設定は危険な色と範囲外の数値を既定値へ戻す', () => {
  const actual = normalizeDailyReportUiSettings([
    { setting_key: 'daily_report_reference_text_color', setting_value: 'red; display:none' },
    { setting_key: 'daily_report_fallback_time_step_minutes', setting_value: '0' },
  ]);
  assert.equal(actual.reference_text_color, DEFAULT_DAILY_REPORT_UI_SETTINGS.reference_text_color);
  assert.equal(actual.fallback_time_step_minutes, DEFAULT_DAILY_REPORT_UI_SETTINGS.fallback_time_step_minutes);
});
