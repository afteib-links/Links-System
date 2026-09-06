-- Issue #79: 銀行別CSV出力、振込元口座、版管理された列定義

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS bank_code CHAR(4) NULL AFTER payment_output_code,
  ADD COLUMN IF NOT EXISTS branch_code CHAR(3) NULL AFTER bank_name,
  ADD COLUMN IF NOT EXISTS account_name_kana VARCHAR(100) NULL AFTER account_name;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS bank_code CHAR(4) NULL AFTER business_content,
  ADD COLUMN IF NOT EXISTS branch_code CHAR(3) NULL AFTER bank_name,
  ADD COLUMN IF NOT EXISTS account_name_kana VARCHAR(100) NULL AFTER account_name;

CREATE TABLE IF NOT EXISTS bank_export_profiles (
  bank_export_profile_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profile_code VARCHAR(50) NOT NULL,
  profile_name VARCHAR(120) NOT NULL,
  bank_family VARCHAR(32) NOT NULL,
  description VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_bank_export_profile_code (profile_code),
  KEY idx_bank_export_profile_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bank_export_profile_versions (
  bank_export_profile_version_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bank_export_profile_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  status ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  encoding_code ENUM('utf8','utf8_bom','cp932') NOT NULL DEFAULT 'utf8_bom',
  delimiter_text VARCHAR(8) NOT NULL DEFAULT ',',
  quote_mode ENUM('all','minimal','none') NOT NULL DEFAULT 'all',
  quote_char CHAR(1) NOT NULL DEFAULT '"',
  include_header TINYINT(1) NOT NULL DEFAULT 1,
  line_ending ENUM('crlf','lf') NOT NULL DEFAULT 'crlf',
  file_name_pattern VARCHAR(200) NOT NULL DEFAULT '{bank}_{YYYYMMDD}_{cycle}.csv',
  verification_note VARCHAR(500) NULL,
  published_at DATETIME NULL,
  published_by BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bank_export_profile_version (bank_export_profile_id, version_no),
  KEY idx_bank_export_profile_version_status (bank_export_profile_id, status),
  CONSTRAINT fk_bank_export_version_profile FOREIGN KEY (bank_export_profile_id)
    REFERENCES bank_export_profiles (bank_export_profile_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bank_export_columns (
  bank_export_column_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bank_export_profile_version_id BIGINT UNSIGNED NOT NULL,
  column_key VARCHAR(80) NOT NULL,
  column_label VARCHAR(120) NOT NULL,
  source_key VARCHAR(80) NOT NULL,
  fixed_value VARCHAR(500) NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  format_code VARCHAR(32) NULL,
  zero_pad_length INT UNSIGNED NULL,
  max_length INT UNSIGNED NULL,
  transform_code ENUM('none','digits','half_width','katakana','upper') NOT NULL DEFAULT 'none',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bank_export_column_key (bank_export_profile_version_id, column_key),
  KEY idx_bank_export_column_order (bank_export_profile_version_id, sort_order, bank_export_column_id),
  CONSTRAINT fk_bank_export_column_version FOREIGN KEY (bank_export_profile_version_id)
    REFERENCES bank_export_profile_versions (bank_export_profile_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS source_bank_accounts (
  source_bank_account_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_label VARCHAR(120) NOT NULL,
  bank_export_profile_id BIGINT UNSIGNED NOT NULL,
  bank_code CHAR(4) NOT NULL,
  bank_name VARCHAR(100) NOT NULL,
  branch_code CHAR(3) NOT NULL,
  branch_name VARCHAR(100) NOT NULL,
  deposit_type VARCHAR(32) NOT NULL,
  account_number VARCHAR(20) NOT NULL,
  account_name_kana VARCHAR(100) NOT NULL,
  client_code VARCHAR(40) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_source_bank_account_active (is_active, is_deleted),
  CONSTRAINT fk_source_bank_account_profile FOREIGN KEY (bank_export_profile_id)
    REFERENCES bank_export_profiles (bank_export_profile_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE cash_export_batches
  ADD COLUMN IF NOT EXISTS export_kind ENUM('confirmation_csv','bank_csv') NOT NULL DEFAULT 'confirmation_csv' AFTER cash_cycle_id,
  ADD COLUMN IF NOT EXISTS source_bank_account_id BIGINT UNSIGNED NULL AFTER bank_name,
  ADD COLUMN IF NOT EXISTS bank_export_profile_version_id BIGINT UNSIGNED NULL AFTER source_bank_account_id,
  ADD COLUMN IF NOT EXISTS scheduled_transfer_date DATE NULL AFTER bank_export_profile_version_id,
  ADD COLUMN IF NOT EXISTS definition_snapshot_json JSON NULL AFTER scheduled_transfer_date,
  ADD COLUMN IF NOT EXISTS file_checksum CHAR(64) NULL AFTER definition_snapshot_json,
  ADD COLUMN IF NOT EXISTS total_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER file_checksum,
  ADD COLUMN IF NOT EXISTS total_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER total_count,
  ADD CONSTRAINT fk_cash_export_source_account FOREIGN KEY (source_bank_account_id)
    REFERENCES source_bank_accounts (source_bank_account_id),
  ADD CONSTRAINT fk_cash_export_profile_version FOREIGN KEY (bank_export_profile_version_id)
    REFERENCES bank_export_profile_versions (bank_export_profile_version_id);

ALTER TABLE cash_export_batch_items
  ADD COLUMN IF NOT EXISTS export_row_no INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS export_row_json JSON NULL;

INSERT IGNORE INTO bank_export_profiles
  (profile_code, profile_name, bank_family, description, is_active)
VALUES
  ('resona_group_csv', 'りそなグループ CSV', 'resona', 'りそな銀行・埼玉りそな銀行向け。正式仕様確認後に公開する。', 1),
  ('mizuho_csv', 'みずほ銀行 CSV', 'mizuho', '契約サービスの正式仕様確認後に公開する。', 1),
  ('smbc_csv', '三井住友銀行 CSV', 'smbc', '契約サービスの正式仕様確認後に公開する。', 1);

INSERT IGNORE INTO bank_export_profile_versions
  (bank_export_profile_id, version_no, status, encoding_code, delimiter_text, quote_mode,
   include_header, line_ending, file_name_pattern, verification_note)
SELECT bank_export_profile_id, 1, 'draft', 'utf8_bom', ',', 'all', 1, 'crlf',
       CONCAT(profile_code, '_{YYYYMMDD}_{cycle}.csv'),
       '未検証。契約中の銀行サービス仕様書と取込試験結果を確認してから公開してください。'
FROM bank_export_profiles
WHERE profile_code IN ('resona_group_csv','mizuho_csv','smbc_csv');

INSERT IGNORE INTO bank_export_columns
  (bank_export_profile_version_id, column_key, column_label, source_key, is_required, format_code, zero_pad_length, max_length, transform_code, sort_order)
SELECT v.bank_export_profile_version_id, x.column_key, x.column_label, x.source_key,
       x.is_required, x.format_code, x.zero_pad_length, x.max_length, x.transform_code, x.sort_order
FROM bank_export_profile_versions v
JOIN bank_export_profiles p ON p.bank_export_profile_id = v.bank_export_profile_id
JOIN (
  SELECT 'transfer_date' column_key, '振込指定日' column_label, 'transfer_date' source_key, 1 is_required, 'YYYYMMDD' format_code, NULL zero_pad_length, 8 max_length, 'none' transform_code, 10 sort_order
  UNION ALL SELECT 'bank_code','銀行コード','beneficiary_bank_code',1,NULL,4,4,'digits',20
  UNION ALL SELECT 'branch_code','支店コード','beneficiary_branch_code',1,NULL,3,3,'digits',30
  UNION ALL SELECT 'deposit_type','口座種別','beneficiary_deposit_type',1,NULL,NULL,16,'none',40
  UNION ALL SELECT 'account_number','口座番号','beneficiary_account_number',1,NULL,7,7,'digits',50
  UNION ALL SELECT 'account_name','口座名義カナ','beneficiary_account_name_kana',1,NULL,NULL,100,'katakana',60
  UNION ALL SELECT 'amount','振込金額','amount',1,NULL,NULL,14,'digits',70
  UNION ALL SELECT 'schedule_id','予定ID','cash_schedule_id',0,NULL,NULL,20,'digits',80
) x
WHERE p.profile_code IN ('resona_group_csv','mizuho_csv','smbc_csv') AND v.version_no = 1;

