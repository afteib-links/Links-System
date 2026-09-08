ALTER TABLE company_billings
  ADD COLUMN billing_no INT UNSIGNED NULL AFTER company_id;

UPDATE company_billings cb
JOIN (
  SELECT a.billing_id, COUNT(b.billing_id) AS billing_no
  FROM company_billings a
  JOIN company_billings b
    ON b.company_id = a.company_id
   AND b.billing_id <= a.billing_id
  GROUP BY a.billing_id
) numbered ON numbered.billing_id = cb.billing_id
SET cb.billing_no = numbered.billing_no
WHERE cb.billing_no IS NULL;

ALTER TABLE company_billings
  MODIFY COLUMN billing_no INT UNSIGNED NOT NULL,
  ADD UNIQUE KEY uq_company_billings_company_no (company_id, billing_no);

ALTER TABLE projects
  ADD COLUMN billing_id BIGINT UNSIGNED NULL AFTER company_id,
  ADD KEY idx_projects_billing (billing_id),
  ADD CONSTRAINT fk_projects_billing
    FOREIGN KEY (billing_id) REFERENCES company_billings (billing_id);

CREATE TABLE IF NOT EXISTS settlement_projects (
  settlement_project_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_type ENUM('invoice', 'payment') NOT NULL,
  settlement_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_settlement_projects (settlement_type, settlement_id, project_id),
  KEY idx_settlement_projects_project (project_id, settlement_type),
  CONSTRAINT fk_settlement_projects_project
    FOREIGN KEY (project_id) REFERENCES projects (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settlement_projects (settlement_type, settlement_id, project_id)
SELECT 'invoice', l.invoice_id, d.project_id
FROM invoice_daily_reports l
JOIN daily_reports d ON d.daily_report_id = l.daily_report_id
GROUP BY l.invoice_id, d.project_id;

INSERT IGNORE INTO settlement_projects (settlement_type, settlement_id, project_id)
SELECT 'payment', l.payment_id, d.project_id
FROM payment_daily_reports l
JOIN daily_reports d ON d.daily_report_id = l.daily_report_id
GROUP BY l.payment_id, d.project_id;

INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_label) VALUES
  ('status_color_neutral', '#64748B', '状態色：未処理・未作成'),
  ('status_color_working', '#2563EB', '状態色：作業中'),
  ('status_color_waiting', '#D97706', '状態色：確認待ち・保留'),
  ('status_color_complete', '#16805B', '状態色：完了・確定'),
  ('status_color_attention', '#D92D20', '状態色：差戻し・エラー'),
  ('status_color_inactive', '#6B7280', '状態色：取消・無効');
