-- Issue #121: 編集用マスターExcel取込の履歴と安定キー対応

CREATE TABLE IF NOT EXISTS master_data_import_batches (
  batch_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  total_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  conflict_count INT UNSIGNED NOT NULL DEFAULT 0,
  result_code ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  KEY idx_master_import_batches_actor (actor_user_id, started_at),
  CONSTRAINT fk_master_import_batches_actor FOREIGN KEY (actor_user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS master_data_import_mappings (
  mapping_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('company','billing','company_vehicle','partner','partner_vehicle','base_project','project','price_set','price_line') NOT NULL,
  import_key VARCHAR(191) NOT NULL,
  record_id BIGINT UNSIGNED NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  first_batch_id BIGINT UNSIGNED NOT NULL,
  last_batch_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_master_import_mapping_key (entity_type, import_key),
  KEY idx_master_import_mapping_record (entity_type, record_id),
  CONSTRAINT fk_master_import_mapping_first_batch FOREIGN KEY (first_batch_id) REFERENCES master_data_import_batches (batch_id),
  CONSTRAINT fk_master_import_mapping_last_batch FOREIGN KEY (last_batch_id) REFERENCES master_data_import_batches (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
