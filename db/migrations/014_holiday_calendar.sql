-- 祝日・案件独自休日を日報の料金区分自動選択へ反映する

CREATE TABLE IF NOT EXISTS holidays (
  holiday_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  holiday_date DATE NOT NULL,
  holiday_name VARCHAR(200) NOT NULL,
  project_id BIGINT UNSIGNED NULL COMMENT 'NULLは全案件共通の祝日',
  scope_project_id BIGINT UNSIGNED AS (IFNULL(project_id, 0)) PERSISTENT,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_holiday_date_scope (holiday_date, scope_project_id),
  KEY idx_holiday_project_date (project_id, holiday_date),
  CONSTRAINT fk_holiday_project FOREIGN KEY (project_id) REFERENCES projects (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
