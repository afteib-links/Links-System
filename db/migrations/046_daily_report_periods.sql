CREATE TABLE IF NOT EXISTS daily_report_periods (
  daily_report_period_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  target_year_month CHAR(7) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  closing_day VARCHAR(10) NOT NULL,
  period_mode VARCHAR(24) NOT NULL DEFAULT 'closing',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_daily_period (project_id,target_year_month),
  KEY idx_daily_period_dates (project_id,period_start,period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- DDL途中停止後の再実行でも日報と同じ照合順序にそろえる。
ALTER TABLE daily_report_periods MODIFY target_year_month CHAR(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

-- 旧データの所属と確定金額は変更しない。既存月は暦月として固定する。
INSERT IGNORE INTO daily_report_periods
  (project_id,target_year_month,period_start,period_end,closing_day,period_mode)
SELECT project_id,target_year_month,CONCAT(target_year_month,'-01'),
       LAST_DAY(CONCAT(target_year_month,'-01')),'end','legacy_calendar'
FROM (
  SELECT DISTINCT project_id,target_year_month FROM daily_reports WHERE is_deleted=0
  UNION SELECT DISTINCT project_id,target_year_month FROM daily_report_monthly_approvals
) legacy WHERE target_year_month REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$';

ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS daily_report_period_id BIGINT UNSIGNED NULL;
UPDATE daily_reports d JOIN daily_report_periods p
  ON p.project_id=d.project_id AND p.target_year_month=d.target_year_month
SET d.daily_report_period_id=p.daily_report_period_id
WHERE d.daily_report_period_id IS NULL;

CREATE TABLE IF NOT EXISTS daily_report_period_audits (
  daily_report_period_audit_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  before_data JSON NOT NULL,
  after_data JSON NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
