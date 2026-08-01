# Asustor テストNAS 配備手順（画面クリック順）

> 状態: **適用中**  
> 対象機: **ASUSTOR AS3202T** / **ADM 4.3.3**（Intel Celeron x86-64 / メモリ 2GB）  
> 役割: **テスト環境**（本番は QNAP TS-464）  
> アプリ: Links-System（Docker Compose）  
> アクセス: `http://<AsustorのIP>:8080`  
> 関連: [`06_development_environment.md`](../06_development_environment.md)

## 0. 全体の位置づけ

```text
開発（Cursor / ローカル）
        │  コードを git で反映
        ▼
Asustor（本手順）＝ テスト
        │  検証後にデータ移行（別手順）
        ▼
QNAP ＝ 本番
```

- 本手順は **テストNASへの初回配備・更新** 用
- 本番QNAPへの移行は、本手順完了・試験OK後に別途実施
- メモリ 2GB のため **テスト専用**。他の重いアプリと同居しない

## 1. 事前確認

| 項目 | 確認内容 |
|------|----------|
| 機種 | AS3202T（x86-64）であること |
| ADM | 4.3 系（本手順は 4.3.3 想定） |
| ネットワーク | PC と同じ LAN（または Tailscale）で ADM に入れる |
| GitHub | リポジトリ `afteib-links/Links-System` にアクセスできること（プライベートならトークン／鍵） |
| 空き容量 | 共有フォルダに数GB以上の余裕 |

ADM の確認手順:

1. PCブラウザで `http://<AsustorのIP>:8000`（またはお使いのADM URL）を開く  
2. 管理者でログイン  
3. 左メニュー **設定（Settings）** → **システム情報** → **このNASについて**  
4. モデルが **AS3202T**、ADM が **4.3.x** であることを確認  

## 2. Docker の導入

1. ADM 左メニュー **App Central** を開く  
2. 検索欄に `Docker` と入力  
3. **Docker**（公式／Asustor提供の Docker パッケージ）を選択  
4. **インストール** をクリックし、完了まで待つ  
5. 必要なら NAS を再起動（インストール画面の指示に従う）  
6. インストール後、App Central またはデスクトップに **Docker** アイコンがあることを確認  

> Portainer が入っている場合も可。本手順の本体操作は **ターミナル（SSH）＋ docker compose** を推奨（再現性が高い）。

## 3. 共有フォルダの用意

1. ADM 左メニュー **アクセス制御**（または **共有フォルダ**）を開く  
2. **追加**（または新規共有フォルダ）をクリック  
3. 例として次を作成する  

| 項目 | 推奨値 |
|------|--------|
| フォルダ名 | `docker` |
| パス例 | `/volume1/docker`（表示名は環境により異なる） |

4. 管理者ユーザーに **読み書き** 権限を付与して保存  

その下にアプリ用ディレクトリを後で作ります（例: `docker/Links-System`）。

## 4. ターミナル（SSH）を有効化

1. ADM 左メニュー **サービス** → **ターミナル**（または **ADM SSH** / **Terminal**）を開く  
2. **SSH サービスを有効にする** にチェック  
3. ポートは標準 `22` のままでよい（社内のみ想定）  
4. **適用** / **保存**  

接続確認（PC側）:

```bash
ssh admin@<AsustorのIP>
```

初回は指紋確認に `yes`。パスワードは ADM 管理者パスワード。

## 5. リポジトリの配置

SSH でログインしたあと、次を実行する（パスは共有フォルダに合わせて調整）。

```bash
# 作業ディレクトリへ（例）
cd /volume1/docker

# 未取得なら clone（HTTPS の場合）
git clone https://github.com/afteib-links/Links-System.git
cd Links-System

# 既にある場合は更新
# cd /volume1/docker/Links-System && git fetch && git checkout cursor/all-features-draft-148a && git pull
```

プライベートリポジトリの場合:

- GitHub の Personal Access Token をパスワード代わりに使う  
- または NAS に配置したデプロイ鍵で `git@github.com:...` を使う  

確認:

```bash
ls
# docker-compose.yml  Dockerfile  frontend  backend  db  があること
```

## 6. 環境変数（テスト用 `.env`）

```bash
cd /volume1/docker/Links-System
cp .env.example .env
```

`nano .env` または WinSCP 等で編集。**テスト用**の例:

```bash
APP_PORT=3000
TZ=Asia/Tokyo

MYSQL_ROOT_PASSWORD=test_root_change_me
MYSQL_DATABASE=links_system
MYSQL_USER=links
MYSQL_PASSWORD=test_links_change_me

DB_HOST=host.docker.internal
DB_PORT=3306
DB_NAME=links_system
DB_USER=links
DB_PASSWORD=test_links_change_me

SESSION_SECRET=test_session_secret_change_me_long

ADMIN_LOGIN_ID=admin
ADMIN_PASSWORD=admin1234
ADMIN_DISPLAY_NAME=管理者
```

注意:

- **本番QNAPと同じパスワードにしない**  
- テスト完了後、管理者パスワードは必ず変更する  

## 7. 初回起動（ビルド）

メモリ 2GB のため、起動前に他の重いアプリを止める。

```bash
cd /volume1/docker/Links-System
docker compose up --build -d
```

初回はイメージ取得・ビルドで数分かかることがある。

状態確認:

```bash
docker compose ps
docker compose logs app --tail 50
```

ログに次があれば成功の目安:

- `[migrate] done:` または `skip:`  
- `[boot] Links-System listening on :3000`  

## 8. ファイアウォール / ポート

1. ADM で **設定** → **ファイアウォール**（有効な場合）を開く  
2. 受信で **TCP 8080** を許可（社内LAN向け）  
3. 外部（インターネット）へは開けない  

DB の **3306** は社外公開しない。テストでも可能なら LAN 内のみ。

## 9. ブラウザで動作確認

1. PC（または同一LANの端末）でブラウザを開く  
2. `http://<AsustorのIP>:8080` へアクセス  
3. ログインID `admin` / パスワード（`.env` の値）でログイン  
4. 確認項目  

| 確認 | 期待 |
|------|------|
| `/api/health` | `{"ok":true,"db":"up",...}` |
| 機能ランチャー | 権限に応じたボタンが表示 |
| 企業マスタ | 一覧が開く |
| 日報 | 月次一覧・入力が開く |

## 10. 更新手順（2回目以降）

コード／DBをテストNASへ反映するときの詳細は、次を正とする。

→ **[08_Asustor更新・DB手順.md](08_Asustor更新・DB手順.md)**

要約（通常はこれだけ）:

```bash
cd /volume1/docker/Links-System
git fetch
git checkout main
git pull
docker compose up --build -d
docker compose logs app --tail 50
```

- DBマイグレーションは起動時に自動適用される  
- `data/mysql` は Volume のため、通常はデータが残る  
- 壊れたとき以外、`data/mysql` を消さない  
- バックアップ／リストア／初期化は 08 を参照  

## 11. 停止・再起動

```bash
cd /volume1/docker/Links-System

# 停止
docker compose down

# 起動（データは保持）
docker compose up -d
```

NAS再起動後は `restart: unless-stopped` により、Dockerサービスが動けばコンテナも復帰する想定。戻らない場合は上記 `up -d` を再実行。

## 12. メモリ不足時の対処（2GB）

症状例: コンテナが落ちる、応答が極端に遅い、OOM。

1. App Central で不要アプリを停止  
2. `docker compose ps` で不要コンテナが動いていないか確認  
3. 一時退避:  
   `docker compose down` → 他作業終了後に `up -d`  
4. それでも厳しい場合は、MariaDB のバッファを下げるカスタム設定を別途追加（必要なら依頼）

## 13. よくある失敗

| 症状 | 確認 |
|------|------|
| 画面が開かない | IP・ポート8080・ファイアウォール・`docker compose ps` |
| ログインできない | `.env` の ADMIN_*、コンテナ再作成後か |
| DB接続エラー | `docker compose logs db` / `app`、`DB_HOST=host.docker.internal` |
| git clone 失敗 | GitHub認証・ネット・DNS |
| ビルドが落ちる | メモリ不足。他アプリ停止後に再実行 |

## 14. 次のステップ

1. 本手順で Asustor 上のテスト運用を安定させる  
2. 試験データを投入し、業務シナリオを確認  
3. 問題なければ **テスト→QNAP本番** のデータ移行手順を作成・実施  
4. 日々のソース／DB更新は [08_Asustor更新・DB手順.md](08_Asustor更新・DB手順.md)  

---

## 決定メモ

* テスト環境実機: **ASUSTOR AS3202T / ADM 4.3.3**（メモリ2GB）  
* 本番環境実機: **QNAP TS-464 / QTS**（メモリ8GB）  
* 配備単位: 同一リポジトリの `docker-compose.yml`  
* 公開: 社内LANの `http://<NASのIP>:8080`（テストも同様）
