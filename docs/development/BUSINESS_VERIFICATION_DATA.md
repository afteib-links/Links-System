# 業務検証データの生成・確認・NAS移送

Issue #93。既存の `links_system`、`data/`、`.env`、NASのDBを置換しない。
基準日は2026-09-07、対象は2025-11-01から基準日まで。すべて架空データであり、銀行送信は禁止。

## 構成

- `backend/scripts/business_verification/scenarios.js`: 名称、件数、勤務、料金改定、例外。
- `masters.js`: マスター・案件登録。`workflows.js`: 既存計算サービスと承認・精算・CSV APIを利用した業務処理。
- `runtime.js`: 検証DB限定ガード、マイグレーション・列型・状態値の互換性検査、模擬日時。
- `main.js`: プレビュー・生成・検証。`package.js`: DB行・PDF・CSV・マニフェストの移送。
- `serve.js`: 既存環境と別ポートの確認アプリ。ローカルループバックだけで待受ける。

企業100件、パートナー130名（契約終了10名・先払対象30名）、基本案件100件、個別案件120件、担当者15名。
基本料金セット100＋個別120＋改定20＝240セット。各セット内に曜日別・研修・距離の料金項目を持つ。
シード既定値93。業務データの再現性は、生成時刻・内部採番の競合順・PDF内部メタデータではなく、案件・日付・勤務・計算額・精算状態のハッシュで確認する。

## 名称サンプルと確認対象

`node backend/scripts/business_verification/main.js preview` はDBへ接続せず、名称・料金・勤務サンプルを表示する。

- 企業: C00001 東都食品株式会社、C00026 東都建材株式会社、C00046 東都環境分析株式会社。
- 人物: P00001 山田 拓也、P00002 佐藤 美咲、P00011 加藤 智也など。姓・名とも分散。
- 案件: 食品配送、ステンレス製品配送、樹木調査助手、道路点検、PCB調査、倉庫作業、PCサポート等。地域・勤務帯を併記。
- 料金: 平日料金（企業名：案件名略）、土曜料金、休日料金、研修平日料金、研修土曜料金、研修日曜料金、距離超過料金。
- 通常は早朝配送5時開始、建材配送8時開始、事務9時開始。残業・20～29時の深夜勤務・早退・研修・非稼働を混在。
- J00001～J00010 → J00101～J00110: パートナー交代。旧実績を保持。
- J00011～J00020 → J00111～J00120: 勤務条件変更。料金だけの改定はJ00031～J00050。
- 11/30と12/1を年度境界として確認。専用年度機能は作らない。

過去完了月の例外は6案件月に限定する。

1. J00071・2025-11: 未申請、11/30未入力。
2. J00072・2026-01: 勤務時間確認の差戻し。
3. J00073・2026-03: 申請済み・承認待ち。
4. J00074・2026-05: 支払確定後の振込保留。
5. J00075・2026-06: 請求下書き。
6. J00076・2026-07: 支払下書き。

8月は承認・精算処理中が混在し、J00061～J00065は8/31未入力・申請遅延。
9月は月次承認せず、J00091～J00093の9/7を未入力にする。将来の振込予定は実行しない。
先払はJ00021～J00050。J00049の8月中回を対象OFF、J00050の8月初旬を稼働0、J00048の6月中回を理由付き増額、J00047の8月中回を取消・再作成とする。
請求・支払に手入力調整を各6件、2026年3月20日回に手動入出金予定6件を含める。

## 現行機能による制約

- 合意済み計画どおり「提出」は月次承認申請を生成する。新設の日報提出一覧の受領記録・原本・取込ファイルは作らない。
- 契約終了は備考・シナリオ情報で表す。人物マスターを論理削除しないため過去実績が参照できる。
- 企業・人物・基本案件・個別案件には専用の英字表示番号列がない。名称先頭または業務内容と `extra_data.scenario_no` で識別する。内部IDは変えない。料金No・事業所No・請求取纏番号は既存の表示用列へ設定する。
- 日報の「欠勤」と「不要」は現行画面では同じ非稼働フラグ。行コメントとシナリオに理由を保持する。専用欠勤機能の検証完了とは扱わない。
- 通行料・駐車料・交通費を入力するが、現行計算には契約別の経費自動精算がない。入力検証のみで、自動連携の合格とはしない。
- 「分割30名」は先払対象30名。物品立替の分割返済債権とは別。
- 正式銀行CSV仕様は未承認のまま。公開するのは「検証専用・銀行送信不可」の3プロファイルだけ。

## Windows（既存localhost MariaDBへ別スキーマを作る）

Node.jsと `backend/node_modules`、ローカルDBへの接続、Chromiumと日本語フォントが必要。
リポジトリ直下で実行する。既存 `.env` は変更しない。接続パスワードは環境変数または既存ローカル設定から読み、コマンド引数へ書かない。

```powershell
$env:DB_HOST='127.0.0.1'
$env:DB_NAME='links_verification_demo01'
$env:VERIFICATION_ENV='isolated'
$env:VERIFICATION_AS_OF='2026-09-07'
$env:VERIFICATION_SEED='93'
$env:PDF_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
node backend/scripts/business_verification/main.js preview
node backend/scripts/business_verification/provision.js
if ($LASTEXITCODE -ne 0) { throw 'Provision failed' }
node backend/scripts/business_verification/main.js generate
if ($LASTEXITCODE -ne 0) { throw 'Generation failed; inspect the error before resuming' }
node backend/scripts/business_verification/main.js verify
node backend/scripts/business_verification/serve.js
```

`provision.js` だけはroot接続用の `MYSQL_ROOT_PASSWORD` が必要。既存スキーマ名なら停止する。
確認画面は `http://127.0.0.1:18080`。検証ログインは `verification-admin`、ホスト生成時の既定パスワードは `Verification93!`（専用・ローカル限定）。`VERIFICATION_PASSWORD` を生成前に指定して変更できる。
生成中は同じ検証DBの画面操作・別ジェネレーターを起動しない。

出力はGit対象外の `output/business-verification/<DB_NAME>/`。`generation.json` が `complete` かつ `result.json` が `passed` のときだけ完成版とする。
途中失敗時は原因を確認し、同じDB・シード・基準日で `generate --resume` を使用する。完了済みDBへ再実行しない。設定・計算条件を変更した場合は新しいDB名で再生成する。

## Windows Docker・NAS共通の独立Compose

`compose.verification.yml` は単独で指定し、通常の `docker-compose.yml` と合成しない。
専用の4つの環境変数 `VERIFICATION_DB_PASSWORD`、`VERIFICATION_ROOT_PASSWORD`、`VERIFICATION_SESSION_SECRET`、`VERIFICATION_PASSWORD` を安全に設定する（実運用の値を流用しない）。

```sh
docker compose -p links-verification -f compose.verification.yml build app
docker compose -p links-verification -f compose.verification.yml up -d db
docker compose -p links-verification -f compose.verification.yml run --rm --no-deps app node src/migrate.js
docker compose -p links-verification -f compose.verification.yml run --rm --no-deps app node scripts/business_verification/main.js preview
docker compose -p links-verification -f compose.verification.yml run --rm --no-deps app node scripts/business_verification/main.js generate
docker compose -p links-verification -f compose.verification.yml run --rm --no-deps app node scripts/business_verification/main.js verify
docker compose -p links-verification -f compose.verification.yml up -d app
```

各コマンドが成功してから次へ進む。最初のdb起動後はhealthがhealthyになるまで待つ。既定ポート18080はループバック限定。
NASへはSSHトンネルで閲覧できる。

```powershell
ssh -N -L 18080:127.0.0.1:18080 USER@NAS
```

ローカル18080が使用中なら左側を18081等へ変更する。NASの通常アプリ・DBは停止しない。

## 生成済みデータを別の空DBへ移す

生成完了後に確認用アプリを停止し、生成・更新のない状態でエクスポートする。

```powershell
node backend/scripts/business_verification/package.js export output/business-verification/packages/demo01
```

ディレクトリは新規のみ。行データはテーブル別JSON Lines＋gzip、帳票・CSVは実ファイルのまま保存する。
`manifest.json` に全ファイルのSHA-256・件数・マイグレーションを記録し、マニフェスト自身のSHA-256は標準出力へ出す。控えて移送先で照合する。
これは実DB用mysqldumpの代替ではなく、この架空データだけを対象とした検証用パッケージ。
セッションは移送しない。秘密設定、原本、既存PDFは含めない。

限定アクセス共有フォルダへコピーするか、SSHで送る。

```powershell
scp -r output/business-verification/packages/demo01 USER@NAS:/PRIVATE_SHARE/Links-System/output/business-verification/packages/
```

NASには同じレビュー済みコードを配置し、独立ComposeのDB起動・migrationまで実施する。**generateは実行しない**。
復元時はまだ `output/business-verification/docker` が生成物を持たないことが必要。Composeの空マウントディレクトリは復元先として許可される。

```sh
docker compose -p links-verification -f compose.verification.yml run --rm --no-deps app node scripts/business_verification/package.js restore /app/packages/demo01
docker compose -p links-verification -f compose.verification.yml up -d app
```

Windows上の別スキーマなら `DB_NAME` を新しい `links_verification_*` に変更し、provision後に同じrestoreコマンドをホストから実行する。
チェックサム、列構成、基準日、対象DBの空状態を確認してから登録する。業務データのあるDBは変更しない。
DB行登録はトランザクション、ファイルコピーは別工程。失敗したパッケージ投入先をそのまま利用せず、新しい検証DB・保存先へ復元し直す。
復旧は前の検証DBを残したまま接続先を戻す。既存ローカル・NASを置換する場合は別途承認し、[NAS_DB_REPLACEMENT.md](NAS_DB_REPLACEMENT.md) のバックアップ・復旧手順に従う。
移送確認後は共有上の一時コピーを削除し、復旧用パッケージは14日間保持する。削除は本ツールでは自動実行しない。

## DB変更時と検証範囲

マイグレーション追加、既存SQL変更、列・型・状態値変更は書込み前に停止する。差分を分析し、シナリオ・登録・計算・検証を更新してから `migration-contract.json` と `schema-contract.json` を更新する。互換性の検討なしにハッシュだけ更新しない。
マイグレーションSHAは改行をLFへ正規化するためWindows/NASで比較できる。
単体検証は `node --test backend/test/*.test.js`。DB検証では件数・期間・月次状態・重複・前払控除・月間距離・精算合計・CSV再構成・PDF参照を照合する。
経費の契約別自動精算、専用欠勤区分、原本受領、正式銀行への取込は対象外であり、合格済みと解釈しない。
