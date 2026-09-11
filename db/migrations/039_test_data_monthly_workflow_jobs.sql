-- Provenance for verification-only daily-report submission and monthly approval generation.
CREATE TABLE IF NOT EXISTS test_data_monthly_generation_jobs (
  monthly_job_id CHAR(36) NOT NULL PRIMARY KEY,
  daily_job_id CHAR(36) NOT NULL,
  status ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
  total_count INT UNSIGNED NOT NULL DEFAULT 0,
  processed_count INT UNSIGNED NOT NULL DEFAULT 0,
  manifest_json LONGTEXT NULL,
  error_message VARCHAR(1000) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_test_data_monthly_daily_job (daily_job_id),
  CONSTRAINT fk_test_data_monthly_daily_job FOREIGN KEY (daily_job_id) REFERENCES test_data_generation_jobs(job_id),
  CONSTRAINT fk_test_data_monthly_user FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS test_data_generated_submissions (
  monthly_job_id CHAR(36) NOT NULL,
  scenario_key VARCHAR(100) NOT NULL,
  scenario_code VARCHAR(32) NOT NULL,
  daily_report_submission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (monthly_job_id,scenario_key),
  UNIQUE KEY uq_test_data_generated_submission (daily_report_submission_id),
  CONSTRAINT fk_test_data_submission_job FOREIGN KEY (monthly_job_id) REFERENCES test_data_monthly_generation_jobs(monthly_job_id),
  CONSTRAINT fk_test_data_submission_record FOREIGN KEY (daily_report_submission_id) REFERENCES daily_report_submissions(daily_report_submission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS test_data_generated_monthly_approvals (
  monthly_job_id CHAR(36) NOT NULL,
  scenario_key VARCHAR(100) NOT NULL,
  scenario_code VARCHAR(32) NOT NULL,
  monthly_approval_id BIGINT UNSIGNED NOT NULL,
  monthly_closing_workflow_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (monthly_job_id,scenario_key),
  UNIQUE KEY uq_test_data_generated_approval (monthly_approval_id),
  CONSTRAINT fk_test_data_approval_job FOREIGN KEY (monthly_job_id) REFERENCES test_data_monthly_generation_jobs(monthly_job_id),
  CONSTRAINT fk_test_data_approval_record FOREIGN KEY (monthly_approval_id) REFERENCES daily_report_monthly_approvals(monthly_approval_id),
  CONSTRAINT fk_test_data_approval_workflow FOREIGN KEY (monthly_closing_workflow_id) REFERENCES monthly_closing_workflows(monthly_closing_workflow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
