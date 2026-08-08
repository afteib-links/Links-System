-- 金額データライフサイクル: 日報への適用セット記録・検索用インデックス

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS applied_price_set_id BIGINT UNSIGNED NULL
    COMMENT '計算時に適用した price_sets'
    AFTER project_id;

CREATE INDEX IF NOT EXISTS idx_price_sets_base_project
  ON price_sets (base_project_id, is_deleted, apply_start_date);

CREATE INDEX IF NOT EXISTS idx_price_sets_project
  ON price_sets (project_id, is_deleted, apply_start_date);
