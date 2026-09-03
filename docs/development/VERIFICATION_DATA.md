# 匿名検証データ

`backend/scripts/seed_verification_data.js` は、ローカル開発環境とNASテスト環境の両方に投入できる匿名データです。実在の個人情報・口座情報は含みません。

投入前に、対象環境でアプリを一度起動し、DBマイグレーションを完了させます。ホスト側ではなく、DB接続設定を共有している `app` コンテナ内から実行します。

```powershell
docker compose exec -T app npm run seed:verification
docker compose exec -T app npm run verify:verification-data
```

ローカルDBまたはテストNASで匿名検証データを再投入する場合は、次を実行します。削除対象は同じ `seed_key` が付いた匿名検証データだけで、通常の企業、パートナー、案件、日報、請求・支払等は削除しません。

```powershell
docker compose exec -T -e NODE_ENV=development -e VERIFICATION_RESET_CONFIRM=DELETE_VERIFICATION_DATA app npm run reset-and-seed:verification
```

テストNASでは、通常更新で `main` を反映してアプリを再構築した後、先に `./scripts/nas-backup.sh` を実行してから同じコマンドを実行します。リセットで削除するのは `seed_key` が一致する匿名検証データだけです。本番モードと本番NASでは実行できません。

作成済みの `【検証】` 接頭辞データがある環境では、誤った重複投入を防ぐため処理を中止します。既存データの削除・上書きは行いません。初期化が必要な場合だけ、上記の `reset-and-seed:verification` を明示的に実行します。

## 帳票プレビュー

DBへ接続せず、匿名の固定データから請求書、請求取纏書、支払明細書・作業料金請求書、給与明細書、送付状の5種類を生成できます。

```powershell
docker compose exec -T -e PDF_DIR=/app/pdf/preview app npm run preview:settlement-pdfs
```

出力先は `data/pdf/preview/` です。各帳票は `BOOKイメージ.xlsx` の必須表示項目と表示順を参考にしたA4・1ページ構成です。実Excel、実在の宛先、口座情報、ロゴ、印影は使用しません。CIでは5種類のPDFと先頭ページのPNGを成果物として保存し、各PDFが1ページであることも検査します。

投入内容は企業20件、パートナー30名、基本案件30件、個別案件50件、案件別PriceSet、2026年1月〜8月の日報、前払、請求・支払および各明細です。金額データは `平日料金（企業名：案件名略）` を親名称とし、内部の料金項目に平日料金・休日料金・研修料金を持たせます。個別案件の40件は通常料金、10件は超過・不足・深夜・深夜超過・休日・研修・手動料金・単価変更・請求支払別条件・丸めを検証する特殊料金です。2案件は日報未入力、3案件は2026年8月未入力です。
