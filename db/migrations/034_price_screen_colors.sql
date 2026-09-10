-- 金額データ入力画面の曜日・請求額・支払額の表示色
INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_label) VALUES
  ('price_screen_weekday_color', '#34C759', '金額データ：月～金の色'),
  ('price_screen_saturday_color', '#1683EA', '金額データ：土曜の色'),
  ('price_screen_sunday_holiday_color', '#FFB8BD', '金額データ：日曜・祝日の色'),
  ('price_screen_project_holiday_color', '#FF3B46', '金額データ：休の色'),
  ('price_screen_billing_amount_color', '#1D4ED8', '金額データ：請求額の文字色'),
  ('price_screen_payment_amount_color', '#C65D00', '金額データ：支払額の文字色');
