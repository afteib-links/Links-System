-- 日報の不足時間・不足控除を請求／支払別に自動計算する

INSERT IGNORE INTO code_masters (category_code, code_value, code_label, sort_order) VALUES
  ('price_type', 'shortage', '不足控除', 25);

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS shortage_minutes_billing INT UNSIGNED NOT NULL DEFAULT 0 AFTER shortage_hours,
  ADD COLUMN IF NOT EXISTS shortage_minutes_payment INT UNSIGNED NOT NULL DEFAULT 0 AFTER shortage_minutes_billing,
  ADD COLUMN IF NOT EXISTS shortage_amount_billing DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER shortage_minutes_payment,
  ADD COLUMN IF NOT EXISTS shortage_amount_payment DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER shortage_amount_billing;
