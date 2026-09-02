-- 請求・支払本作成: 確定スナップショット、控除ルール、帳票、外部閲覧の正本

ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id BIGINT UNSIGNED NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_id BIGINT UNSIGNED NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS settlement_status ENUM('draft','sales_reviewed','finalized','cancelled') NOT NULL DEFAULT 'draft';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS settlement_status ENUM('draft','sales_reviewed','finalized','cancelled') NOT NULL DEFAULT 'draft';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS finalized_snapshot JSON NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS finalized_snapshot JSON NULL;

CREATE TABLE IF NOT EXISTS project_settlement_reviewers (
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_psr_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_psr_user FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_lines (
  settlement_line_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_type ENUM('invoice','payment') NOT NULL,
  settlement_id BIGINT UNSIGNED NOT NULL,
  line_type ENUM('work','adjustment','deduction','advance','installment','carry_forward') NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NULL,
  daily_report_id BIGINT UNSIGNED NULL,
  item_name VARCHAR(200) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_category ENUM('taxable','non_taxable','tax_exempt') NOT NULL DEFAULT 'taxable',
  reason VARCHAR(500) NULL,
  snapshot_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_settlement_lines (settlement_type, settlement_id),
  KEY idx_settlement_lines_source (source_type, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_workflows (
  settlement_workflow_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_type ENUM('invoice','payment') NOT NULL,
  settlement_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','sales_reviewed','finalized','cancelled') NOT NULL DEFAULT 'draft',
  drafted_by_user_id BIGINT UNSIGNED NOT NULL,
  drafted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sales_reviewed_by_user_id BIGINT UNSIGNED NULL,
  sales_reviewed_at DATETIME NULL,
  finalized_by_user_id BIGINT UNSIGNED NULL,
  finalized_at DATETIME NULL,
  cancelled_by_user_id BIGINT UNSIGNED NULL,
  cancelled_at DATETIME NULL,
  cancellation_reason VARCHAR(500) NULL,
  UNIQUE KEY uq_settlement_workflow (settlement_type, settlement_id),
  KEY idx_settlement_workflow_status (status),
  CONSTRAINT fk_sw_drafter FOREIGN KEY (drafted_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_sw_sales FOREIGN KEY (sales_reviewed_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_sw_final FOREIGN KEY (finalized_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_sw_cancel FOREIGN KEY (cancelled_by_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_deduction_rules (
  settlement_deduction_rule_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_code VARCHAR(50) NOT NULL,
  scope ENUM('common','partner') NOT NULL DEFAULT 'common',
  partner_id BIGINT UNSIGNED NULL,
  display_name VARCHAR(200) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  tax_category ENUM('taxable','non_taxable','tax_exempt') NOT NULL DEFAULT 'taxable',
  valid_from DATE NOT NULL,
  valid_to DATE NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_deduction_effective (rule_code, partner_id, valid_from),
  CONSTRAINT fk_deduction_partner FOREIGN KEY (partner_id) REFERENCES partners(partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settlement_deduction_rules (rule_code,scope,partner_id,display_name,amount,tax_category,valid_from)
SELECT 'office_fee','common',NULL,'事務手数料',1100,'taxable','2026-01-01'
WHERE NOT EXISTS (SELECT 1 FROM settlement_deduction_rules r WHERE r.rule_code='office_fee' AND r.scope='common' AND r.partner_id IS NULL AND r.valid_from='2026-01-01');
INSERT INTO settlement_deduction_rules (rule_code,scope,partner_id,display_name,amount,tax_category,valid_from)
SELECT 'safety_fee','common',NULL,'安全協力会費',8800,'taxable','2026-01-01'
WHERE NOT EXISTS (SELECT 1 FROM settlement_deduction_rules r WHERE r.rule_code='safety_fee' AND r.scope='common' AND r.partner_id IS NULL AND r.valid_from='2026-01-01');

CREATE TABLE IF NOT EXISTS settlement_carry_forwards (
  settlement_carry_forward_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  partner_id BIGINT UNSIGNED NOT NULL,
  source_payment_id BIGINT UNSIGNED NOT NULL,
  source_line_id BIGINT UNSIGNED NULL,
  item_name VARCHAR(200) NOT NULL,
  original_amount DECIMAL(12,2) NOT NULL,
  remaining_amount DECIMAL(12,2) NOT NULL,
  tax_category ENUM('taxable','non_taxable','tax_exempt') NOT NULL DEFAULT 'taxable',
  status ENUM('open','settled','cancelled') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_carry_partner (partner_id, status),
  CONSTRAINT fk_carry_partner FOREIGN KEY (partner_id) REFERENCES partners(partner_id),
  CONSTRAINT fk_carry_payment FOREIGN KEY (source_payment_id) REFERENCES payments(payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_carry_forward_allocations (
  settlement_carry_forward_allocation_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_carry_forward_id BIGINT UNSIGNED NOT NULL,
  payment_id BIGINT UNSIGNED NOT NULL,
  payment_line_id BIGINT UNSIGNED NULL,
  amount DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_carry_payment (settlement_carry_forward_id, payment_id),
  CONSTRAINT fk_carry_alloc_carry FOREIGN KEY (settlement_carry_forward_id) REFERENCES settlement_carry_forwards(settlement_carry_forward_id),
  CONSTRAINT fk_carry_alloc_payment FOREIGN KEY (payment_id) REFERENCES payments(payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_invoice_settings (
  company_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  display_mode ENUM('detailed','project_aggregated') NOT NULL DEFAULT 'detailed',
  tax_rate DECIMAL(5,4) NULL,
  tax_rounding ENUM('floor','round','ceil') NOT NULL DEFAULT 'floor',
  CONSTRAINT fk_cis_company FOREIGN KEY (company_id) REFERENCES companies(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_invoice_settings (
  project_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  tax_rate DECIMAL(5,4) NULL,
  tax_rounding ENUM('floor','round','ceil') NULL,
  CONSTRAINT fk_pis_project FOREIGN KEY (project_id) REFERENCES projects(project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_document_sequences (
  document_type ENUM('invoice','invoice_summary','payment_statement','salary_statement') NOT NULL,
  document_year SMALLINT UNSIGNED NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (document_type, document_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_documents (
  settlement_document_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_type ENUM('invoice','payment') NOT NULL,
  settlement_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('invoice','invoice_summary','payment_statement','salary_statement') NOT NULL,
  document_year SMALLINT UNSIGNED NOT NULL,
  document_number VARCHAR(40) NOT NULL,
  document_version INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('issued','cancelled') NOT NULL DEFAULT 'issued',
  company_id BIGINT UNSIGNED NULL,
  partner_id BIGINT UNSIGNED NULL,
  file_path VARCHAR(500) NOT NULL,
  snapshot_json JSON NOT NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at DATETIME NULL,
  cancelled_by_user_id BIGINT UNSIGNED NULL,
  cancellation_reason VARCHAR(500) NULL,
  UNIQUE KEY uq_document_number (document_type, document_year, document_number),
  KEY idx_document_settlement (settlement_type, settlement_id),
  CONSTRAINT fk_document_company FOREIGN KEY (company_id) REFERENCES companies(company_id),
  CONSTRAINT fk_document_partner FOREIGN KEY (partner_id) REFERENCES partners(partner_id),
  CONSTRAINT fk_document_cancel_user FOREIGN KEY (cancelled_by_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
