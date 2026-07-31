-- 企業マスタ仮組用の区分マスタ追加

INSERT IGNORE INTO code_masters (category_code, code_value, code_label, sort_order) VALUES
  ('deposit_type', 'ordinary', '普通', 10),
  ('deposit_type', 'checking', '当座', 20),
  ('deposit_type', 'savings', '貯蓄', 30),
  ('invoice_send_method', 'email', 'メール', 10),
  ('invoice_send_method', 'post', '郵送', 20),
  ('invoice_send_method', 'hand', '手渡し', 30),
  ('invoice_send_method', 'other', 'その他', 40);
