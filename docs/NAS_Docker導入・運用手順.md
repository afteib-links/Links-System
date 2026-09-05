# Links-System NAS Docker 導入・運用手順

## 1. 目的と対象

Links-SystemをNAS上のDocker Composeで稼働させる初回導入、更新、バックアップ、復旧の手順です。

| 環境 | NAS | 用途 |
|---|---|---|
| 本番 | QNAP TS-464 / QTS | 社内運用 |
| テスト | ASUSTOR AS3202T / ADM 4.3系 | 実機試験 |

利用者は社内LANから http://<NASのIP>:8080 にアクセスします。インターネットへ直接公開しない前提です。

## 2. 動作構成

~~~text
社内LANのブラウザ
        │ http://<NAS_IP>:8080
        ▼
NAS
  └─ app コンテナ（Node.js 20 / Express / SPA / API / PDF）
        │ TCP 3306
        ▼
     db コンテナ（MariaDB 10.11）
        │
        └─ ./data/mysql に永続保存
~~~

主な永続化対象は data/mysql、data/uploads、data/pdf です。起動時に未適用のDBマイグレーションが自動適用されます。

## 3. 導入前チェック

- NASの管理画面へ管理者でログインできる
- NASと作業PCが同じ社内LANに接続されている
- NASの固定IP、またはDHCP予約を用意している
- Dockerイメージ・DB・バックアップ分の空き容量がある
- 社内LANから8080/TCPへ到達できる
- 3306/TCPとSSHを社外へ公開しない
- GitHubリポジトリをNASから取得できる
- 反映対象が main にマージ済みである
- 本番用とテスト用のパスワードを分ける

導入前に、次のファイルが存在し、対象コミットに含まれることを確認します。

~~~text
docker-compose.yml
Dockerfile
.env.example
scripts/nas-sync.sh
scripts/nas-backup.sh
~~~

## 4. QNAP TS-464への導入

### 4.1 Container Station

1. QTSへ管理者でログインする。
2. App Centerを開く。
3. Container Stationを検索し、インストールまたは更新する。
4. Container Stationを起動し、Dockerコンテナを管理できることを確認する。

QTS 5.1以降のContainer Station 3ではCompose V2が使われるため、コマンドは docker-compose ではなく docker compose を使用します。

### 4.2 共有フォルダとSSH

共有フォルダを作成します。例:

~~~text
/share/Container/Links-System
~~~

実際のパスはQTSの設定に合わせて確認してください。

SSHは、コントロールパネル → ネットワークとファイルサービス → Telnet/SSH から有効化します。社内LANまたは管理用端末だけに制限します。

~~~bash
ssh <NAS管理ユーザー>@<QNAPのIP>
~~~

### 4.3 ソース配置

~~~bash
cd /share/Container
git clone https://github.com/afteib-links/Links-System.git
cd Links-System
git checkout main
~~~

すでに配置済みの場合は「7. 通常更新」を使用します。

### 4.4 本番用環境変数

~~~bash
cd /share/Container/Links-System
cp .env.example .env
vi .env
~~~

最低限、次を本番用の長いランダム値へ変更します。

~~~dotenv
MYSQL_ROOT_PASSWORD=<本番用の値>
MYSQL_PASSWORD=<本番用の値>
DB_PASSWORD=<MYSQL_PASSWORDと同じ値>
SESSION_SECRET=<本番用の値>
ADMIN_PASSWORD=<初期管理者の一時パスワード>
TZ=Asia/Tokyo
~~~

.envはGitへコミットせず、管理者だけが読めるようにします。既存DBがある状態でDBパスワードだけを変更すると接続不整合になるため、変更前に別手順を確認します。

### 4.5 初回起動

~~~bash
cd /share/Container/Links-System
docker compose up --build -d
docker compose ps
docker compose logs app --tail 100
~~~

次が成功の目安です。

- dbがrunningまたはhealthy
- [migrate] done: または [migrate] skip: が表示される
- [boot] Links-System listening on :3000 が表示される

## 5. ASUSTOR AS3202Tへの導入

### 5.1 Docker

1. ADMへ管理者でログインする。
2. App Centralを開く。
3. Dockerを検索する。
4. ASUSTOR提供のDockerパッケージをインストールする。
5. 必要に応じてNASを再起動する。

AS3202Tはメモリ2GBのためテスト専用です。導入前に不要な重いアプリやコンテナを停止します。

### 5.2 共有フォルダとSSH

ログイン
ssh afteib@192.168.1.220 -p 7226

共有フォルダを作成し、例として次の作業ディレクトリを使用します。

~~~text
/volume1/docker/Links-System
~~~

サービス → ターミナルからSSHを有効にし、PCから接続します。

~~~bash
ssh <NAS管理ユーザー>@<ASUSTORのIP>
~~~

### 5.3 ソース配置と初回起動

~~~bash
cd /volume1/docker
git clone https://github.com/afteib-links/Links-System.git
cd Links-System
git checkout main
cp .env.example .env
vi .env
docker compose up --build -d
docker compose ps
docker compose logs app --tail 100
~~~

テスト用の.envは本番と異なるパスワードを使用します。

## 6. 初回起動後の確認

NAS内で確認します。

~~~bash
docker compose ps
curl -f http://127.0.0.1:8080/api/health
~~~

環境によっては次も確認します。

~~~bash
curl -f http://127.0.0.1:3000/api/health
~~~

PCのブラウザで次を確認します。

1. http://<NASのIP>:8080 を開く。
2. 初期管理者でログインする。
3. ログアウトして再ログインする。
4. /api/health のヘルスチェックが成功する。
5. 主要画面を表示する。
6. 初期管理者パスワードを変更する。

ファイアウォールでは、社内LANから8080/TCPだけを許可し、3306/TCPとSSHは管理範囲を限定します。ルーターのポート転送は設定しません。

## 7. 通常更新

更新対象はmainにマージ済みのコミットだけにします。

ssh afteib@192.168.1.220 -p 7226
~~~bash
cd <Links-Systemのパス>
./scripts/nas-sync.sh --backup
~~~

このスクリプトは、DBバックアップ、origin取得、main更新、Compose再ビルド・再起動、ログ表示、ヘルスチェックを実行します。

手動の場合:

~~~bash
cd <Links-Systemのパス>
git fetch origin
git checkout main
git pull origin main
docker compose up --build -d
docker compose ps
docker compose logs app --tail 100
curl -f http://127.0.0.1:8080/api/health
~~~

## 8. DBマイグレーション

db/migrations/ に新しいSQLが追加された場合も通常更新と同じです。

- 起動時にschema_migrationsを確認する
- 適用済みSQLはskipになる
- 未適用SQLだけが番号順にapplyされる
- 適用済みSQLを書き換えず、新しい番号のSQLを追加する

migrate failed が出た場合は、繰り返し再起動せず、SQLエラーと直前のバックアップを確認します。

## 9. バックアップ

更新前に実行します。

~~~bash
cd <Links-Systemのパス>
./scripts/nas-backup.sh
~~~

バックアップはbackups/に作成され、Git対象外です。同じNAS上だけでなく、別NAS、外付けドライブ、会社のバックアップ基盤などにも複製します。バックアップには個人情報・金額情報が含まれる可能性があるため、アクセス権を限定します。

## 10. リストア

リストアはデータを上書きします。実行前に現在の状態も別名でバックアップします。

~~~bash
cd <Links-Systemのパス>
RESTORE_FILE=backups/<戻したいSQLファイル>

docker compose exec -T db \
  mysql -u<DBユーザー> -p<DBパスワード> <DB名> \
  < "$RESTORE_FILE"

docker compose restart app
docker compose logs app --tail 50
curl -f http://127.0.0.1:8080/api/health
~~~

シェル履歴にパスワードが残らないよう、実運用では既存スクリプトや対話入力を使用します。復旧後はログイン、主要画面、件数、最新データを確認します。

## 11. 初期化（最終手段）

次の操作はDBの業務データを削除します。テストを空の状態からやり直す場合だけ使用します。

~~~bash
cd <Links-Systemのパス>
./scripts/nas-backup.sh
docker compose down
rm -rf data/mysql
docker compose up --build -d
~~~

本番では、ユーザーの承認とバックアップ確認なしに実行しません。通常更新でdata/mysqlを削除したり、docker compose down -vを実行したりしないでください。

## 12. トラブルシュート

| 症状 | 確認 |
|---|---|
| 画面が開かない | NASのIP、8080/TCP、docker compose ps、ファイアウォール |
| appが停止する | docker compose logs app --tail 200 |
| DB接続エラー | docker compose ps、docker compose logs db、.envのDB値 |
| DBが起動しない | data/mysqlの権限、空き容量、メモリ。データ削除はしない |
| マイグレーション失敗 | SQLエラー、適用順、バックアップ |
| 画面が古い | スーパーリロード、git log -1、再ビルド |
| ログインできない | .envの初期管理者、Cookie、時刻設定 |
| ASUSTORのビルドが重い | 他コンテナ、空き容量、メモリ |
| Git更新失敗 | git status、GitHub認証、リモートURL |

## 13. 運用チェックリスト

### 初回導入前

- [ ] NASのIPを確定した
- [ ] Container StationまたはDockerを導入した
- [ ] 共有フォルダと空き容量を確認した
- [ ] SSHを管理範囲限定で有効化した
- [ ] 本番・テストで別の秘密情報を用意した
- [ ] 対象コミットがmainにマージ済みである

### 更新前

- [ ] 利用者へメンテナンス時間を連絡した
- [ ] ./scripts/nas-backup.shを実行した
- [ ] バックアップファイルの作成とサイズを確認した
- [ ] git statusに意図しない変更がない

### 更新後

- [ ] docker compose psが正常
- [ ] アプリログに起動成功がある
- [ ] マイグレーションのapply/doneまたはskipを確認した
- [ ] /api/healthが成功した
- [ ] ログインと主要画面を確認した

## 14. 必須注意事項と改善候補

### 必須

- mainにマージされていないブランチを本番へ直接反映しない
- .env、パスワード、Git認証情報をGitへ追加しない
- DBの永続データを更新作業で削除しない
- 3306、8080、SSHをインターネットへ公開しない
- 更新やマイグレーション前にDBバックアップを取る
- 本番とテストでパスワード・セッション秘密鍵を分ける

### 改善候補

- DBの3306公開をやめ、Compose内部ネットワークだけで接続する構成を検証する
- GitのDeploy Keyなど、パスワードを使わない取得方法へ移行する
- NAS外への自動バックアップと世代管理を設定する
- 社外アクセスが必要になった場合はVPNを優先し、直接公開を避ける
- HTTPS、逆プロキシ、証明書、監視、ログの世代管理を別途設計する
- 再起動後の自動起動と復旧手順を両NASで定期試験する

## 15. 参考資料

- [README.md](../README.md)
- [仕様MD/06_development_environment.md](../仕様MD/06_development_environment.md)
- [仕様MD/計画/07_AsustorテストNAS配備手順.md](../仕様MD/計画/07_AsustorテストNAS配備手順.md)
- [仕様MD/計画/08_Asustor更新・DB手順.md](../仕様MD/計画/08_Asustor更新・DB手順.md)
- [scripts/nas-sync.sh](../scripts/nas-sync.sh)
- [scripts/nas-backup.sh](../scripts/nas-backup.sh)
- [QNAP Container Station Quick Start Guide](https://www.qnap.com/en-au/how-to/tutorial/article/container-station-quick-start-guide)
- [QNAP Container StationのCompose V2に関するFAQ](https://www.qnap.com/en-uk/how-to/faq/article/why-cant-i-use-docker-compose-commands-in-container-station)

## 16. 実機確認が必要な項目

- QNAP QTSの共有フォルダパス
- ASUSTOR ADMのDockerパッケージ名
- Container Station/Dockerが提供するComposeコマンド
- NASファイアウォールの設定画面と許可元IP
- 再起動後の自動起動
- NAS外バックアップの復旧可能性
