# 運送業務基幹システム：データベース（マスタ）定義書

## 1. 企業マスタ (companies)
顧客（荷主）情報を管理する。
* 企業ID (PK) / 企業名 / 締日（末日・20日・15日・5日等） / 請求書送付方法 / 振込期日

## 2. パートナーマスタ (partners)
業務を担う協力会社・個人事業主を管理する。
* パートナーID (PK) / 氏名 / 外注・給与の区分 / インボイス登録番号 / 振込口座情報 / 前払い利用の可否

## 3. 基本案件マスタ (base_projects) 【テンプレート】
案件の「型」となるデフォルト情報を管理する。
* 基本案件ID (PK) / テンプレート名 / 企業ID / デフォルト担当者・業種 / 基本勤務時間 / 勤務時間種別（拘束 or 実働）
* 稼働形態・日報カウント・残業計算・遂行時間・拘束／休憩・支払区分・締日 等（個別案件と同水準）
* **金額**: テンプレ用 **`price_sets`**（`base_project_id`、複数・適用期間付き）。`price_set_id` 単一 FK は後方互換

## 4. 個別案件マスタ (projects) 【運用用】
基本案件から**複製**（属性＋**PriceSet/行のディープコピー**）して作成。
* 案件ID (PK) / `base_project_id` / 企業ID / パートナーID / 車両 / 担当者・業種
* **支払区分（通常・分割）**、分割単価 等
* **金額**: 案件専用 **`price_sets`**（`project_id`、テンプレとは別 ID）。計算・画面の正

## 5. 金額データ (price_sets / price_set_lines)
* **price_sets**: 名称、`price_set_no`（`PS-YYYYMMDD-001`）、企業、適用開始・終了、`base_project_id` または `project_id`（同時非 NULL 禁止）、備考
* **price_set_lines**: `weekday_code`（`day_type` マスタ: weekday=平日, half=半日…）、`calc_type_code`（daily/hourly）、`price_type_code`、請求／支払単価、並び順
* 同一 owner 内で **適用期間の重複は許可**（日報は開始日が新しい PriceSet を採用）

## 6. 案件条件改定履歴 (project_revisions) 【レガシー】
旧モデル。「何月何日から改定されるか」の履歴と単価を期間別に管理（個別案件に1対多）。
* **現仕様**: 参照用。金額の正は `project_id` 紐づき PriceSet。画面では新規入力非推奨
* 履歴ID (PK) / 案件ID (FK) / 適用開始・終了日 / 基本単価・超過単価等