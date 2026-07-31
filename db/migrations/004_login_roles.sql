-- Login.md に合わせたユーザー権限・所属項目

ALTER TABLE users
  ADD COLUMN roles JSON NULL AFTER role,
  ADD COLUMN departments JSON NULL AFTER permissions,
  ADD COLUMN areas JSON NULL AFTER departments;

-- 既存データの移行
UPDATE users
SET roles = JSON_ARRAY('admin'),
    departments = JSON_ARRAY(),
    areas = JSON_ARRAY()
WHERE role = 'admin';

UPDATE users
SET roles = JSON_ARRAY('soumu'),
    departments = JSON_ARRAY(),
    areas = JSON_ARRAY()
WHERE role = 'staff' AND (roles IS NULL OR JSON_LENGTH(COALESCE(roles, JSON_ARRAY())) = 0);

UPDATE users
SET departments = JSON_ARRAY()
WHERE departments IS NULL;

UPDATE users
SET areas = JSON_ARRAY()
WHERE areas IS NULL;
