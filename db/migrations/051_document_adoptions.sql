ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS quantity_overrides JSON NULL;
ALTER TABLE daily_report_import_rows ADD COLUMN IF NOT EXISTS reviewed_observations JSON NULL;

CREATE TABLE IF NOT EXISTS daily_report_document_links (
  document_link_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  daily_report_import_row_id BIGINT UNSIGNED NOT NULL,
  daily_report_id BIGINT UNSIGNED NOT NULL,
  pdf_page_id BIGINT UNSIGNED NOT NULL,
  additional_item_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_document_link(daily_report_import_row_id,pdf_page_id),
  KEY idx_document_daily(daily_report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO additional_item_masters(item_name,calculation_method,applies_to,tax_category)
SELECT '業務経費','direct','both','tax_inclusive'
WHERE NOT EXISTS (SELECT 1 FROM additional_item_masters WHERE item_name='業務経費' AND calculation_method='direct');
