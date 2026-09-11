-- Verification-only provenance for settlement finalization, documents, cash activity, and bank CSV output.
CREATE TABLE IF NOT EXISTS test_data_output_generation_jobs (
  output_job_id CHAR(36) NOT NULL PRIMARY KEY,
  settlement_job_id CHAR(36) NOT NULL,
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
  UNIQUE KEY uq_test_data_output_settlement_job (settlement_job_id),
  CONSTRAINT fk_test_data_output_settlement_job FOREIGN KEY (settlement_job_id)
    REFERENCES test_data_settlement_generation_jobs(settlement_job_id),
  CONSTRAINT fk_test_data_output_user FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS test_data_finalized_settlements (
  output_job_id CHAR(36) NOT NULL,
  settlement_type ENUM('invoice','payment') NOT NULL,
  settlement_id BIGINT UNSIGNED NOT NULL,
  cash_schedule_id BIGINT UNSIGNED NULL,
  document_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (output_job_id,settlement_type,settlement_id),
  UNIQUE KEY uq_test_data_finalized_settlement (settlement_type,settlement_id),
  CONSTRAINT fk_test_data_finalized_output_job FOREIGN KEY (output_job_id)
    REFERENCES test_data_output_generation_jobs(output_job_id),
  CONSTRAINT fk_test_data_finalized_schedule FOREIGN KEY (cash_schedule_id)
    REFERENCES cash_schedules(cash_schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS test_data_generated_output_artifacts (
  output_job_id CHAR(36) NOT NULL,
  scenario_key VARCHAR(191) NOT NULL,
  artifact_type ENUM('document','manual_schedule','cash_transaction','bank_export') NOT NULL,
  artifact_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NULL,
  file_checksum CHAR(64) NULL,
  PRIMARY KEY (output_job_id,scenario_key),
  KEY idx_test_data_output_artifact (artifact_type,artifact_id),
  CONSTRAINT fk_test_data_output_artifact_job FOREIGN KEY (output_job_id)
    REFERENCES test_data_output_generation_jobs(output_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
