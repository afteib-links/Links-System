CREATE TABLE IF NOT EXISTS calculation_rule_sets (
  calculation_rule_set_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_set_code VARCHAR(64) NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  rule_set_name VARCHAR(200) NOT NULL,
  status ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  effective_from DATE NULL,
  effective_to DATE NULL,
  based_on_rule_set_id BIGINT UNSIGNED NULL,
  definition_checksum CHAR(64) NULL,
  validation_result_json JSON NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  published_by_user_id BIGINT UNSIGNED NULL,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_calculation_rule_set_version (rule_set_code,version_no),
  KEY idx_calculation_rule_set_effective (status,effective_from,effective_to),
  CONSTRAINT fk_calculation_rule_set_base FOREIGN KEY (based_on_rule_set_id) REFERENCES calculation_rule_sets(calculation_rule_set_id),
  CONSTRAINT fk_calculation_rule_set_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_calculation_rule_set_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calculation_rules (
  calculation_rule_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  calculation_rule_set_id BIGINT UNSIGNED NOT NULL,
  rule_code VARCHAR(64) NOT NULL,
  rule_name VARCHAR(200) NOT NULL,
  stage_code ENUM('daily','aggregate','deduction','tax','finalize') NOT NULL,
  side_code ENUM('billing','payment','both') NOT NULL DEFAULT 'both',
  handler_code VARCHAR(64) NOT NULL,
  condition_expression VARCHAR(500) NULL,
  parameter_json JSON NULL,
  rounding_json JSON NULL,
  output_code VARCHAR(64) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_calculation_rule_code (calculation_rule_set_id,rule_code),
  KEY idx_calculation_rule_order (calculation_rule_set_id,stage_code,sort_order),
  CONSTRAINT fk_calculation_rule_set FOREIGN KEY (calculation_rule_set_id) REFERENCES calculation_rule_sets(calculation_rule_set_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calculation_rule_audit_logs (
  calculation_rule_audit_log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  calculation_rule_set_id BIGINT UNSIGNED NOT NULL,
  event_code ENUM('created','updated','validated','published','retired') NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  summary_text VARCHAR(500) NULL,
  definition_checksum CHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_calculation_rule_audit (calculation_rule_set_id,created_at),
  CONSTRAINT fk_calculation_rule_audit_set FOREIGN KEY (calculation_rule_set_id) REFERENCES calculation_rule_sets(calculation_rule_set_id),
  CONSTRAINT fk_calculation_rule_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS calculation_rule_set_id BIGINT UNSIGNED NULL AFTER calculation_detail,
  ADD COLUMN IF NOT EXISTS calculation_engine_code VARCHAR(64) NULL AFTER calculation_rule_set_id,
  ADD INDEX IF NOT EXISTS idx_daily_report_calculation_rule_set (calculation_rule_set_id);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS calculation_rule_set_id BIGINT UNSIGNED NULL AFTER finalized_snapshot,
  ADD INDEX IF NOT EXISTS idx_invoice_calculation_rule_set (calculation_rule_set_id);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS calculation_rule_set_id BIGINT UNSIGNED NULL AFTER finalized_snapshot,
  ADD INDEX IF NOT EXISTS idx_payment_calculation_rule_set (calculation_rule_set_id);

INSERT INTO calculation_rule_sets
  (rule_set_code,version_no,rule_set_name,status,effective_from,definition_checksum,published_at)
SELECT 'standard','1','標準請求・支払計算 v1','published','2000-01-01',NULL,CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM calculation_rule_sets WHERE rule_set_code='standard' AND version_no=1
);

INSERT IGNORE INTO calculation_rules
  (calculation_rule_set_id,rule_code,rule_name,stage_code,side_code,handler_code,parameter_json,rounding_json,output_code,sort_order)
SELECT calculation_rule_set_id,'daily_price','日次料金計算','daily','both','daily_price_v1',JSON_OBJECT(),JSON_OBJECT(),'daily_amount',10
FROM calculation_rule_sets WHERE rule_set_code='standard' AND version_no=1;
INSERT IGNORE INTO calculation_rules
  (calculation_rule_set_id,rule_code,rule_name,stage_code,side_code,handler_code,parameter_json,rounding_json,output_code,sort_order)
SELECT calculation_rule_set_id,'monthly_aggregate','月次集約','aggregate','both','aggregate_sum_v1',JSON_OBJECT(),JSON_OBJECT(),'subtotal',20
FROM calculation_rule_sets WHERE rule_set_code='standard' AND version_no=1;
INSERT IGNORE INTO calculation_rules
  (calculation_rule_set_id,rule_code,rule_name,stage_code,side_code,handler_code,parameter_json,rounding_json,output_code,sort_order)
SELECT calculation_rule_set_id,'payment_deduction','支払控除','deduction','payment','deduction_sum_v1',JSON_OBJECT(),JSON_OBJECT(),'deduction_total',30
FROM calculation_rule_sets WHERE rule_set_code='standard' AND version_no=1;
INSERT IGNORE INTO calculation_rules
  (calculation_rule_set_id,rule_code,rule_name,stage_code,side_code,handler_code,parameter_json,rounding_json,output_code,sort_order)
SELECT calculation_rule_set_id,'consumption_tax','消費税','tax','billing','tax_v1',JSON_OBJECT('rate',0.10),JSON_OBJECT('mode','floor','unit',1),'tax_amount',40
FROM calculation_rule_sets WHERE rule_set_code='standard' AND version_no=1;
INSERT IGNORE INTO calculation_rules
  (calculation_rule_set_id,rule_code,rule_name,stage_code,side_code,handler_code,parameter_json,rounding_json,output_code,sort_order)
SELECT calculation_rule_set_id,'final_amount','最終金額','finalize','both','finalize_v1',JSON_OBJECT(),JSON_OBJECT(),'total_amount',50
FROM calculation_rule_sets WHERE rule_set_code='standard' AND version_no=1;
