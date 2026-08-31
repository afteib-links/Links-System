-- Issue #33: 日報の深夜・深夜超過計算、操作履歴、確認版、月次承認版

INSERT IGNORE INTO code_masters (category_code, code_value, code_label, sort_order) VALUES
  ('price_type', 'night_overtime', '深夜超過', 35);

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS break_minutes INT UNSIGNED NULL AFTER break_time,
  ADD COLUMN IF NOT EXISTS selected_fee_item_id VARCHAR(80) NULL AFTER applied_price_set_id,
  ADD COLUMN IF NOT EXISTS selected_fee_item_name VARCHAR(200) NULL AFTER selected_fee_item_id,
  ADD COLUMN IF NOT EXISTS fee_item_selection_source VARCHAR(16) NOT NULL DEFAULT 'auto' AFTER selected_fee_item_name,
  ADD COLUMN IF NOT EXISTS night_break_minutes_billing INT UNSIGNED NOT NULL DEFAULT 0 AFTER night_hours,
  ADD COLUMN IF NOT EXISTS night_break_minutes_payment INT UNSIGNED NOT NULL DEFAULT 0 AFTER night_break_minutes_billing,
  ADD COLUMN IF NOT EXISTS night_adjustment_minutes_billing INT NOT NULL DEFAULT 0 AFTER night_break_minutes_payment,
  ADD COLUMN IF NOT EXISTS night_adjustment_minutes_payment INT NOT NULL DEFAULT 0 AFTER night_adjustment_minutes_billing,
  ADD COLUMN IF NOT EXISTS night_adjustment_reason_billing VARCHAR(500) NULL AFTER night_adjustment_minutes_payment,
  ADD COLUMN IF NOT EXISTS night_adjustment_reason_payment VARCHAR(500) NULL AFTER night_adjustment_reason_billing,
  ADD COLUMN IF NOT EXISTS night_minutes_billing INT UNSIGNED NULL AFTER night_adjustment_reason_payment,
  ADD COLUMN IF NOT EXISTS night_minutes_payment INT UNSIGNED NULL AFTER night_minutes_billing,
  ADD COLUMN IF NOT EXISTS night_overtime_minutes_billing INT UNSIGNED NULL AFTER night_minutes_payment,
  ADD COLUMN IF NOT EXISTS night_overtime_minutes_payment INT UNSIGNED NULL AFTER night_overtime_minutes_billing,
  ADD COLUMN IF NOT EXISTS regular_overtime_minutes_billing INT UNSIGNED NULL AFTER night_overtime_minutes_payment,
  ADD COLUMN IF NOT EXISTS regular_overtime_minutes_payment INT UNSIGNED NULL AFTER regular_overtime_minutes_billing,
  ADD COLUMN IF NOT EXISTS rate_overrides JSON NULL AFTER regular_overtime_minutes_payment,
  ADD COLUMN IF NOT EXISTS rate_override_reason VARCHAR(500) NULL AFTER rate_overrides,
  ADD COLUMN IF NOT EXISTS calculation_detail JSON NULL AFTER rate_override_reason;

UPDATE daily_reports
SET break_minutes = ROUND(COALESCE(break_time, 0) * 60)
WHERE break_minutes IS NULL;

CREATE TABLE IF NOT EXISTS daily_report_audit_logs (
  audit_log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  daily_report_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(64) NOT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  reason VARCHAR(500) NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dral_report_time (daily_report_id, acted_at),
  KEY idx_dral_actor (actor_user_id),
  CONSTRAINT fk_dral_report FOREIGN KEY (daily_report_id) REFERENCES daily_reports (daily_report_id),
  CONSTRAINT fk_dral_actor FOREIGN KEY (actor_user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_report_confirmation_snapshots (
  confirmation_snapshot_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  daily_report_id BIGINT UNSIGNED NOT NULL,
  confirmation_version INT UNSIGNED NOT NULL,
  snapshot_data JSON NOT NULL,
  confirmed_by_user_id BIGINT UNSIGNED NULL,
  confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_drcs_report_version (daily_report_id, confirmation_version),
  KEY idx_drcs_confirmed_by (confirmed_by_user_id),
  CONSTRAINT fk_drcs_report FOREIGN KEY (daily_report_id) REFERENCES daily_reports (daily_report_id),
  CONSTRAINT fk_drcs_user FOREIGN KEY (confirmed_by_user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_report_monthly_approvals (
  monthly_approval_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  target_year_month CHAR(7) NOT NULL,
  approval_version INT UNSIGNED NOT NULL,
  status ENUM('submitted', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'submitted',
  snapshot_data JSON NOT NULL,
  note VARCHAR(500) NULL,
  submitted_by_user_id BIGINT UNSIGNED NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by_user_id BIGINT UNSIGNED NULL,
  decided_at DATETIME NULL,
  UNIQUE KEY uq_drma_project_month_version (project_id, target_year_month, approval_version),
  KEY idx_drma_project_month (project_id, target_year_month, status),
  CONSTRAINT fk_drma_project FOREIGN KEY (project_id) REFERENCES projects (project_id),
  CONSTRAINT fk_drma_submit_user FOREIGN KEY (submitted_by_user_id) REFERENCES users (user_id),
  CONSTRAINT fk_drma_decide_user FOREIGN KEY (decided_by_user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
