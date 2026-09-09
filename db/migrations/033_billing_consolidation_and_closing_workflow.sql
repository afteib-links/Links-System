-- 請求先No.0、取りまとめ請求、日報・請求・支払の一括承認、発行無効申請

-- 有効な請求先がない企業には、企業情報を複製した既定請求先を作る。
INSERT INTO company_billings
  (company_id, billing_no, billing_print_name, billing_zip_code, billing_address,
   billing_phone, billing_fax, invoice_send_method, billing_manager, billing_summary_no)
SELECT c.company_id,
       COALESCE((SELECT MAX(existing.billing_no) + 1 FROM company_billings existing WHERE existing.company_id=c.company_id), 0),
       c.company_name, c.zip_code, c.address, c.contact, c.fax,
       c.invoice_send_method, c.contract_manager, NULL
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM company_billings cb
    WHERE cb.company_id=c.company_id AND cb.is_deleted=0
  );

-- 一意制約に衝突しない一時領域を経由し、有効行を先頭にして企業内0始まりへ再採番する。
UPDATE company_billings SET billing_no=billing_no+1000000;

UPDATE company_billings cb
JOIN (
  SELECT a.billing_id,
         SUM(CASE
           WHEN b.is_deleted < a.is_deleted THEN 1
           WHEN b.is_deleted = a.is_deleted AND b.billing_id <= a.billing_id THEN 1
           ELSE 0
         END) - 1 AS next_billing_no
  FROM company_billings a
  JOIN company_billings b ON b.company_id=a.company_id
  GROUP BY a.billing_id
) numbered ON numbered.billing_id=cb.billing_id
SET cb.billing_no=numbered.next_billing_no;

ALTER TABLE base_projects
  ADD COLUMN billing_id BIGINT UNSIGNED NULL AFTER company_id,
  ADD KEY idx_base_projects_billing (billing_id),
  ADD CONSTRAINT fk_base_projects_billing
    FOREIGN KEY (billing_id) REFERENCES company_billings (billing_id);

UPDATE base_projects bp
JOIN company_billings cb
  ON cb.company_id=bp.company_id AND cb.billing_no=0 AND cb.is_deleted=0
SET bp.billing_id=cb.billing_id
WHERE bp.billing_id IS NULL;

UPDATE projects p
JOIN company_billings cb
  ON cb.company_id=p.company_id AND cb.billing_no=0 AND cb.is_deleted=0
SET p.billing_id=cb.billing_id
WHERE p.billing_id IS NULL;

ALTER TABLE base_projects MODIFY COLUMN billing_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE projects MODIFY COLUMN billing_id BIGINT UNSIGNED NOT NULL;

-- 未承認日報も仮明細の根拠にできる。最終承認時に承認スナップショットと再照合する。
ALTER TABLE settlement_line_sources
  MODIFY COLUMN monthly_approval_id BIGINT UNSIGNED NULL;

ALTER TABLE invoices
  ADD COLUMN invoice_type ENUM('normal','consolidated') NOT NULL DEFAULT 'normal' AFTER invoice_id;

ALTER TABLE invoices
  MODIFY COLUMN settlement_status
    ENUM('draft','sales_review_requested','sales_reviewed','supervisor_pending','approved','finalized','issued','cancelled','invalidated')
    NOT NULL DEFAULT 'draft';

ALTER TABLE payments
  MODIFY COLUMN settlement_status
    ENUM('draft','sales_review_requested','sales_reviewed','supervisor_pending','approved','finalized','issued','cancelled','invalidated')
    NOT NULL DEFAULT 'draft';

ALTER TABLE settlement_workflows
  MODIFY COLUMN status
    ENUM('draft','sales_review_requested','sales_reviewed','supervisor_pending','approved','finalized','issued','cancelled','invalidated')
    NOT NULL DEFAULT 'draft',
  ADD COLUMN approved_by_user_id BIGINT UNSIGNED NULL AFTER sales_reviewed_at,
  ADD COLUMN approved_at DATETIME NULL AFTER approved_by_user_id,
  ADD COLUMN issued_by_user_id BIGINT UNSIGNED NULL AFTER finalized_at,
  ADD COLUMN issued_at DATETIME NULL AFTER issued_by_user_id,
  ADD COLUMN invalidated_by_user_id BIGINT UNSIGNED NULL AFTER cancellation_reason,
  ADD COLUMN invalidated_at DATETIME NULL AFTER invalidated_by_user_id,
  ADD COLUMN invalidation_reason VARCHAR(500) NULL AFTER invalidated_at,
  ADD CONSTRAINT fk_sw_approved FOREIGN KEY (approved_by_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_sw_issued FOREIGN KEY (issued_by_user_id) REFERENCES users(user_id),
  ADD CONSTRAINT fk_sw_invalidated FOREIGN KEY (invalidated_by_user_id) REFERENCES users(user_id);

CREATE TABLE invoice_consolidation_sources (
  invoice_consolidation_source_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  parent_invoice_id BIGINT UNSIGNED NOT NULL,
  source_invoice_id BIGINT UNSIGNED NOT NULL,
  source_order INT UNSIGNED NOT NULL DEFAULT 0,
  source_total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  source_snapshot_json JSON NULL,
  released_at DATETIME NULL,
  released_by_user_id BIGINT UNSIGNED NULL,
  release_reason VARCHAR(500) NULL,
  active_source_invoice_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN released_at IS NULL THEN source_invoice_id ELSE NULL END) STORED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_active_invoice_consolidation_source (active_source_invoice_id),
  KEY idx_invoice_consolidation_parent (parent_invoice_id, released_at),
  CONSTRAINT fk_ics_parent FOREIGN KEY (parent_invoice_id) REFERENCES invoices(invoice_id),
  CONSTRAINT fk_ics_source FOREIGN KEY (source_invoice_id) REFERENCES invoices(invoice_id),
  CONSTRAINT fk_ics_release_user FOREIGN KEY (released_by_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE monthly_closing_workflows (
  monthly_closing_workflow_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  target_year_month CHAR(7) NOT NULL,
  revision_no INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('inputting','office_confirmed','sales_review_requested','returned','sales_approved','supervisor_pending','approved','cancelled') NOT NULL DEFAULT 'inputting',
  monthly_approval_id BIGINT UNSIGNED NULL,
  office_confirmed_by_user_id BIGINT UNSIGNED NULL,
  office_confirmed_at DATETIME NULL,
  requested_by_user_id BIGINT UNSIGNED NULL,
  requested_at DATETIME NULL,
  returned_by_user_id BIGINT UNSIGNED NULL,
  returned_at DATETIME NULL,
  return_reason VARCHAR(500) NULL,
  supervisor_decided_by_user_id BIGINT UNSIGNED NULL,
  supervisor_decided_at DATETIME NULL,
  approval_cancelled_by_user_id BIGINT UNSIGNED NULL,
  approval_cancelled_at DATETIME NULL,
  approval_cancellation_reason VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_monthly_closing_revision (project_id, target_year_month, revision_no),
  KEY idx_monthly_closing_status (target_year_month, status),
  CONSTRAINT fk_mcw_project FOREIGN KEY (project_id) REFERENCES projects(project_id),
  CONSTRAINT fk_mcw_approval FOREIGN KEY (monthly_approval_id) REFERENCES daily_report_monthly_approvals(monthly_approval_id),
  CONSTRAINT fk_mcw_office FOREIGN KEY (office_confirmed_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_mcw_requester FOREIGN KEY (requested_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_mcw_returner FOREIGN KEY (returned_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_mcw_supervisor FOREIGN KEY (supervisor_decided_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_mcw_cancel_user FOREIGN KEY (approval_cancelled_by_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE monthly_closing_reviewers (
  monthly_closing_reviewer_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  monthly_closing_workflow_id BIGINT UNSIGNED NOT NULL,
  reviewer_user_id BIGINT UNSIGNED NOT NULL,
  assignment_source ENUM('project','admin_fallback') NOT NULL DEFAULT 'project',
  status ENUM('pending','approved','returned','cancelled') NOT NULL DEFAULT 'pending',
  decision_note VARCHAR(500) NULL,
  decided_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_monthly_closing_reviewer (monthly_closing_workflow_id, reviewer_user_id),
  KEY idx_monthly_reviewer_queue (reviewer_user_id, status),
  CONSTRAINT fk_mcr_workflow FOREIGN KEY (monthly_closing_workflow_id) REFERENCES monthly_closing_workflows(monthly_closing_workflow_id),
  CONSTRAINT fk_mcr_user FOREIGN KEY (reviewer_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settlement_invalidation_requests (
  settlement_invalidation_request_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  settlement_type ENUM('invoice','payment') NOT NULL,
  settlement_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','approved','rejected','applied','cancelled') NOT NULL DEFAULT 'pending',
  reason VARCHAR(500) NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by_user_id BIGINT UNSIGNED NULL,
  decided_at DATETIME NULL,
  decision_note VARCHAR(500) NULL,
  correction_settlement_id BIGINT UNSIGNED NULL,
  KEY idx_invalidation_settlement (settlement_type, settlement_id, status),
  CONSTRAINT fk_sir_requester FOREIGN KEY (requested_by_user_id) REFERENCES users(user_id),
  CONSTRAINT fk_sir_decider FOREIGN KEY (decided_by_user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_label) VALUES
  ('settlement_supervisor_approval_required', '0', '日報・請求・支払の上長承認を必須にする'),
  ('document_invalidation_supervisor_approval_required', '0', '発行済み書類の無効化に上長承認を必須にする');
