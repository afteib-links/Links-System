-- Excel帳票イメージに合わせた発行元・振込先・印影設定。
-- 画像はdata URLを設定可能だが、初期値は空欄とし、実データをリポジトリへ持ち込まない。

INSERT IGNORE INTO system_settings (setting_key,setting_value,setting_label) VALUES
  ('document_issuer_name','','帳票 発行元名称'),
  ('document_issuer_zip_code','','帳票 発行元郵便番号'),
  ('document_issuer_address','','帳票 発行元住所'),
  ('document_issuer_registration_number','','帳票 適格請求書発行事業者登録番号'),
  ('document_issuer_tel','','帳票 発行元電話番号'),
  ('document_issuer_fax','','帳票 発行元FAX番号'),
  ('document_issuer_bank_accounts','[]','帳票 振込口座一覧（JSON）'),
  ('document_issuer_logo_data_url','','帳票 会社ロゴ（data URL）'),
  ('document_issuer_stamp_data_url','','帳票 社印（data URL）'),
  ('document_transfer_fee_note','恐れ入りますが、振込手数料は御社でご負担をお願い申し上げます。','帳票 振込手数料注記');
