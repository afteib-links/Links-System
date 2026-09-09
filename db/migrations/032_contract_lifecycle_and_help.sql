-- 契約ライフサイクルと全機能共通ヘルプ

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS contract_status_code VARCHAR(32) NOT NULL DEFAULT 'active' AFTER contract_date,
  ADD COLUMN IF NOT EXISTS operation_end_date DATE NULL AFTER contract_status_code;

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS contract_status_code VARCHAR(32) NOT NULL DEFAULT 'active' AFTER work_start_date,
  ADD COLUMN IF NOT EXISTS operation_end_date DATE NULL AFTER contract_status_code;

ALTER TABLE base_projects
  ADD COLUMN IF NOT EXISTS contract_status_code VARCHAR(32) NOT NULL DEFAULT 'active' AFTER operation_start_date,
  ADD COLUMN IF NOT EXISTS operation_end_date DATE NULL AFTER contract_status_code;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS basic_work_hours DECIMAL(6,2) NULL AFTER business_type;

INSERT IGNORE INTO code_masters
  (category_code, code_value, code_label, sort_order, is_active)
VALUES
  ('contract_status', 'active', '稼働中', 10, 1),
  ('contract_status', 'paused', '一時休止中', 20, 1),
  ('contract_status', 'ending', '終了予定', 30, 1),
  ('contract_status', 'ended', '終了', 40, 1);

CREATE TABLE IF NOT EXISTS help_contents (
  help_content_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  screen_key VARCHAR(64) NOT NULL,
  help_title VARCHAR(200) NOT NULL,
  overview_text TEXT NULL,
  input_effect_text TEXT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_help_contents_screen (screen_key),
  KEY idx_help_contents_active (is_deleted, screen_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_counterparty_sequences (
  document_type ENUM('invoice','invoice_summary','payment_statement','salary_statement') NOT NULL,
  document_year SMALLINT UNSIGNED NOT NULL,
  counterparty_id BIGINT UNSIGNED NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (document_type, document_year, counterparty_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO help_contents (screen_key, help_title, overview_text, input_effect_text) VALUES
  ('home', '業務ダッシュボードのヘルプ', '各業務の件数と対応状況を確認する画面です。', 'カードを選ぶと対象機能を開きます。'),
  ('base_management', '基本管理のヘルプ', '企業から金額データまでの紐付きを横断確認します。', '項目をクリックすると詳細、ダブルクリックすると編集画面を開きます。全対象は再度押すと解除できます。'),
  ('companies', '企業マスタのヘルプ', '請求元となる企業情報と請求先を管理します。', '契約状況が終了、または稼働終了日を過ぎた企業は通常一覧から除外されます。'),
  ('partners', 'パートナーマスタのヘルプ', '支払先となるパートナー情報を管理します。', '先払い対象を有効にすると、新しく紐付ける個別案件も先払い対象になります。'),
  ('base_projects', '基本案件のヘルプ', '繰り返し利用する案件条件のひな形を管理します。', '勤務条件と金額データは個別案件作成時に複製されます。'),
  ('projects', '個別案件のヘルプ', '実際に稼働する企業・パートナー・請求先を紐付けます。', '請求先Noは請求作成時の宛先に使われ、勤務条件は日報計算へ反映されます。'),
  ('price_sets', '金額データのヘルプ', '案件へ適用する請求・支払単価を期間別に管理します。', '基本案件の金額は個別案件作成時に独立コピーされ、既存案件へ遡及しません。'),
  ('office_work', '事務作業のヘルプ', '日報・請求・支払の進捗を横断確認します。', '対象月や企業等で絞り込み、各処理画面へ移動できます。'),
  ('daily_reports', '日報のヘルプ', '日々の開始・終了時刻、休憩時間、経費等を入力します。', '入力内容から請求・支払の計算明細が作成されます。'),
  ('daily_report_submissions', '日報提出のヘルプ', '案件ごとの提出状況と遅延を確認します。', '提出状態は日報の月次承認前の確認に使われます。'),
  ('advances', '先払管理のヘルプ', '対象案件の先払額と振込手数料を管理します。', '作成した先払実績は正式支払時の控除候補になります。'),
  ('invoices', '請求管理のヘルプ', '案件を請求先単位にまとめ、請求書を作成します。', '日報から再反映はその時点のデータを取り込みます。最終確定には月次承認が必要です。'),
  ('payments', '支払管理のヘルプ', 'パートナー単位の支払明細と控除を作成します。', '日報から再反映はその時点のデータを取り込みます。最終確定には月次承認が必要です。'),
  ('cash_management', '入出金管理のヘルプ', '入出金予定・実績と銀行CSVを管理します。', '最終確定した請求・支払は指定した締日の予定へ反映されます。'),
  ('analytics', '収支分析のヘルプ', '企業・パートナー・案件の収支を確認します。', '対象月や条件を変更すると集計範囲が変わります。'),
  ('master_settings', 'マスター設定のヘルプ', '各機能で使う名称・色・計算設定を管理します。', '変更は保存後の画面表示や新しい計算へ反映されます。'),
  ('help_settings', 'ヘルプ編集設定のヘルプ', '全機能のヘルプ本文を編集します。', '保存した内容は各画面のヘルプボタンから全利用者へ表示されます。'),
  ('ui_builder', 'UIビルダーのヘルプ', '各一覧画面の列順と表示・非表示を設定します。', '保存したレイアウトは同じ会社の利用者が開く一覧へ反映されます。'),
  ('users', 'ユーザー管理のヘルプ', '利用者、ロール、利用可能機能を管理します。', '権限変更は対象利用者の次回画面表示から反映されます。');

INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_label) VALUES
  ('status_label_draft', '下書き', '状態名称：下書き'),
  ('status_label_submitted', '承認待ち', '状態名称：承認待ち'),
  ('status_label_awaiting_approval', '日報承認待ち', '状態名称：日報承認待ち'),
  ('status_label_confirmed', '日次確認済み', '状態名称：日次確認済み'),
  ('status_label_sales_reviewed', '営業確認済み', '状態名称：営業確認済み'),
  ('status_label_approved', '承認済み', '状態名称：承認済み'),
  ('status_label_finalized', '最終確定済み', '状態名称：最終確定済み'),
  ('status_label_issued', '発行済み', '状態名称：発行済み'),
  ('status_label_paid', '支払済み', '状態名称：支払済み'),
  ('status_label_cancelled', '取消済み', '状態名称：取消済み'),
  ('status_label_active', '有効', '状態名称：有効'),
  ('status_label_inactive', '無効', '状態名称：無効');
