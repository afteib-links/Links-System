# 現行DBを別NASへ完全置換移行する手順

この手順は Links-System の **DBだけ**を別NASへ完全置換するためのものです。添付、発行済みPDF、`.env`、NASのネットワーク・Docker設定は対象外です。実データのSQLダンプとマニフェストはGit、Issue、PR、共有チャットへ置かず、移行作業者だけが読めるNAS共有フォルダで一時的に受け渡します。

## 実行前の条件

- 移行元・移行先とも、レビュー済み `main` の同一コミットであること。移行元のコミットはマニフェストに記録され、移行先で不一致なら復元を中断します。
- 移行時間中は移行元で入力、締め、帳票発行を行わないこと。`--single-transaction` はInnoDBの整合性を保ちますが、バックアップ後の書込みまでは追随しません。
- 移行先の既存DBを置換してよいこと。スクリプトは移行先アプリを先に停止し、その停止状態で移行先DBの復旧用ダンプを自動作成します。停止中はDBへ直接書き込まないでください。
- 移行元・移行先のNAS上で `docker compose`、`bash`、`curl`、`sha256sum`（または `shasum` / `openssl`）が使えること。

## 1. 移行元でエクスポートする

移行元NASで、利用者の操作を止めた後に実行します。作成された `.sql` と `.manifest` は、両方とも同じセットとして扱います。

```bash
cd /volume1/docker/Links-System
bash scripts/nas-db-export.sh backups
```

出力されるマニフェストには、Gitコミット、ダンプのSHA-256、サイズ、`schema_migrations` と主要テーブルの件数が含まれます。出力したダンプは移行元の `backups/` に14日間以上保持してください。

## 2. 限定共有フォルダへコピーする

移行元で作成されたSQLとマニフェストを、アクセスを移行担当者に限定したNAS共有フォルダへコピーします。ファイル名は変えないでください。

```text
links_links_system_YYYYMMDD_HHMMSS.sql
links_links_system_YYYYMMDD_HHMMSS.manifest
```

コピー後、移行元のマニフェスト記載値とコピー先SQLのSHA-256が一致することを確認します。

```bash
sha256sum /path/to/restricted-share/links_links_system_YYYYMMDD_HHMMSS.sql
```

## 2-A. SSHで直接転送する場合（共有フォルダの代替）

共有フォルダを使わない場合は、移行元NASから移行先NASの限定アクセス用アカウントへSSH/SCPで転送できます。SSHはダンプの暗号化された転送経路を提供しますが、移行先での復元前後のバックアップ保持、ハッシュ照合、14日保持の要件は変わりません。

実行前に次を満たしてください。

- SSH公開鍵認証を使い、移行元NASの `known_hosts` に移行先NASのホスト鍵指紋を**事前に確認して**登録する。初回接続時の未確認指紋を自動承認しない。
- 移行用アカウントには、移行先のLinks-Systemディレクトリと `backups/import/` への書込み、およびDocker Compose操作に必要な最小権限だけを付与する。管理者パスワードをコマンドや手順書に記載しない。
- 移行先のSSHポート、ホスト名、配置パスを実値に置き換える。以下の `migration@target-nas` と `/volume1/docker/Links-System` は例です。

移行元NASで、`nas-db-export.sh` の出力からSQLとマニフェストの実ファイル名を確認した後に実行します。

```bash
cd /volume1/docker/Links-System

# 接続先のホスト鍵を事前確認済みであること。未知の鍵は接続せず確認する。
ssh -o StrictHostKeyChecking=yes migration@target-nas \
  'mkdir -p /volume1/docker/Links-System/backups/import && chmod 700 /volume1/docker/Links-System/backups/import'

scp -p -o StrictHostKeyChecking=yes \
  backups/links_links_system_YYYYMMDD_HHMMSS.sql \
  backups/links_links_system_YYYYMMDD_HHMMSS.manifest \
  migration@target-nas:/volume1/docker/Links-System/backups/import/
```

転送後、移行元のマニフェストに記録されたSHA-256と移行先のSQLが一致することを確認します。マニフェストをSSH上で `source` せず、値だけを表示して照合します。

```bash
ssh -o StrictHostKeyChecking=yes migration@target-nas \
  'sha256sum /volume1/docker/Links-System/backups/import/links_links_system_YYYYMMDD_HHMMSS.sql'
```

移行先のコードを移行元と同じレビュー済み `main` コミットへ更新してから、SSHで完全置換を実行します。`nas-db-replace.sh` はコミット、ダンプ名、SHA-256が一致しない場合や、`--confirm-replace` がない場合に中断します。

```bash
ssh -t -o StrictHostKeyChecking=yes migration@target-nas \
  'cd /volume1/docker/Links-System && \
   git fetch origin && git checkout main && git pull --ff-only origin main && \
   bash scripts/nas-db-replace.sh \
     backups/import/links_links_system_YYYYMMDD_HHMMSS.sql \
     backups/import/links_links_system_YYYYMMDD_HHMMSS.manifest \
     --confirm-replace'
```

`ssh -t` は、NAS側のDocker操作にTTYが必要な構成だけで使用します。不要な環境では外してください。転送後の一時SQLとマニフェストは、移行・業務確認が完了してから移行先の `backups/import/` だけを削除します。移行元 `backups/` と移行先が自動作成した復旧用バックアップは削除せず、14日間保持します。

## 2-B. Windows localhost のDockerを移行元にする場合

Windows PC上のDocker Desktopで動いているDBも、同じエクスポートスクリプトで移行できます。PowerShellの `>` は環境によってSQLの文字コードを変える可能性があるため、`mysqldump` 出力をPowerShellでリダイレクトしません。Git Bashから `nas-db-export.sh` を実行し、ダンプファイルはDockerコンテナではなくWindows側の `backups/` に作成します。

### 1. ローカルアプリを一時停止してエクスポートする

Docker Desktopが起動済みであることを確認し、入力・締め・帳票発行が行われていない時間に、PowerShellでアプリコンテナだけを停止します。DBコンテナは停止しません。

```powershell
cd C:\Users\<Windowsユーザー>\Documents\Codex\Projects\LinksSystem
docker compose ps
docker compose stop app
```

同じフォルダでGit Bashを開き、次を実行します。

```bash
bash scripts/nas-db-export.sh backups
```

成功すると、Windows側の `backups/` に次の2ファイルが作成されます。ファイル名は変更しません。

```text
links_links_system_YYYYMMDD_HHMMSS.sql
links_links_system_YYYYMMDD_HHMMSS.manifest
```

エクスポートが完了したら、PowerShellへ戻ってローカルアプリを再開します。エクスポートに失敗した場合も必ず再開してください。

```powershell
docker compose start app
```

### 2. Windowsから移行先NASへSSH/SCPで送る

Windows標準のOpenSSH Client（`ssh` と `scp`）または同等のSSHクライアントを使います。事前に移行先NASのSSHホスト鍵指紋を確認し、公開鍵認証を設定してください。パスワードをコマンド、`.env`、履歴、Gitへ記録しません。

PowerShellで、出力された実ファイル名に置き換えて実行します。

```powershell
Get-FileHash .\backups\links_links_system_YYYYMMDD_HHMMSS.sql -Algorithm SHA256

ssh -o StrictHostKeyChecking=yes migration@target-nas `
  'mkdir -p /volume1/docker/Links-System/backups/import && chmod 700 /volume1/docker/Links-System/backups/import'

scp -p -o StrictHostKeyChecking=yes `
  .\backups\links_links_system_YYYYMMDD_HHMMSS.sql `
  .\backups\links_links_system_YYYYMMDD_HHMMSS.manifest `
  migration@target-nas:/volume1/docker/Links-System/backups/import/

ssh -o StrictHostKeyChecking=yes migration@target-nas `
  'sha256sum /volume1/docker/Links-System/backups/import/links_links_system_YYYYMMDD_HHMMSS.sql'
```

Windowsの `Get-FileHash` の値、マニフェストの `DUMP_SHA256`、移行先NASの `sha256sum` の値がすべて同じであることを確認してから、[移行先NASで完全置換する手順](#3-移行先nasで完全置換する)へ進みます。移行先の完全置換はNAS上で行い、WindowsのローカルDBを削除・変更する必要はありません。

## 3. 移行先NASで完全置換する

移行先NASを移行元と同じ `main` コミットへ更新し、ダンプ一式をローカルの `backups/import/` へコピーします。共有フォルダを直接復元元にせず、コピー後のSHA-256を確認してから使います。

```bash
cd /volume1/docker/Links-System
git fetch origin
git checkout main
git pull --ff-only origin main
git rev-parse HEAD

mkdir -p backups/import
# 限定共有フォルダから .sql と .manifest を同名のままコピーする
sha256sum backups/import/links_links_system_YYYYMMDD_HHMMSS.sql

bash scripts/nas-db-replace.sh \
  backups/import/links_links_system_YYYYMMDD_HHMMSS.sql \
  backups/import/links_links_system_YYYYMMDD_HHMMSS.manifest \
  --confirm-replace
```

この処理は、(1) 移行先アプリ停止、(2) 停止状態の移行先DBから復旧用ダンプと件数マニフェストを作成、(3) `links_system` を削除・再作成、(4) 復元、(5) セッション削除、(6) アプリ起動、(7) `/api/health` と件数照合、の順で実行します。復旧用ダンプの作成または置換が途中で失敗した場合は、終了処理が移行先アプリの再起動を試みます。単なる上書きインポートではないため、移行先にだけあったレコードは残りません。全利用者は再ログインが必要です。

## 4. 業務確認

`nas-db-verify.sh` が成功した後、代表データで次を確認します。

- `schema_migrations`、企業、パートナー、基本案件、案件、金額、日報、請求、支払、先払いの件数
- 日報から料金設定が解決されること
- 請求明細、支払明細、前払・控除が表示されること
- 管理者・一般利用者のログインと `/api/health`

## 復旧手順

完全置換に失敗した場合、スクリプトが表示した「復旧用マニフェスト」に対応する移行先の直前バックアップを使います。アプリを停止し、同じ `nas-db-replace.sh` に **復旧用SQLと復旧用マニフェスト** を指定して実行してください。復旧先のGitコミットも、当該マニフェストのコミットと一致させます。

移行確認後、限定共有フォルダと移行先の `backups/import/` に置いた一時コピーだけを削除します。移行元のバックアップと移行先の復旧用バックアップは14日間保持してください。

## 留意事項

- スクリプトはDBダンプをリポジトリへ追加しません。`backups/` はGit管理対象外です。
- 添付・原本・PDFの移行は別作業です。必要になった場合は、DBに保存された参照先との整合性を確認する専用計画を作成してください。
- DB名・DBユーザー名が通常の英数字・アンダースコア以外の場合は、安全のため完全置換スクリプトが中断します。`.env` を確認し、必要ならスクリプトをレビューして対応します。
