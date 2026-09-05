-- 先払3サイクル・手数料マスター

CREATE TABLE IF NOT EXISTS transfer_fee_patterns (
  transfer_fee_pattern_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pattern_name VARCHAR(100) NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS transfer_fee_pattern_id BIGINT UNSIGNED NULL AFTER installment_amount,
  ADD KEY IF NOT EXISTS idx_project_transfer_fee_pattern (transfer_fee_pattern_id);

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS transfer_fee_pattern_id BIGINT UNSIGNED NULL AFTER partner_name_kana,
  ADD KEY IF NOT EXISTS idx_partner_transfer_fee_pattern (transfer_fee_pattern_id);

CREATE TABLE IF NOT EXISTS advance_cycle_settings (
  advance_cycle_setting_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target_year_month CHAR(7) NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  group_code ENUM('early','middle','late') NOT NULL,
  is_target TINYINT(1) NOT NULL DEFAULT 1,
  advance_amount_override DECIMAL(12,2) NULL,
  transfer_fee_override DECIMAL(12,2) NULL,
  adjustment_reason VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_advance_cycle_setting (target_year_month, project_id, group_code),
  KEY idx_advance_cycle_setting_project (project_id),
  CONSTRAINT fk_advance_cycle_setting_project FOREIGN KEY (project_id) REFERENCES projects(project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advance_cycle_setting_audit_logs (
  advance_cycle_setting_audit_log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  advance_cycle_setting_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  reason VARCHAR(500) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_advance_cycle_setting_audit (advance_cycle_setting_id, acted_at),
  CONSTRAINT fk_acsa_setting FOREIGN KEY (advance_cycle_setting_id) REFERENCES advance_cycle_settings(advance_cycle_setting_id),
  CONSTRAINT fk_acsa_user FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE advance_records
  MODIFY COLUMN project_advance_term_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN status ENUM('unplanned','planned','exported','held','cancelled','executed') NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS transfer_fee_pattern_id BIGINT UNSIGNED NULL AFTER transfer_fee_amount,
  ADD COLUMN IF NOT EXISTS transfer_fee_pattern_name VARCHAR(100) NULL AFTER transfer_fee_pattern_id,
  ADD COLUMN IF NOT EXISTS transfer_fee_base_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER transfer_fee_pattern_name,
  ADD KEY IF NOT EXISTS idx_advance_transfer_fee_pattern (transfer_fee_pattern_id);
