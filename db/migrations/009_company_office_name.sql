-- 企業ごとの事業所名（任意）。事業所Noは採番ルールで自動付与。

ALTER TABLE companies
  ADD COLUMN office_name VARCHAR(200) NULL COMMENT '事業所名（企業ごと・任意）' AFTER office_no;
