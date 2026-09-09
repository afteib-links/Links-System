-- Issue #106: 料金データ系列・改定履歴・料金項目種別

CREATE TABLE IF NOT EXISTS price_series (
  price_series_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id BIGINT UNSIGNED NULL,
  series_number INT UNSIGNED NOT NULL,
  series_code VARCHAR(64) NOT NULL,
  price_series_name VARCHAR(200) NOT NULL,
  base_project_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NULL,
  source_price_series_id BIGINT UNSIGNED NULL,
  source_price_set_id BIGINT UNSIGNED NULL,
  legacy_price_set_id BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_price_series_code (series_code),
  UNIQUE KEY uq_price_series_company_number (company_id, series_number),
  UNIQUE KEY uq_price_series_legacy_set (legacy_price_set_id),
  KEY idx_price_series_base (base_project_id),
  KEY idx_price_series_project (project_id),
  KEY idx_price_series_source (source_price_series_id),
  CONSTRAINT fk_price_series_company FOREIGN KEY (company_id) REFERENCES companies (company_id),
  CONSTRAINT fk_price_series_base FOREIGN KEY (base_project_id) REFERENCES base_projects (base_project_id),
  CONSTRAINT fk_price_series_project FOREIGN KEY (project_id) REFERENCES projects (project_id),
  CONSTRAINT fk_price_series_source FOREIGN KEY (source_price_series_id) REFERENCES price_series (price_series_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE price_sets
  ADD COLUMN IF NOT EXISTS price_series_id BIGINT UNSIGNED NULL AFTER price_set_no,
  ADD COLUMN IF NOT EXISTS revision_no INT UNSIGNED NOT NULL DEFAULT 1 AFTER price_series_id,
  ADD COLUMN IF NOT EXISTS revision_reason VARCHAR(500) NULL AFTER revision_no,
  ADD COLUMN IF NOT EXISTS is_current_revision TINYINT(1) NOT NULL DEFAULT 1 AFTER revision_reason,
  ADD COLUMN IF NOT EXISTS source_price_set_id BIGINT UNSIGNED NULL AFTER is_current_revision;

CREATE UNIQUE INDEX IF NOT EXISTS uq_price_sets_series_revision
  ON price_sets (price_series_id, revision_no);

CREATE TABLE IF NOT EXISTS price_set_revision_audit_logs (
  price_set_revision_audit_log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price_set_id BIGINT UNSIGNED NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  before_data JSON NULL,
  after_data JSON NULL,
  reason VARCHAR(500) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_price_revision_audit_set (price_set_id, created_at),
  CONSTRAINT fk_price_revision_audit_set FOREIGN KEY (price_set_id) REFERENCES price_sets (price_set_id),
  CONSTRAINT fk_price_revision_audit_user FOREIGN KEY (actor_user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 既存の各PriceSetは独立した料金系列の初版として扱い、既存番号・金額は変更しない。
INSERT IGNORE INTO price_series
  (company_id, series_number, series_code, price_series_name,
   base_project_id, project_id, legacy_price_set_id)
SELECT ps.company_id,
       ROW_NUMBER() OVER (PARTITION BY COALESCE(ps.company_id, 0) ORDER BY ps.price_set_id),
       CONCAT(
         'FEE-', LPAD(COALESCE(ps.company_id, 0), 5, '0'), '-',
         LPAD(ROW_NUMBER() OVER (PARTITION BY COALESCE(ps.company_id, 0) ORDER BY ps.price_set_id), 4, '0')
       ),
       ps.price_set_name,
       ps.base_project_id,
       ps.project_id,
       ps.price_set_id
FROM price_sets ps
WHERE ps.is_deleted = 0;

UPDATE price_sets ps
JOIN price_series s ON s.legacy_price_set_id = ps.price_set_id
SET ps.price_series_id = s.price_series_id,
    ps.revision_no = 1,
    ps.is_current_revision = 1
WHERE ps.price_series_id IS NULL;

INSERT IGNORE INTO code_masters
  (category_code, code_value, code_label, sort_order, is_active)
VALUES
  ('fee_item_type', 'daily_basic', '基本日極', 10, 1),
  ('fee_item_type', 'hourly', '時間単価', 20, 1),
  ('fee_item_type', 'overtime', '時間外', 30, 1),
  ('fee_item_type', 'night', '深夜単価', 40, 1),
  ('fee_item_type', 'night_overtime', '深夜時間外', 50, 1),
  ('fee_item_type', 'unit', '単価', 60, 1),
  ('fee_item_type', 'distance', '距離単価', 70, 1),
  ('fee_item_type', 'table', 'テーブル', 80, 1);
