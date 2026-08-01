# 基本案件・個別案件・金額データの関係

## 概念対応（Prisma 名 → 本システム MariaDB）

| 概念 | テーブル／列 |
|------|----------------|
| ProjectTemplate | `base_projects` |
| Project.templateId | `projects.base_project_id` |
| PriceSet（テンプレ） | `price_sets`（`base_project_id` のみ、`project_id` は NULL） |
| PriceSet（案件実体） | `price_sets`（`project_id` のみ、`base_project_id` は NULL） |
| PriceRow | `price_set_lines` |
| 適用期間 | `apply_start_date` / `apply_end_date` |
| 日報適用記録 | `daily_reports.applied_price_set_id` |

## ライフサイクル

1. **基本案件**に適用期間付きの金額データ（`price_sets` + 行）を複数登録できる。
2. **案件作成**（基本案件から／個別新規で `base_project_id` 指定）時、テンプレに紐づく全 `price_sets` と行を **ディープコピー** し、新案件専用の `price_sets`（別 ID）として保存する。テンプレ改定後も既存案件の単価は変わらない。
3. **個別案件**詳細では案件紐づき `price_sets` を期間追加・編集する。同一案件内で適用期間の重複は不可。
4. **基本案件削除**時はテンプレ用 `price_sets` のみ論理削除。既存個別案件の `price_sets` は残す。
5. **個別案件削除**時は当該 `project_id` の `price_sets` と行を論理削除する。

## 計算

- 日報保存時: `spot_amount` があればマスタ無視。それ以外は勤務日で案件の `price_sets` から 1 件を選択し行単価を適用（最小仮組）。`applied_price_set_id` に記録。
- `project_revisions` はレガシー参照用。金額の正は `project_id` 紐づき PriceSet。

## UI 導線

- 基本案件・個別案件詳細に「金額データ」セクション。横断の金額データ管理機能からも検索・深リンク可能。
- 画面項目・操作の詳細は **`個別機能仕様書：1-3. 案件マスタ管理画面.md`** を正とする。

## 画面仕様サマリ（本書との対応）

| 画面 | 金額の扱い | 主な操作 |
|------|------------|----------|
| 基本案件一覧 | — | 編集、**案件作成**（PriceSet ディープコピー）、削除（テンプレ PriceSet のみ） |
| 基本案件詳細 | **金額データセクション**（複数 PriceSet・期間） | 属性保存、金額追加／編集は金額データ管理へ |
| 個別案件一覧 | — | 編集、削除（案件 PriceSet 含む） |
| 個別案件新規 | 保存時にテンプレ PriceSet をコピー | テンプレ反映、属性入力 |
| 個別案件詳細 | **金額データセクション**（案件専用 PriceSet） | 属性保存、改定履歴は**参照のみ** |

**廃止（画面から除去）**: `projects` / `base_projects` の **`price_set_id` 単一選択**による金額紐付け。
