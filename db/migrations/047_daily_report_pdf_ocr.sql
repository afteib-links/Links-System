CREATE TABLE IF NOT EXISTS daily_report_ocr_jobs (
  ocr_job_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  daily_report_import_batch_id BIGINT UNSIGNED NOT NULL,
  job_type VARCHAR(16) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  payload JSON NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  metrics JSON NULL,
  started_at DATETIME NULL,
  heartbeat_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ocr_queue(status,ocr_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_report_pdf_pages (
  pdf_page_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_file_id BIGINT UNSIGNED NOT NULL,
  page_number INT NOT NULL,
  image_path TEXT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  rotation INT NOT NULL DEFAULT 0,
  deskew_angle DECIMAL(8,4) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_pdf_page(source_file_id,page_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE daily_report_import_rows
  ADD COLUMN IF NOT EXISTS pdf_page_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS source_region JSON NULL,
  ADD COLUMN IF NOT EXISTS ocr_confidence JSON NULL,
  ADD COLUMN IF NOT EXISTS source_image_path TEXT NULL;

CREATE TABLE IF NOT EXISTS daily_report_import_applications (
  import_application_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  daily_report_import_row_id BIGINT UNSIGNED NOT NULL,
  request_hash CHAR(64) NOT NULL,
  daily_report_id BIGINT UNSIGNED NOT NULL,
  before_data JSON NULL,
  after_data JSON NOT NULL,
  reason TEXT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_import_application(daily_report_import_row_id,request_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
