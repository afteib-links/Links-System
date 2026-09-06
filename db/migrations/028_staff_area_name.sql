-- 営業担当者のエリア（収支分析の抽出・階層用）
ALTER TABLE staff_masters
  ADD COLUMN IF NOT EXISTS area_name VARCHAR(100) NULL AFTER role_label;
