-- 金額データアーキテクチャ: 採番・行 CASCADE・曜日区分マスタ

ALTER TABLE price_sets
  ADD COLUMN IF NOT EXISTS price_set_no VARCHAR(32) NULL COMMENT '例 PS-20260801-001'
    AFTER price_set_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_price_sets_no ON price_sets (price_set_no);

-- 物理削除時のみ連動（論理削除はアプリ層）
ALTER TABLE price_set_lines DROP FOREIGN KEY fk_psl_set;
ALTER TABLE price_set_lines
  ADD CONSTRAINT fk_psl_set FOREIGN KEY (price_set_id)
    REFERENCES price_sets (price_set_id) ON DELETE CASCADE;

INSERT IGNORE INTO code_masters (category_code, code_value, code_label, sort_order) VALUES
  ('day_type', 'weekday', '平日', 10),
  ('day_type', 'half', '半日', 20),
  ('day_type', 'sat', '土曜', 30),
  ('day_type', 'sun', '日曜', 40),
  ('day_type', 'holiday', '祝日', 50),
  ('day_type', 'other', 'その他', 60);
