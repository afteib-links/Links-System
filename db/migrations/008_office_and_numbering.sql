-- 事業所マスタ + 採番ルール（仮組）

CREATE TABLE IF NOT EXISTS numbering_rules (
  numbering_rule_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_key VARCHAR(64) NOT NULL COMMENT '採番対象キー（office 等）',
  rule_label VARCHAR(100) NOT NULL COMMENT '表示名',
  prefix VARCHAR(32) NOT NULL DEFAULT '' COMMENT '接頭辞',
  pad_digits INT NOT NULL DEFAULT 4 COMMENT 'ゼロ埋め桁数',
  next_number INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '次に振る番号',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_numbering_rules_key (rule_key),
  KEY idx_numbering_rules_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS office_masters (
  office_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  office_no VARCHAR(50) NOT NULL COMMENT '業務キー（採番結果）',
  office_name VARCHAR(200) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_office_masters_no (office_no),
  KEY idx_office_masters_name (office_name),
  KEY idx_office_masters_active (is_active, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO numbering_rules (rule_key, rule_label, prefix, pad_digits, next_number, is_active)
VALUES ('office', '事業所No', '', 4, 1, 1);
