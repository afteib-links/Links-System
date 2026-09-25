CREATE TABLE IF NOT EXISTS additional_item_masters (
  additional_item_master_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_name VARCHAR(120) NOT NULL,
  calculation_method VARCHAR(24) NOT NULL DEFAULT 'direct',
  applies_to VARCHAR(16) NOT NULL DEFAULT 'both',
  tax_category VARCHAR(24) NOT NULL DEFAULT 'taxable',
  is_active TINYINT NOT NULL DEFAULT 1,
  version INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO additional_item_masters(item_name,calculation_method,applies_to,tax_category)
SELECT '自家用燃料費','fuel','payment','tax_inclusive'
WHERE NOT EXISTS (SELECT 1 FROM additional_item_masters WHERE calculation_method='fuel');

CREATE TABLE IF NOT EXISTS fuel_conditions (
  fuel_condition_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope_type VARCHAR(16) NOT NULL,
  scope_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  valid_from DATE NOT NULL,
  efficiency DECIMAL(12,4) NULL,
  roundtrip_km DECIMAL(12,4) NULL,
  prefecture_code VARCHAR(2) NULL,
  reason TEXT NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fuel_scope(scope_type,scope_id,valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fuel_prices (
  fuel_price_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prefecture_code VARCHAR(2) NOT NULL,
  price_date DATE NOT NULL,
  regular_price DECIMAL(12,4) NOT NULL,
  source_code VARCHAR(24) NOT NULL DEFAULT 'manual',
  reason TEXT NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fuel_price(prefecture_code,price_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fuel_fetch_settings (
  setting_id INT PRIMARY KEY,
  fetch_time_jst TIME NOT NULL DEFAULT '10:00:00',
  enabled TINYINT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO fuel_fetch_settings(setting_id) VALUES (1);
CREATE TABLE IF NOT EXISTS fuel_fetch_runs (
  fuel_fetch_run_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scheduled_date DATE NOT NULL UNIQUE,
  status VARCHAR(24) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_additional_items (
  additional_item_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  daily_report_period_id BIGINT UNSIGNED NOT NULL,
  target_year_month CHAR(7) NOT NULL,
  work_date DATE NULL,
  additional_item_master_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(120) NOT NULL,
  calculation_method VARCHAR(24) NOT NULL,
  applies_to VARCHAR(16) NOT NULL,
  tax_category VARCHAR(24) NOT NULL,
  billing_amount DECIMAL(15,0) NOT NULL DEFAULT 0,
  payment_amount DECIMAL(15,0) NOT NULL DEFAULT 0,
  calculation_data JSON NOT NULL,
  reason TEXT NULL,
  request_key VARCHAR(80) NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_additional_request(project_id,request_key),
  KEY idx_additional_period(project_id,target_year_month,work_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS additional_item_audits (
  additional_item_audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  additional_item_id BIGINT UNSIGNED NOT NULL,
  before_data JSON NULL,
  after_data JSON NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE settlement_lines MODIFY tax_category ENUM('taxable','non_taxable','tax_exempt','tax_inclusive') NOT NULL DEFAULT 'taxable';
