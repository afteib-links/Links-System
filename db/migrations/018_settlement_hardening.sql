-- 請求・支払・前払統合の安全性改善（予約、取消履歴、訂正、CSV整合）

ALTER TABLE daily_reports
  MODIFY COLUMN billing_status ENUM('none','reserved','billed') NOT NULL DEFAULT 'none',
  MODIFY COLUMN payment_status ENUM('none','reserved','paid') NOT NULL DEFAULT 'none';

ALTER TABLE advance_payment_allocations
  ADD COLUMN IF NOT EXISTS status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500) NULL;

ALTER TABLE settlement_carry_forward_allocations
  ADD COLUMN IF NOT EXISTS status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500) NULL;

ALTER TABLE settlement_workflows
  ADD COLUMN IF NOT EXISTS correction_of_settlement_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS correction_reason VARCHAR(500) NULL,
  ADD KEY IF NOT EXISTS idx_settlement_correction
    (settlement_type, correction_of_settlement_id);

ALTER TABLE cash_export_batch_items
  ADD COLUMN IF NOT EXISTS status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500) NULL;

ALTER TABLE cash_export_batches
  MODIFY COLUMN status ENUM('active','partially_cancelled','cancelled') NOT NULL DEFAULT 'active';
