-- パートナー基本情報に連絡用メールアドレスを追加する。
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) NULL AFTER contact_phone;
