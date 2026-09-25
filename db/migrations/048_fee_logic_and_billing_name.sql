ALTER TABLE company_billings ADD COLUMN billing_name VARCHAR(200) NULL AFTER billing_no;
UPDATE company_billings b LEFT JOIN companies c ON c.company_id=b.company_id
SET b.billing_name=COALESCE(NULLIF(b.billing_print_name,''),c.company_name);

CREATE TABLE fee_logic_masters (
  code VARCHAR(64) PRIMARY KEY,
  kind ENUM('logic','group') NOT NULL,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE fee_logic_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  master_code VARCHAR(64) NOT NULL,
  version_no INT NOT NULL,
  effective_from DATE NOT NULL,
  definition_json JSON NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  actor_user_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fee_logic_version (master_code,version_no),
  UNIQUE KEY uq_fee_logic_date (master_code,effective_from),
  FOREIGN KEY (master_code) REFERENCES fee_logic_masters(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO fee_logic_masters(code,kind,name) VALUES
('multiply','logic','数量 × 単価（加算）'),('deduct','logic','数量 × 単価（控除）'),
('daily','group','基本日計算グループ'),('hourly','group','基本時間計算グループ'),
('quantity','group','数量計算グループ'),('distance','group','距離計算グループ');
INSERT INTO fee_logic_versions(master_code,version_no,effective_from,definition_json,reason) VALUES
('multiply',1,'1000-01-01',JSON_OBJECT('expression','unit_price * quantity'),'既存計算と互換の初期定義'),
('deduct',1,'1000-01-01',JSON_OBJECT('expression','-(unit_price * quantity)'),'不足数量を正の絶対値として扱う初期定義');
INSERT INTO fee_logic_versions(master_code,version_no,effective_from,definition_json,reason)
SELECT code,1,'1000-01-01',JSON_OBJECT('members',JSON_OBJECT(
  'basic','multiply','shortage','deduct','overtime','multiply','night','multiply',
  'night_overtime','multiply','distance','multiply','unit','multiply')),
  '単価・数量分類・丸めは料金カードと日報設定を維持'
FROM fee_logic_masters WHERE kind='group';
