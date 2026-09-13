-- 役割ごとの機能利用設定。未登録の組合せはアプリの初期値を使用する。
CREATE TABLE IF NOT EXISTS feature_role_permissions (
  role_key VARCHAR(32) NOT NULL,
  feature_key VARCHAR(64) NOT NULL,
  is_allowed TINYINT(1) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (role_key, feature_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_role_permission_revision (
  singleton_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO feature_role_permission_revision (singleton_id,revision) VALUES (1,1);

-- DB出力Excelの取込キーと出力時版。元の業務値は保存しない。
CREATE TABLE IF NOT EXISTS master_data_db_export_rows (
  export_key VARCHAR(100) NOT NULL PRIMARY KEY,
  batch_key CHAR(32) NOT NULL,
  entity_type VARCHAR(32) NOT NULL,
  record_id BIGINT UNSIGNED NOT NULL,
  record_version INT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_master_db_export_batch (batch_key),
  KEY idx_master_db_export_record (entity_type,record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
