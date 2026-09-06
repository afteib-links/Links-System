-- 日報提出の受領管理（案件 × 対象月 × 3サイクル）

CREATE TABLE IF NOT EXISTS daily_report_submissions (
  daily_report_submission_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target_year_month CHAR(7) NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  group_code ENUM('early','middle','late') NOT NULL,
  is_submitted TINYINT(1) NOT NULL DEFAULT 0,
  submitted_date DATE NULL,
  overdue_days INT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_daily_report_submission (target_year_month, project_id, group_code),
  KEY idx_daily_report_submission_project (project_id),
  KEY idx_daily_report_submission_date (submitted_date),
  CONSTRAINT fk_daily_report_submission_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_daily_report_submission_user FOREIGN KEY (updated_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_label) VALUES
  ('daily_report_submission_grace_days', '1', '日報提出の猶予日数');
