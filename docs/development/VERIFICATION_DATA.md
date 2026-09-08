# 匿名検証データ

`backend/scripts/seed_verification_data.js` は、ローカル開発環境とNASテスト環境の両方に投入できる匿名データです。実在の個人情報・口座情報は含みません。

投入前に、対象環境でアプリを一度起動し、DBマイグレーションを完了させます。ホスト側ではなく、DB接続設定を共有している `app` コンテナ内から実行します。

```powershell
docker compose exec -T app npm run seed:verification
docker compose exec -T app npm run verify:verification-data
```

ローカルDBまたはテストNASで匿名検証データを再投入する場合は、次を実行します。削除対象は同じ `seed_key`（およびレガシー検証キー）が付いた匿名検証データだけで、通常の企業、パートナー、案件、日報、請求・支払等は削除しません。

```powershell
docker compose exec -T -e NODE_ENV=development -e VERIFICATION_RESET_CONFIRM=DELETE_VERIFICATION_DATA app npm run reset-and-seed:verification
```

テストNASでは、通常更新で `main` を反映してアプリを再構築した後、先に `./scripts/nas-backup.sh` を実行してから同じコマンドを実行します。リセットで削除するのは検証用 `seed_key` が一致する匿名検証データだけです。本番モードと本番NASでは実行できません。

作成済みの `@_` 接頭辞データがある環境では、誤った重複投入を防ぐため処理を中止します。既存データの削除・上書きは行いません。初期化が必要な場合だけ、上記の `reset-and-seed:verification` を明示的に実行します。

## 識別規則

| 項目 | 値 |
|------|-----|
| 表示接頭辞 | 名称先頭の `@_`（例: `@_東都ロジスティクス株式会社`） |
| `seed_key` | `verification-data-2025-11-2026-09` |
| 旧データ | `【検証】` / `verification-data-2026-v2` は reset 時に削除対象 |

## 規模と期間

| 区分 | 内容 |
|------|------|
| 企業 | 100件（締日6種循環、企業内請求先No・請求取纏番号・表示モード混在） |
| パートナー | 150件（口座完备／不備、先払可否、控除上書き） |
| 基本案件 | 130件 |
| 個別案件 | 150件（企業ごとの請求先を設定、通常／分割、途中開始・終了、未割当、合算用など） |
| 金額（PriceSet） | 約200件（基本テンプレ50 + 個別150 + 途中改定分） |
| 期間 | 2025-11〜2026-09 |
| 運用イメージ月 | 2025-11〜2026-08（連続稼働・改定・合算・先払） |
| 検証マトリクス月 | **2026-09**（T-* パターンを明示配置） |

請求・支払の検証データには、作成時点の対象案件を `settlement_projects` に保存します。`verify:verification-data` の結果では、請求先設定済み案件数、請求先No設定数、精算対象案件リンク数も確認できます。

Issue #100以前に投入済みの現行キーの匿名検証データへ請求先Noと精算対象案件の関連だけを補完する場合は、削除を伴わない次のコマンドを使用します。

```powershell
docker compose exec -T app npm run repair:verification-issue100
```

検証キー外の案件が現行キーの検証用マスターを参照して限定リセットを妨げる場合は、対象案件を残したまま企業・パートナー・基本案件・請求先を通常データとして複製し、参照を切り離せます。本番では実行できず、確認用環境変数が必須です。

```powershell
docker compose exec -T -e NODE_ENV=development -e VERIFICATION_DETACH_CONFIRM=DETACH_EXTERNAL_PROJECTS app npm run detach:verification-dependencies
```

## 帳票プレビュー

DBへ接続せず、匿名の固定データから請求書、請求取纏書、支払明細書・作業料金請求書、給与明細書、送付状の5種類を生成できます。

```powershell
docker compose exec -T -e PDF_DIR=/app/pdf/preview app npm run preview:settlement-pdfs
```

出力先は `data/pdf/preview/` です。各帳票は `BOOKイメージ.xlsx` の必須表示項目と表示順を参考にしたA4・1ページ構成です。実Excel、実在の宛先、口座情報、ロゴ、印影は使用しません。

## 主な検証観点（2026-09）

- マスター: 締日・取纏番号・税率・口座不備・先払手数料・控除・車両・休日
- 契約: 基本→個別、分割支払、稼働0、途中開始／終了、未割当
- 金額: 途中改定、個別支払差、請求≠支払条件、距離（日次／月次／段階）、深夜モード
- 日報: 超過・不足・深夜・休日・研修・手動料金・一時単価・欠勤／不要・同日複数行・提出一覧
- 請求: 単一／複数合算、詳細／取纏、下書き予約、税・調整行
- 支払・先払: 3サイクル、手修正、取消、正式控除、振込0繰越、給与明細
- 入出金: 管理回、入出金予定、実行／出力済、口座不備行

## 2026-09 マトリクス一覧（個別案件 index 110〜149）

`projects.extra_data.scenario` に以下を格納。画面では企業・パートナー名の `@_` で絞り込む。

| index | scenario | 確認内容 |
|------:|----------|----------|
| 110 | `matrix-overtime` | 超過 |
| 111 | `matrix-shortage` | 不足 |
| 112 | `matrix-night` | 深夜 |
| 113 | `matrix-night-ot` | 深夜超過 |
| 114 | `matrix-holiday` | 休日料金（9/21–23） |
| 115 | `matrix-training` | 研修 |
| 116 | `matrix-manual` | 料金手動選択 |
| 117 | `matrix-override` | 一時単価変更 |
| 118 | `matrix-distance-daily` | 距離・日次超過 |
| 119 | `matrix-distance-monthly` | 距離・月次超過 |
| 120 | `matrix-distance-tiered` | 距離・段階 |
| 121 | `matrix-night-split` | 請求≠支払の深夜帯 |
| 122 | `matrix-rounding` | 丸め差 |
| 123 | `matrix-absent` | 欠勤 |
| 124 | `matrix-unnecessary` | 不要（非稼働） |
| 125 | `matrix-multi-row` | 同日複数行 |
| 126 | `matrix-expense` | 経費混在 |
| 127 | `matrix-status-mix` | draft/confirmed/approved 混在 |
| 128 | `matrix-reject` | 差戻し |
| 129 | `matrix-monthly` | 月極料金 |
| 130 | `matrix-installment` | 先払3サイクル・手修正・取消 |
| 131 | `matrix-installment-zero` | 稼働0先払 |
| 132 | `matrix-unassigned` | パートナー未割当 |
| 133 | `matrix-late-start` | 途中開始（2026-06〜） |
| 134 | `matrix-ended` | 途中終了（〜2026-06） |
| 135 | `matrix-payment-bias-a` | 支払単価A |
| 136 | `matrix-payment-bias-b` | 支払単価B（請求同・支払差） |
| 137 | `matrix-consolidate-a` | 合算請求（同一企業） |
| 138 | `matrix-consolidate-b` | 合算請求 |
| 139 | `matrix-consolidate-c` | 合算請求 |
| 140 | `matrix-draft-invoice` | 請求下書き予約 |
| 141 | `matrix-carry` | 振込0・繰越 |
| 142 | `matrix-night-include` | 深夜 include_in_base |
| 143 | `matrix-night-excluded` | 深夜 excluded |
| 144 | `matrix-submission` | 提出済／未提出／遅延 |
| 145 | `matrix-account-ok` | 口座完备対照 |
| 146 | `matrix-revision-cross` | 4/1改定＋跨ぎ稼働 |
| 147 | `matrix-sep-revision` | 9/1改定 |
| 148 | `matrix-no-report` | 日報なし |
| 149 | `matrix-standard` | 通常平日（基準） |

## PDF生成メモ

- 既定では帳票PDFはスタブ（Chromium未導入環境向け）
- 実PDFが必要な場合: `VERIFICATION_SEED_FORCE_PDF=1` または `PDF_CHROMIUM_EXECUTABLE_PATH` を指定
