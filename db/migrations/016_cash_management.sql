-- 入出金管理（管理回・予定・実績・CSV）と案件別前払条件

CREATE TABLE IF NOT EXISTS cash_cycles (
  cash_cycle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target_year_month CHAR(7) NOT NULL,
  cycle_code ENUM('05','10','15','20','25','end') NOT NULL,
  base_date DATE NOT NULL,
  planned_incoming_date DATE NOT NULL,
  planned_outgoing_date DATE NOT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cash_cycle (target_year_month, cycle_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_schedules (
  cash_schedule_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cash_cycle_id BIGINT UNSIGNED NOT NULL,
  direction ENUM('incoming','outgoing') NOT NULL,
  source_type ENUM('advance','payment','invoice','expense','adjustment') NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  company_id BIGINT UNSIGNED NULL,
  partner_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NULL,
  counterparty_name VARCHAR(200) NOT NULL,
  title VARCHAR(200) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  scheduled_date DATE NOT NULL,
  date_overridden TINYINT(1) NOT NULL DEFAULT 0,
  override_reason VARCHAR(500) NULL,
  status ENUM('planned','exported','executed','held','cancelled') NOT NULL DEFAULT 'planned',
  snapshot_json JSON NULL,
  created_by BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cash_schedule_cycle (cash_cycle_id, direction, status),
  KEY idx_cash_schedule_source (source_type, source_id),
  CONSTRAINT fk_cash_schedule_cycle FOREIGN KEY (cash_cycle_id) REFERENCES cash_cycles (cash_cycle_id),
  CONSTRAINT fk_cash_schedule_company FOREIGN KEY (company_id) REFERENCES companies (company_id),
  CONSTRAINT fk_cash_schedule_partner FOREIGN KEY (partner_id) REFERENCES partners (partner_id),
  CONSTRAINT fk_cash_schedule_project FOREIGN KEY (project_id) REFERENCES projects (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_transactions (
  cash_transaction_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cash_schedule_id BIGINT UNSIGNED NOT NULL,
  executed_date DATE NOT NULL,
  executed_amount DECIMAL(12,2) NOT NULL,
  status ENUM('executed','held','cancelled') NOT NULL,
  reason VARCHAR(500) NULL,
  bank_name VARCHAR(100) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cash_transaction_schedule (cash_schedule_id),
  CONSTRAINT fk_cash_transaction_schedule FOREIGN KEY (cash_schedule_id) REFERENCES cash_schedules (cash_schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_export_batches (
  cash_export_batch_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cash_cycle_id BIGINT UNSIGNED NOT NULL,
  bank_name VARCHAR(100) NULL,
  file_name VARCHAR(255) NOT NULL,
  status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cash_export_cycle FOREIGN KEY (cash_cycle_id) REFERENCES cash_cycles (cash_cycle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_export_batch_items (
  cash_export_batch_id BIGINT UNSIGNED NOT NULL,
  cash_schedule_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (cash_export_batch_id, cash_schedule_id),
  CONSTRAINT fk_cash_export_item_batch FOREIGN KEY (cash_export_batch_id) REFERENCES cash_export_batches (cash_export_batch_id),
  CONSTRAINT fk_cash_export_item_schedule FOREIGN KEY (cash_schedule_id) REFERENCES cash_schedules (cash_schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_advance_terms (
  project_advance_term_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_advance_term_project_date (project_id, valid_from),
  CONSTRAINT fk_advance_term_project FOREIGN KEY (project_id) REFERENCES projects (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advance_records (
  advance_record_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  partner_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  project_advance_term_id BIGINT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  work_days INT UNSIGNED NOT NULL,
  calculated_amount DECIMAL(12,2) NOT NULL,
  advance_amount DECIMAL(12,2) NOT NULL,
  adjustment_reason VARCHAR(500) NULL,
  status ENUM('planned','cancelled','executed') NOT NULL DEFAULT 'planned',
  cash_schedule_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_advance_period (project_id, period_start, period_end),
  CONSTRAINT fk_advance_record_project FOREIGN KEY (project_id) REFERENCES projects (project_id),
  CONSTRAINT fk_advance_record_partner FOREIGN KEY (partner_id) REFERENCES partners (partner_id),
  CONSTRAINT fk_advance_record_company FOREIGN KEY (company_id) REFERENCES companies (company_id),
  CONSTRAINT fk_advance_record_term FOREIGN KEY (project_advance_term_id) REFERENCES project_advance_terms (project_advance_term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advance_payment_allocations (
  advance_payment_allocation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  advance_record_id BIGINT UNSIGNED NOT NULL,
  payment_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_advance_payment_allocation (advance_record_id, payment_id),
  CONSTRAINT fk_advance_allocation_record FOREIGN KEY (advance_record_id) REFERENCES advance_records (advance_record_id),
  CONSTRAINT fk_advance_allocation_payment FOREIGN KEY (payment_id) REFERENCES payments (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
