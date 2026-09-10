# 検証データ作成ツール：初回納品

## 実装済みと未実装

実装済み: 管理者向け取込、名称の維持/仮想化、コード列割当、件数・期間・勤務割合、サンプル、採否・コメント保存、版承認、匿名JSON/CSV。

未実装: 料金・契約期間列の取込、コードの関連付き仮想化、任意勤務帯、契約/料金改定、月次承認/精算/先払/分析、生成ワーカー、PDF/銀行CSV、生成DB移送・復元。
初回の日報は登録前の設計サンプルであり、金額欄は未計算。サンプル承認後も生成APIは501で停止する。
担当者カタログは作成するが、企業への営業配属・分析は後続。過去の固定生成スクリプトは呼び出さない。

## 独立環境の起動（Windows / NAS 共通）

通常の `docker-compose.yml` と重ねない。新規の専用Compose・専用DB・専用ボリュームを使用する。
Git管理外の `tmp/test-tool.env` に以下の変数を設定する（値は各環境で生成した別々の秘密値）。

- TEST_TOOL_ROOT_PASSWORD
- TEST_TOOL_DB_PASSWORD
- TEST_TOOL_SESSION_SECRET
- TEST_TOOL_ADMIN_PASSWORD

Windowsでは、リポジトリ直下から専用ラッパーを実行する。内部で共通の `docker-update.ps1` を呼び、専用Composeだけを選択して起動・health確認する。

```powershell
pwsh -NoProfile -File scripts/test-data-update.ps1
```

DockerコマンドがPATHにない場合はDocker Desktopの `resources/bin` をプロセスのPATHへ追加して実行する。ラッパーは既存8080番と混同しないよう localhost:8088 に固定する。
NAS SSHでは同じ共通更新ツールへ専用Composeと環境ファイルを指定する（NASへ導入する場合だけ実行）。

```sh
COMPOSE_FILE=docker-compose.test-data.yml COMPOSE_ENV_FILES=tmp/test-tool.env COMPOSE_PROJECT_NAME=links-test-data-tool bash scripts/docker-update.sh --health-url http://127.0.0.1:8088/api/health
```

`http://localhost:8088/api/health` が `db: "up"` であることを確認し、`test-admin` でログインする。
設定メニューの「検証データ作成」を開く。NASも既定はlocalhostのみで公開する。
NASへは `ssh -L 8088:127.0.0.1:8088 NASユーザー@NASホスト` でトンネル接続し、PCのlocalhost:8088から利用できる。
NASへ外部公開する設定や既存DBの接続情報を流用しない。通常業務のユーザー・データはこの環境へ持ち込まない。

停止は同じCompose指定で `stop`。復旧は最後に確認したコードへ戻して同じ専用環境を起動する。
通常のDB・`data/mysql`・既存ボリュームを削除しない。専用DB内の設定を保持するため `down -v` は使用しない。
生成DBの移送/復元は後続実装のため、初回は匿名共有JSON/CSVのみを移送する。

## 操作

1. xlsx/csvを選び、文字コード・シート・列割当を確認する。ファイルなしなら仮想データを使う。
2. コードは文字列として用意する。Excelの表示書式だけで付けたゼロは復元できないため、文字列の値にして渡す。
3. 初回取込項目は code/name/companyCode/partnerCode/baseCode。名称以外の仮想化は明示的に拒否する。
4. 件数は取込を優先する。初回は1名1案件のみ。複数配属・契約期間などは未対応として止める。
5. プリセット・必須ケース・割合を設定し、サンプル表示する。仮想補完内容を確認してチェックを付け、再表示する。
6. 要調整がなく必須ケースを満たす版だけ承認する。変更後は保存・再表示・再承認が必要。
7. 匿名共有内容を確認し、JSONまたはCSVを保存する。自由コメント・維持値は含まれない。匿名版は再サンプリングされ、元の勤務配置そのものではない。

原本はメモリ解析のみ。維持を選んだ値は設定JSONとして専用DBに保存される。
各ファイル2MB、合計10MB、xlsx展開後20MB、10シート、各種類500件・40列、最大50,000案件日。
数式セル・マクロ・外部参照は禁止。値だけのxlsx/csvを使用する。

## テスト

backendで `npm ci` 後、以下を実行する。

```sh
node --test test/test_data_tool.test.js test/test_data_api.test.js
node test-e2e/test_data_ui.js
```

ブラウザはPlaywrightのChromiumを使用する。インストール済みChromeを使用する場合は `BROWSER_CHANNEL=chrome` を環境変数に設定する。
APIテストは管理テーブルのテストダブルを使用し、既存DBには接続しない。
実DB受入テストは専用コンテナ内で `node test-e2e/test_data_live_ui.js` を実行する。専用DB名・環境フラグを検証し、実際のログインから設定保存・承認・匿名出力まで確認する。管理テーブルに確認用の設定を1件保存するが、業務テーブルの件数不変を検査する。

## 初回の検証結果

- 2026-09-10、基点main `d6078f3`、Issue #117。
- 全ユニット/API/静的テスト185件成功（新規12件を含む）。
- Chromeによるブラウザ操作: サンプル表示、補完確認、承認、匿名出力画面、未保存変更の承認拒否を確認。
- Windows版Docker Desktopの実行ファイルを特定し、専用Composeで起動成功。共通更新ツールにより localhost:8088/api/health の db=up を確認。
- 実MariaDBでmigrationを適用し、ログイン・メニューアイコン・ヘッダー戻る・サンプル保存・承認・匿名共有・生成停止をブラウザ確認。業務テーブル件数は不変。
- 認証情報はGit除外の tmp/test-tool.env にランダム生成し、本人/SYSTEMだけのACLで保護。tmpとenvファイルはDockerビルドコンテキストからも除外。
- 既存8080番のアプリ・DBは変更しない。NAS実機は未検証。
- 本格データ生成・金額整合性・PDF/銀行CSV・再投入は未実装のため、完了条件を満たしたとは扱わない。
