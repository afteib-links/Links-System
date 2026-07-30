-- マスタ箱テーブル（CRUD APIは後続フェーズ）
-- 共通列: created_at, updated_at, is_deleted, extra_data, version

CREATE TABLE IF NOT EXISTS code_masters (
  code_master_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_code VARCHAR(64) NOT NULL COMMENT '区分カテゴリ（closing_date等）',
  code_value VARCHAR(64) NOT NULL COMMENT '区分値',
  code_label VARCHAR(100) NOT NULL COMMENT '表示名',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_code_masters_category_value (category_code, code_value),
  KEY idx_code_masters_category (category_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS companies (
  company_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  office_no VARCHAR(50) NULL,
  company_name VARCHAR(200) NOT NULL,
  company_name_kana VARCHAR(200) NULL,
  zip_code VARCHAR(20) NULL,
  address VARCHAR(500) NULL,
  contact VARCHAR(100) NULL,
  contract_manager VARCHAR(100) NULL,
  our_manager VARCHAR(100) NULL,
  our_contract_manager VARCHAR(100) NULL,
  closing_date_code VARCHAR(32) NULL,
  payment_date_code VARCHAR(32) NULL,
  contract_date DATE NULL,
  business_content TEXT NULL,
  bank_name VARCHAR(100) NULL,
  branch_name VARCHAR(100) NULL,
  account_number VARCHAR(50) NULL,
  deposit_type VARCHAR(32) NULL,
  account_name VARCHAR(100) NULL,
  invoice_send_method VARCHAR(50) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_companies_name (company_name),
  KEY idx_companies_closing (closing_date_code),
  KEY idx_companies_is_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_billings (
  billing_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  billing_print_name VARCHAR(200) NULL,
  billing_address VARCHAR(500) NULL,
  billing_phone VARCHAR(50) NULL,
  billing_fax VARCHAR(50) NULL,
  billing_manager VARCHAR(100) NULL,
  billing_summary_no VARCHAR(50) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_company_billings_company (company_id),
  KEY idx_company_billings_summary (billing_summary_no),
  CONSTRAINT fk_company_billings_company
    FOREIGN KEY (company_id) REFERENCES companies (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_vehicles (
  vehicle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  vehicle_name VARCHAR(100) NULL,
  vehicle_number VARCHAR(50) NULL,
  inspection_expiry_date DATE NULL,
  insurance_expiry_date DATE NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_company_vehicles_company (company_id),
  CONSTRAINT fk_company_vehicles_company
    FOREIGN KEY (company_id) REFERENCES companies (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partners (
  partner_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  partner_name VARCHAR(200) NOT NULL,
  partner_name_kana VARCHAR(200) NULL,
  zip_code VARCHAR(20) NULL,
  address VARCHAR(500) NULL,
  contact_phone VARCHAR(50) NULL,
  contract_date DATE NULL,
  partner_category_code VARCHAR(32) NULL,
  employment_type_code VARCHAR(32) NULL,
  invoice_number VARCHAR(50) NULL,
  advance_payment_enabled TINYINT(1) NOT NULL DEFAULT 0,
  license_expiry_date DATE NULL,
  license_types TEXT NULL,
  safety_conference_history TEXT NULL,
  accident_insurance_code VARCHAR(32) NULL,
  contractor_liability_code VARCHAR(32) NULL,
  cargo_insurance_code VARCHAR(32) NULL,
  g_association_code VARCHAR(32) NULL,
  tax_return_code VARCHAR(32) NULL,
  loop_code VARCHAR(32) NULL,
  payment_output_code VARCHAR(32) NULL,
  bank_name VARCHAR(100) NULL,
  branch_name VARCHAR(100) NULL,
  account_number VARCHAR(50) NULL,
  deposit_type VARCHAR(32) NULL,
  account_name VARCHAR(100) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_partners_name (partner_name),
  KEY idx_partners_is_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_vehicles (
  vehicle_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  partner_id BIGINT UNSIGNED NOT NULL,
  vehicle_name VARCHAR(100) NULL,
  vehicle_number VARCHAR(50) NULL,
  inspection_expiry_date DATE NULL,
  insurance_expiry_date DATE NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_partner_vehicles_partner (partner_id),
  CONSTRAINT fk_partner_vehicles_partner
    FOREIGN KEY (partner_id) REFERENCES partners (partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS base_projects (
  base_project_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  template_name VARCHAR(200) NOT NULL,
  default_manager VARCHAR(100) NULL,
  business_type VARCHAR(100) NULL,
  basic_work_hours DECIMAL(6,2) NULL,
  work_time_type ENUM('binding', 'actual') NULL COMMENT '拘束 or 実働',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_base_projects_company (company_id),
  CONSTRAINT fk_base_projects_company
    FOREIGN KEY (company_id) REFERENCES companies (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  project_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  base_project_id BIGINT UNSIGNED NULL COMMENT '基本案件。基本案件本体の場合はNULL可',
  company_id BIGINT UNSIGNED NOT NULL,
  partner_id BIGINT UNSIGNED NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  manager_name VARCHAR(100) NULL,
  business_type VARCHAR(100) NULL,
  payment_type ENUM('normal', 'installment') NOT NULL DEFAULT 'normal',
  installment_type VARCHAR(32) NULL,
  installment_amount DECIMAL(12,2) NULL,
  operation_start_date DATE NULL,
  closing_date VARCHAR(32) NULL,
  execution_time_start TIME NULL,
  execution_time_end TIME NULL,
  binding_time DECIMAL(6,2) NULL,
  break_time DECIMAL(6,2) NULL,
  overtime_calc_type VARCHAR(64) NULL,
  rounding_timing_type VARCHAR(32) NULL,
  overtime_accumulation_type VARCHAR(32) NULL,
  distance_calc_mode VARCHAR(64) NULL,
  distance_calc_amount DECIMAL(12,2) NULL,
  distance_table_json JSON NULL,
  gogo_site_calc_type VARCHAR(64) NULL,
  gogo_site_area VARCHAR(100) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_projects_company (company_id),
  KEY idx_projects_partner (partner_id),
  KEY idx_projects_base (base_project_id),
  CONSTRAINT fk_projects_company
    FOREIGN KEY (company_id) REFERENCES companies (company_id),
  CONSTRAINT fk_projects_partner
    FOREIGN KEY (partner_id) REFERENCES partners (partner_id),
  CONSTRAINT fk_projects_base
    FOREIGN KEY (base_project_id) REFERENCES base_projects (base_project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_revisions (
  revision_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  revision_start_date DATE NOT NULL,
  revision_end_date DATE NULL,
  is_auto_generated TINYINT(1) NOT NULL DEFAULT 0,
  basic_work_hours DECIMAL(6,2) NULL,
  work_time_type ENUM('binding', 'actual') NULL,
  break_time DECIMAL(6,2) NULL,
  billing_base_price DECIMAL(12,2) NULL,
  billing_overtime_price DECIMAL(12,2) NULL,
  billing_settlement_price DECIMAL(12,2) NULL,
  payment_base_price DECIMAL(12,2) NULL,
  payment_overtime_price DECIMAL(12,2) NULL,
  payment_settlement_price DECIMAL(12,2) NULL,
  distance_unit_price DECIMAL(12,2) NULL,
  prices_json JSON NULL COMMENT '複数料金行の格納用',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_project_revisions_project (project_id),
  KEY idx_project_revisions_dates (revision_start_date, revision_end_date),
  CONSTRAINT fk_project_revisions_project
    FOREIGN KEY (project_id) REFERENCES projects (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 初期区分マスタ（締日・支払日など）。再実行時は UNIQUE で無視
INSERT IGNORE INTO code_masters (category_code, code_value, code_label, sort_order) VALUES
  ('closing_date', '5', '5日', 10),
  ('closing_date', '10', '10日', 20),
  ('closing_date', '15', '15日', 30),
  ('closing_date', '20', '20日', 40),
  ('closing_date', '25', '25日', 50),
  ('closing_date', 'end', '末日', 60),
  ('payment_date', '5', '5日', 10),
  ('payment_date', '10', '10日', 20),
  ('payment_date', '15', '15日', 30),
  ('payment_date', '20', '20日', 40),
  ('payment_date', '25', '25日', 50),
  ('payment_date', 'end', '末日', 60),
  ('partner_category', 'individual', '個人', 10),
  ('partner_category', 'company', '企業', 20),
  ('partner_category', 'sole_proprietor', '個人事業主', 30),
  ('employment_type', 'outsourcing', '外注', 10),
  ('employment_type', 'payroll', '給与', 20),
  ('work_time_type', 'binding', '拘束時間', 10),
  ('work_time_type', 'actual', '実働時間', 20);
