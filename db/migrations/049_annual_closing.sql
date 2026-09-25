CREATE TABLE IF NOT EXISTS annual_closing_settings (
  setting_id INT PRIMARY KEY,
  include_previous_tail TINYINT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO annual_closing_settings(setting_id) VALUES (1);
CREATE TABLE IF NOT EXISTS annual_closings (
  annual_closing_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fiscal_year INT NOT NULL,
  revision_no INT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  correction_of_id BIGINT UNSIGNED NULL,
  reason TEXT NOT NULL,
  input_data JSON NOT NULL,
  snapshot_data JSON NOT NULL,
  source_token CHAR(64) NOT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  finalized_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at DATETIME NULL,
  UNIQUE KEY uq_annual_revision(fiscal_year,revision_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS annual_closing_reviews (
  annual_review_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  annual_closing_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  reviewer_user_id BIGINT UNSIGNED NOT NULL,
  assignment_source VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  note TEXT NULL,
  decided_at DATETIME NULL,
  UNIQUE KEY uq_annual_reviewer(annual_closing_id,project_id,reviewer_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS annual_closing_locks (
  annual_lock_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  annual_closing_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  KEY idx_annual_project_lock(project_id,is_active,period_start,period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS annual_closing_documents (
  annual_document_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  annual_closing_id BIGINT UNSIGNED NOT NULL,
  document_type VARCHAR(24) NOT NULL,
  document_number VARCHAR(120) NOT NULL UNIQUE,
  file_name VARCHAR(180) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  snapshot_data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_annual_document(annual_closing_id,document_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS annual_closing_audits (
  annual_audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  annual_closing_id BIGINT UNSIGNED NULL,
  action_code VARCHAR(32) NOT NULL,
  before_data JSON NULL,
  after_data JSON NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
