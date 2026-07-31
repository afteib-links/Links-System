-- 機能追加仕様（06）仮組: 共通レイアウト・企業／パートナー拡張・金額マスタ・日報拡張・請求／支払状態・マスター設定

-- ===== companies 拡張 =====
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS work_mode_code VARCHAR(32) NULL COMMENT '稼働形態' AFTER invoice_send_method,
  ADD COLUMN IF NOT EXISTS fax VARCHAR(50) NULL AFTER contact,
  ADD COLUMN IF NOT EXISTS invoice_send_address VARCHAR(500) NULL AFTER invoice_send_method;

-- ===== partners 拡張 =====
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS blood_type VARCHAR(8) NULL AFTER contact_phone,
  ADD COLUMN IF NOT EXISTS birth_date DATE NULL AFTER blood_type,
  ADD COLUMN IF NOT EXISTS work_start_date DATE NULL AFTER birth_date;

-- ===== base_projects を個別案件と同水準へ =====
ALTER TABLE base_projects
  ADD COLUMN IF NOT EXISTS partner_id BIGINT UNSIGNED NULL AFTER company_id,
  ADD COLUMN IF NOT EXISTS vehicle_id BIGINT UNSIGNED NULL AFTER partner_id,
  ADD COLUMN IF NOT EXISTS payment_type ENUM('normal', 'installment') NOT NULL DEFAULT 'normal' AFTER work_time_type,
  ADD COLUMN IF NOT EXISTS installment_type VARCHAR(32) NULL AFTER payment_type,
  ADD COLUMN IF NOT EXISTS installment_amount DECIMAL(12,2) NULL AFTER installment_type,
  ADD COLUMN IF NOT EXISTS operation_start_date DATE NULL AFTER installment_amount,
  ADD COLUMN IF NOT EXISTS closing_date VARCHAR(32) NULL AFTER operation_start_date,
  ADD COLUMN IF NOT EXISTS execution_time_start TIME NULL AFTER closing_date,
  ADD COLUMN IF NOT EXISTS execution_time_end TIME NULL AFTER execution_time_start,
  ADD COLUMN IF NOT EXISTS binding_time DECIMAL(6,2) NULL AFTER execution_time_end,
  ADD COLUMN IF NOT EXISTS break_time DECIMAL(6,2) NULL AFTER binding_time,
  ADD COLUMN IF NOT EXISTS overtime_calc_type VARCHAR(64) NULL AFTER break_time,
  ADD COLUMN IF NOT EXISTS daily_count_type VARCHAR(64) NULL AFTER overtime_calc_type,
  ADD COLUMN IF NOT EXISTS work_mode_code VARCHAR(32) NULL AFTER daily_count_type,
  ADD COLUMN IF NOT EXISTS rounding_timing_type VARCHAR(32) NULL AFTER work_mode_code,
  ADD COLUMN IF NOT EXISTS overtime_accumulation_type VARCHAR(32) NULL AFTER rounding_timing_type,
  ADD COLUMN IF NOT EXISTS distance_calc_mode VARCHAR(64) NULL AFTER overtime_accumulation_type,
  ADD COLUMN IF NOT EXISTS distance_calc_amount DECIMAL(12,2) NULL AFTER distance_calc_mode,
  ADD COLUMN IF NOT EXISTS gogo_site_calc_type VARCHAR(64) NULL AFTER distance_calc_amount,
  ADD COLUMN IF NOT EXISTS gogo_site_area VARCHAR(100) NULL AFTER gogo_site_calc_type,
  ADD COLUMN IF NOT EXISTS price_set_id BIGINT UNSIGNED NULL AFTER gogo_site_area;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS daily_count_type VARCHAR(64) NULL AFTER overtime_calc_type,
  ADD COLUMN IF NOT EXISTS work_mode_code VARCHAR(32) NULL AFTER daily_count_type,
  ADD COLUMN IF NOT EXISTS price_set_id BIGINT UNSIGNED NULL AFTER gogo_site_area;

-- ===== 画面表示／UIビルダーレイアウト =====
CREATE TABLE IF NOT EXISTS user_screen_layouts (
  layout_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  screen_key VARCHAR(64) NOT NULL,
  columns_json JSON NULL,
  layout_json JSON NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_user_screen (user_id, screen_key),
  KEY idx_usl_user (user_id),
  CONSTRAINT fk_usl_user FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== 企業担当期間履歴 =====
CREATE TABLE IF NOT EXISTS company_manager_periods (
  period_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  role_type VARCHAR(32) NOT NULL COMMENT 'our_manager / our_contract_manager 等',
  name_or_user VARCHAR(200) NOT NULL,
  staff_master_id BIGINT UNSIGNED NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_cmp_company (company_id),
  CONSTRAINT fk_cmp_company FOREIGN KEY (company_id) REFERENCES companies (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== 金額データ管理 =====
CREATE TABLE IF NOT EXISTS price_sets (
  price_set_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price_set_name VARCHAR(200) NOT NULL,
  company_id BIGINT UNSIGNED NULL,
  base_project_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NULL,
  apply_start_date DATE NULL,
  apply_end_date DATE NULL,
  note TEXT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_ps_company (company_id),
  KEY idx_ps_name (price_set_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_set_lines (
  price_set_line_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price_set_id BIGINT UNSIGNED NOT NULL,
  weekday_code VARCHAR(16) NULL COMMENT 'mon..sun / all',
  calc_type_code VARCHAR(64) NULL,
  price_type_code VARCHAR(64) NULL,
  billing_unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_psl_set (price_set_id),
  CONSTRAINT fk_psl_set FOREIGN KEY (price_set_id) REFERENCES price_sets (price_set_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== 日報列拡張 =====
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS is_absent TINYINT(1) NOT NULL DEFAULT 0 AFTER break_time,
  ADD COLUMN IF NOT EXISTS is_training TINYINT(1) NOT NULL DEFAULT 0 AFTER is_absent,
  ADD COLUMN IF NOT EXISTS binding_hours DECIMAL(6,2) NULL AFTER is_training,
  ADD COLUMN IF NOT EXISTS work_hours DECIMAL(6,2) NULL AFTER binding_hours,
  ADD COLUMN IF NOT EXISTS overtime_hours DECIMAL(6,2) NULL AFTER work_hours,
  ADD COLUMN IF NOT EXISTS shortage_hours DECIMAL(6,2) NULL AFTER overtime_hours,
  ADD COLUMN IF NOT EXISTS start_meter DECIMAL(12,1) NULL AFTER shortage_hours,
  ADD COLUMN IF NOT EXISTS end_meter DECIMAL(12,1) NULL AFTER start_meter,
  ADD COLUMN IF NOT EXISTS total_distance DECIMAL(12,1) NULL AFTER end_meter,
  ADD COLUMN IF NOT EXISTS toll_fee DECIMAL(12,2) NULL AFTER total_distance,
  ADD COLUMN IF NOT EXISTS parking_fee DECIMAL(12,2) NULL AFTER toll_fee,
  ADD COLUMN IF NOT EXISTS transport_fee DECIMAL(12,2) NULL AFTER parking_fee,
  ADD COLUMN IF NOT EXISTS night_hours DECIMAL(6,2) NULL AFTER transport_fee,
  ADD COLUMN IF NOT EXISTS spot_amount DECIMAL(12,2) NULL AFTER night_hours,
  ADD COLUMN IF NOT EXISTS row_comment TEXT NULL AFTER spot_amount;

-- ===== 先払拡張 =====
ALTER TABLE advance_payments
  ADD COLUMN IF NOT EXISTS work_days_input DECIMAL(6,1) NULL AFTER work_days,
  ADD COLUMN IF NOT EXISTS record_type VARCHAR(32) NOT NULL DEFAULT 'cycle' AFTER cycle_number,
  ADD COLUMN IF NOT EXISTS title VARCHAR(200) NULL AFTER record_type;

-- ===== 請求／支払状態拡張 =====
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'draft' AFTER invoice_status,
  ADD COLUMN IF NOT EXISTS is_confirmed TINYINT(1) NOT NULL DEFAULT 0 AFTER approval_status,
  ADD COLUMN IF NOT EXISTS is_printed TINYINT(1) NOT NULL DEFAULT 0 AFTER is_confirmed,
  ADD COLUMN IF NOT EXISTS is_excluded TINYINT(1) NOT NULL DEFAULT 0 AFTER is_printed,
  ADD COLUMN IF NOT EXISTS issue_type VARCHAR(16) NOT NULL DEFAULT 'final' AFTER is_excluded;

ALTER TABLE invoice_details
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) NOT NULL DEFAULT 'daily' AFTER is_adjustment_row,
  ADD COLUMN IF NOT EXISTS daily_report_id BIGINT UNSIGNED NULL AFTER source_type;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'draft' AFTER payment_status,
  ADD COLUMN IF NOT EXISTS is_confirmed TINYINT(1) NOT NULL DEFAULT 0 AFTER approval_status,
  ADD COLUMN IF NOT EXISTS is_printed TINYINT(1) NOT NULL DEFAULT 0 AFTER is_confirmed,
  ADD COLUMN IF NOT EXISTS is_excluded TINYINT(1) NOT NULL DEFAULT 0 AFTER is_printed,
  ADD COLUMN IF NOT EXISTS issue_type VARCHAR(16) NOT NULL DEFAULT 'final' AFTER is_excluded;

-- ===== 請求除外リスト =====
CREATE TABLE IF NOT EXISTS invoice_exclusions (
  exclusion_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  target_year_month CHAR(7) NOT NULL,
  reason VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_inv_excl (company_id, target_year_month),
  CONSTRAINT fk_inv_excl_company FOREIGN KEY (company_id) REFERENCES companies (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== 営業担当マスタ・システム設定 =====
CREATE TABLE IF NOT EXISTS staff_masters (
  staff_master_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  staff_name VARCHAR(100) NOT NULL,
  staff_name_kana VARCHAR(100) NULL,
  role_label VARCHAR(64) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_staff_name (staff_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT NULL,
  setting_label VARCHAR(200) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===== コードシード =====
INSERT IGNORE INTO code_masters (category_code, code_value, code_label, sort_order) VALUES
  ('work_mode', 'regular', 'レギュラー', 10),
  ('work_mode', 'spot', 'スポット', 20),
  ('work_mode', 'charter', 'チャーター', 30),
  ('daily_count_type', 'binding', '拘束', 10),
  ('daily_count_type', 'actual', '実働', 20),
  ('weekday', 'all', 'すべて', 0),
  ('weekday', 'mon', '月', 10),
  ('weekday', 'tue', '火', 20),
  ('weekday', 'wed', '水', 30),
  ('weekday', 'thu', '木', 40),
  ('weekday', 'fri', '金', 50),
  ('weekday', 'sat', '土', 60),
  ('weekday', 'sun', '日', 70),
  ('price_type', 'basic', '基本', 10),
  ('price_type', 'overtime', '残業', 20),
  ('price_type', 'night', '深夜', 30),
  ('price_type', 'spot', 'スポット', 40),
  ('price_calc_type', 'daily', '日額', 10),
  ('price_calc_type', 'hourly', '時間', 20),
  ('price_calc_type', 'distance', '距離', 30),
  ('overtime_calc', 'after_basic', '基本後', 10),
  ('overtime_calc', 'binding_over', '拘束超過', 20);

INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_label) VALUES
  ('default_tax_rate', '0.10', '消費税率'),
  ('default_transfer_fee', '0', '振込手数料デフォルト'),
  ('ui_builder_enabled', '1', 'UIビルダー有効');
