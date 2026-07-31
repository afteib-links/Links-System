# Links-System（運送業務基幹システム）仕様

Excel管理の運送業務（案件・パートナー・収支）をWeb化するシステムの仕様書置き場です。

## ドキュメント一覧

| ファイル | 内容 |
|----------|------|
| `01_policy_and_rules.md` | 全体方針・業務/計算ルール |
| `02_master_definition.md` | マスタ（DB）定義 |
| `03_function_scope.md` | MVP機能スコープ |
| `04_calculation_logic.md` | 日報計算・金額保持仕様 |
| `05_decision_log.md` | 決定事項ログ |
| `06_development_environment.md` | **開発環境・NAS実行基盤仕様** |
| `個別機能仕様書：*.md` | 各画面の詳細仕様 |

## 重要なお知らせ

個別機能仕様書には「HTML5 SPA + IndexedDB」とあります。  
実運用は **4名同時利用・QNAP TS-464（QTS）稼働** のため、データ保存は共有DB（MariaDB）へ変更します。  
詳細は `06_development_environment.md` を参照してください。
