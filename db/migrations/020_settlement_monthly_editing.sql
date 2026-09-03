-- Issue #54: 月額集約明細、編集履歴、前払3グループ

ALTER TABLE settlement_lines
  MODIFY COLUMN quantity DECIMAL(12,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS display_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER settlement_id,
  ADD COLUMN IF NOT EXISTS is_manually_added TINYINT(1) NOT NULL DEFAULT 0 AFTER reason,
  ADD COLUMN IF NOT EXISTS is_manually_edited TINYINT(1) NOT NULL DEFAULT 0 AFTER is_manually_added,
  ADD COLUMN IF NOT EXISTS amount_overridden TINYINT(1) NOT NULL DEFAULT 0 AFTER is_manually_edited,
  ADD COLUMN IF NOT EXISTS status ENUM('active','cancelled') NOT NULL DEFAULT 'active' AFTER amount_overridden,
  ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 1 AFTER status,
  ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL AFTER version,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id BIGINT UNSIGNED NULL AFTER cancelled_at,
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500) NULL AFTER cancelled_by_user_id;

CREATE TABLE IF NOT EXISTS settlement_line_sources (
  settlement_line_source_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_line_id BIGINT UNSIGNED NOT NULL,
  daily_report_id BIGINT UNSIGNED NOT NULL,
  monthly_approval_id BIGINT UNSIGNED NOT NULL,
  source_component VARCHAR(64) NOT NULL,
  quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  snapshot_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_settlement_line_source (settlement_line_id, daily_report_id, source_component),
  KEY idx_settlement_source_report (daily_report_id),
  CONSTRAINT fk_sls_line FOREIGN KEY (settlement_line_id) REFERENCES settlement_lines(settlement_line_id),
  CONSTRAINT fk_sls_report FOREIGN KEY (daily_report_id) REFERENCES daily_reports(daily_report_id),
  CONSTRAINT fk_sls_approval FOREIGN KEY (monthly_approval_id) REFERENCES daily_report_monthly_approvals(monthly_approval_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_line_audit_logs (
  settlement_line_audit_log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_line_id BIGINT UNSIGNED NOT NULL,
  action_code ENUM('create','update','cancel','restore','reorder','source_refresh') NOT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  reason VARCHAR(500) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sla_line_time (settlement_line_id, acted_at),
  CONSTRAINT fk_sla_line FOREIGN KEY (settlement_line_id) REFERENCES settlement_lines(settlement_line_id),
  CONSTRAINT fk_sla_user FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE advance_records
  ADD COLUMN IF NOT EXISTS target_year_month CHAR(7) NULL AFTER company_id,
  ADD COLUMN IF NOT EXISTS group_code ENUM('early','middle','late') NULL AFTER target_year_month,
  ADD COLUMN IF NOT EXISTS payment_date DATE NULL AFTER period_end,
  ADD COLUMN IF NOT EXISTS transfer_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER advance_amount,
  ADD COLUMN IF NOT EXISTS version INT UNSIGNED NOT NULL DEFAULT 1 AFTER adjustment_reason,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD KEY IF NOT EXISTS idx_advance_target_group (target_year_month, group_code, status);

ALTER TABLE advance_payment_allocations
  ADD COLUMN IF NOT EXISTS transfer_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER amount;

CREATE TABLE IF NOT EXISTS advance_record_audit_logs (
  advance_record_audit_log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  advance_record_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  reason VARCHAR(500) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_advance_audit (advance_record_id, acted_at),
  CONSTRAINT fk_ara_record FOREIGN KEY (advance_record_id) REFERENCES advance_records(advance_record_id),
  CONSTRAINT fk_ara_user FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
