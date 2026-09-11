-- Master values completed only inside a verification generation environment.
CREATE TABLE IF NOT EXISTS test_data_generated_project_overrides (
  monthly_job_id CHAR(36) NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  field_code VARCHAR(64) NOT NULL,
  original_value VARCHAR(255) NULL,
  generated_value VARCHAR(255) NOT NULL,
  PRIMARY KEY (monthly_job_id,project_id,field_code),
  CONSTRAINT fk_test_data_override_job FOREIGN KEY (monthly_job_id) REFERENCES test_data_monthly_generation_jobs(monthly_job_id),
  CONSTRAINT fk_test_data_override_project FOREIGN KEY (project_id) REFERENCES projects(project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
