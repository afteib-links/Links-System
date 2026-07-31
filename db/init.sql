-- 運送業務基幹システム（Links-System）初期スキーマ
-- 仕様: 02_master_definition.md / 06_development_environment.md
-- 文字コードは日本語のため utf8mb4 を使用。

SET NAMES utf8mb4;

-- ユーザー（簡易認証・ロール: staff=事務担当 / admin=管理者）
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  login_id VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  role ENUM('staff', 'admin') NOT NULL DEFAULT 'staff',
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 企業マスタ（顧客・荷主）
-- version列は楽観的ロック（同時更新制御）に使用する。
CREATE TABLE IF NOT EXISTS companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  closing_day VARCHAR(16) NOT NULL DEFAULT '末日',
  invoice_delivery_method VARCHAR(64) NULL,
  payment_due VARCHAR(64) NULL,
  version INT NOT NULL DEFAULT 1,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
