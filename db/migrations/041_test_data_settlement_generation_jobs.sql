-- Provenance for verification-only advance, invoice, and payment generation.
CREATE TABLE IF NOT EXISTS test_data_settlement_generation_jobs (
  settlement_job_id CHAR(36) NOT NULL PRIMARY KEY,
  monthly_job_id CHAR(36) NOT NULL,
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
  UNIQUE KEY uq_test_data_settlement_monthly_job (monthly_job_id),
  CONSTRAINT fk_test_data_settlement_monthly_job FOREIGN KEY (monthly_job_id) REFERENCES test_data_monthly_generation_jobs(monthly_job_id),
  CONSTRAINT fk_test_data_settlement_user FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS test_data_generated_settlements (
  settlement_job_id CHAR(36) NOT NULL,
  scenario_key VARCHAR(191) NOT NULL,
  scenario_code VARCHAR(32) NOT NULL,
  settlement_type ENUM('invoice','payment') NOT NULL,
  settlement_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (settlement_job_id,scenario_key),
  UNIQUE KEY uq_test_data_generated_settlement (settlement_type,settlement_id),
  CONSTRAINT fk_test_data_generated_settlement_job FOREIGN KEY (settlement_job_id) REFERENCES test_data_settlement_generation_jobs(settlement_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS test_data_generated_advances (
  settlement_job_id CHAR(36) NOT NULL,
  scenario_key VARCHAR(191) NOT NULL,
  scenario_code VARCHAR(32) NOT NULL,
  advance_record_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (settlement_job_id,scenario_key),
  UNIQUE KEY uq_test_data_generated_advance (advance_record_id),
  CONSTRAINT fk_test_data_generated_advance_job FOREIGN KEY (settlement_job_id) REFERENCES test_data_settlement_generation_jobs(settlement_job_id),
  CONSTRAINT fk_test_data_generated_advance_record FOREIGN KEY (advance_record_id) REFERENCES advance_records(advance_record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
