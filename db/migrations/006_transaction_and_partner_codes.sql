-- パートナー区分の追加シード + 日報・先払い・請求・支払のトランザクション箱（仮組）

INSERT IGNORE INTO code_masters (category_code, code_value, code_label, sort_order) VALUES
  ('accident_insurance', 'joined', '加入', 10),
  ('accident_insurance', 'not_joined', '未加入', 20),
  ('contractor_liability', 'joined', '加入', 10),
  ('contractor_liability', 'not_joined', '未加入', 20),
  ('cargo_insurance', 'joined', '加入', 10),
  ('cargo_insurance', 'not_joined', '未加入', 20),
  ('g_association', 'joined', '加入', 10),
  ('g_association', 'not_joined', '未加入', 20),
  ('tax_return', 'done', '提出済', 10),
  ('tax_return', 'not_done', '未提出', 20),
  ('loop_code', 'yes', '有', 10),
  ('loop_code', 'no', '無', 20),
  ('payment_output', 'type_a', '帳票A', 10),
  ('payment_output', 'type_b', '帳票B', 20),
  ('payment_output', 'type_c', '帳票C', 30);

CREATE TABLE IF NOT EXISTS daily_reports (
  daily_report_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  partner_id BIGINT UNSIGNED NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  target_year_month CHAR(7) NOT NULL,
  work_date DATE NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  break_time DECIMAL(6,2) NULL,
  expenses_json JSON NULL,
  memo TEXT NULL,
  status ENUM('draft', 'confirmed', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
  rejection_reason TEXT NULL,
  billing_status ENUM('none', 'billed') NOT NULL DEFAULT 'none',
  payment_status ENUM('none', 'paid') NOT NULL DEFAULT 'none',
  calculated_billing_amount DECIMAL(12,2) NULL,
  calculated_payment_amount DECIMAL(12,2) NULL,
  override_billing_amount DECIMAL(12,2) NULL,
  override_payment_amount DECIMAL(12,2) NULL,
  input_source_type VARCHAR(16) NOT NULL DEFAULT 'manual',
  scanned_image_url VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_dr_ym (target_year_month),
  KEY idx_dr_work_date (work_date),
  KEY idx_dr_status (status),
  KEY idx_dr_company (company_id),
  KEY idx_dr_partner (partner_id),
  CONSTRAINT fk_dr_project FOREIGN KEY (project_id) REFERENCES projects (project_id),
  CONSTRAINT fk_dr_company FOREIGN KEY (company_id) REFERENCES companies (company_id),
  CONSTRAINT fk_dr_partner FOREIGN KEY (partner_id) REFERENCES partners (partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advance_payments (
  advance_payment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  partner_id BIGINT UNSIGNED NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  target_year_month CHAR(7) NOT NULL,
  cycle_number TINYINT UNSIGNED NOT NULL,
  is_target TINYINT(1) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_price_overridden TINYINT(1) NOT NULL DEFAULT 0,
  work_days INT UNSIGNED NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  applied_transfer_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_adv_project_ym_cycle (project_id, target_year_month, cycle_number),
  KEY idx_adv_ym (target_year_month),
  CONSTRAINT fk_adv_project FOREIGN KEY (project_id) REFERENCES projects (project_id),
  CONSTRAINT fk_adv_company FOREIGN KEY (company_id) REFERENCES companies (company_id),
  CONSTRAINT fk_adv_partner FOREIGN KEY (partner_id) REFERENCES partners (partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NOT NULL,
  billing_id BIGINT UNSIGNED NULL,
  billing_summary_no VARCHAR(50) NULL,
  billing_print_name VARCHAR(200) NULL,
  target_year_month CHAR(7) NOT NULL,
  closing_date VARCHAR(32) NOT NULL,
  subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  adjustment_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  taxable_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  invoice_status VARCHAR(32) NOT NULL DEFAULT 'issued',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_inv_ym (target_year_month),
  KEY idx_inv_company (company_id),
  CONSTRAINT fk_inv_company FOREIGN KEY (company_id) REFERENCES companies (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_details (
  invoice_detail_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id BIGINT UNSIGNED NOT NULL,
  price_name VARCHAR(200) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_adjustment_row TINYINT(1) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_inv_detail_invoice (invoice_id),
  CONSTRAINT fk_inv_detail_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_daily_reports (
  invoice_id BIGINT UNSIGNED NOT NULL,
  daily_report_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (invoice_id, daily_report_id),
  CONSTRAINT fk_idr_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (invoice_id),
  CONSTRAINT fk_idr_daily FOREIGN KEY (daily_report_id) REFERENCES daily_reports (daily_report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  payment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  partner_id BIGINT UNSIGNED NOT NULL,
  target_year_month CHAR(7) NOT NULL,
  closing_date VARCHAR(32) NOT NULL,
  gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  advance_deduction_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  transfer_fee_deduction_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  office_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 1100,
  safety_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 8800,
  other_adjustment_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  final_transfer_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_output_code VARCHAR(32) NULL,
  payment_status VARCHAR(32) NOT NULL DEFAULT 'issued',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_pay_ym (target_year_month),
  KEY idx_pay_partner (partner_id),
  CONSTRAINT fk_pay_partner FOREIGN KEY (partner_id) REFERENCES partners (partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_details (
  payment_detail_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  detail_type ENUM('work_item', 'deduction_item', 'adjustment_item') NOT NULL DEFAULT 'work_item',
  item_name VARCHAR(200) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  KEY idx_pay_detail_payment (payment_id),
  CONSTRAINT fk_pay_detail_payment FOREIGN KEY (payment_id) REFERENCES payments (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_daily_reports (
  payment_id BIGINT UNSIGNED NOT NULL,
  daily_report_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (payment_id, daily_report_id),
  CONSTRAINT fk_pdr_payment FOREIGN KEY (payment_id) REFERENCES payments (payment_id),
  CONSTRAINT fk_pdr_daily FOREIGN KEY (daily_report_id) REFERENCES daily_reports (daily_report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
