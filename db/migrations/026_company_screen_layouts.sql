-- 一覧表示列は会社共通。UIビルダーの保存を全利用者が参照する。
CREATE TABLE IF NOT EXISTS company_screen_layouts (
  layout_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  screen_key VARCHAR(64) NOT NULL,
  columns_json JSON NULL,
  layout_json JSON NULL,
  updated_by BIGINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  extra_data JSON NULL,
  UNIQUE KEY uq_company_screen (screen_key),
  KEY idx_csl_updated_by (updated_by),
  CONSTRAINT fk_csl_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO company_screen_layouts (screen_key, columns_json, layout_json, updated_by, version)
SELECT u.screen_key, u.columns_json, u.layout_json, u.user_id, u.version
  FROM user_screen_layouts u
  INNER JOIN (
    SELECT screen_key, MAX(layout_id) AS layout_id
      FROM user_screen_layouts
     WHERE is_deleted = 0
     GROUP BY screen_key
  ) latest ON latest.screen_key = u.screen_key AND latest.layout_id = u.layout_id
 WHERE u.is_deleted = 0
ON DUPLICATE KEY UPDATE
  columns_json = VALUES(columns_json),
  layout_json = VALUES(layout_json),
  updated_by = VALUES(updated_by),
  version = VALUES(version);
