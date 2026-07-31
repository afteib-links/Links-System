-- ユーザー機能権限・有効フラグを追加

ALTER TABLE users
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER role,
  ADD COLUMN permissions JSON NULL AFTER is_active;

-- 既存管理者は全機能、既存事務担当はマスタ＋日報を初期付与
UPDATE users
SET permissions = JSON_ARRAY(
  'companies', 'partners', 'projects', 'daily_reports',
  'advances', 'invoices', 'payments', 'users'
),
is_active = 1
WHERE role = 'admin';

UPDATE users
SET permissions = JSON_ARRAY(
  'companies', 'partners', 'projects', 'daily_reports'
),
is_active = 1
WHERE role = 'staff' AND (permissions IS NULL OR JSON_LENGTH(permissions) = 0);
