-- Verification-only generation jobs and generated-record provenance.
CREATE TABLE IF NOT EXISTS test_data_generation_jobs (
  job_id CHAR(36) NOT NULL PRIMARY KEY,
  draft_id CHAR(36) NOT NULL,
  draft_revision INT NOT NULL,
  approved_hash CHAR(64) NOT NULL,
  status ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
  total_count INT UNSIGNED NOT NULL DEFAULT 0,
  processed_count INT UNSIGNED NOT NULL DEFAULT 0,
  manifest_json LONGTEXT NULL,
  error_message VARCHAR(1000) NULL,
  created_by INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_test_data_job_draft_revision (draft_id, draft_revision),
  CONSTRAINT fk_test_data_job_draft FOREIGN KEY (draft_id) REFERENCES test_data_drafts (draft_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS test_data_generated_daily_reports (
  job_id CHAR(36) NOT NULL,
  scenario_key VARCHAR(100) NOT NULL,
  scenario_code VARCHAR(32) NOT NULL,
  daily_report_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (job_id, scenario_key),
  UNIQUE KEY uq_test_data_generated_report (daily_report_id),
  CONSTRAINT fk_test_data_generated_job FOREIGN KEY (job_id) REFERENCES test_data_generation_jobs (job_id),
  CONSTRAINT fk_test_data_generated_daily FOREIGN KEY (daily_report_id) REFERENCES daily_reports (daily_report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
