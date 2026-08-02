-- 曜日マスタに祝日区分を追加（金額データ UI: 月火水木金土日祝）

INSERT IGNORE INTO code_masters (category_code, code_value, code_label, sort_order) VALUES
  ('weekday', 'holiday', '祝', 80);
