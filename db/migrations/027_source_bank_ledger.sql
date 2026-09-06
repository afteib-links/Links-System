-- 自社振込元口座の期首残高と調整入出金台帳
-- 026 は会社共通画面レイアウト（PR #84）。本変更は 027。

ALTER TABLE source_bank_accounts
  ADD COLUMN IF NOT EXISTS opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER client_code;

CREATE TABLE IF NOT EXISTS source_bank_ledger_entries (
  source_bank_ledger_entry_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_bank_account_id BIGINT UNSIGNED NOT NULL,
  entry_date DATE NOT NULL,
  direction ENUM('incoming','outgoing') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  memo VARCHAR(200) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_source_bank_ledger_account_date (source_bank_account_id, entry_date),
  CONSTRAINT fk_source_bank_ledger_account FOREIGN KEY (source_bank_account_id)
    REFERENCES source_bank_accounts (source_bank_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
