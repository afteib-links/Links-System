-- Issue #42: 契約条件別の距離超過計算と月間結果の一意帰属
ALTER TABLE daily_reports
  MODIFY COLUMN total_distance INT UNSIGNED NULL COMMENT '日報へ直接入力する整数km',
  ADD COLUMN IF NOT EXISTS distance_amount_billing DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_distance,
  ADD COLUMN IF NOT EXISTS distance_amount_payment DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER distance_amount_billing,
  ADD COLUMN IF NOT EXISTS distance_calculation_mode VARCHAR(32) NULL AFTER distance_amount_payment;

CREATE TABLE IF NOT EXISTS daily_report_distance_monthly_results (
  monthly_distance_result_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  target_year_month CHAR(7) NOT NULL,
  side_code ENUM('billing','payment') NOT NULL,
  calculation_version INT UNSIGNED NOT NULL DEFAULT 1,
  result_data JSON NOT NULL,
  calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dr_distance_month_side (project_id, target_year_month, side_code),
  CONSTRAINT fk_dr_distance_month_project FOREIGN KEY (project_id) REFERENCES projects (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
