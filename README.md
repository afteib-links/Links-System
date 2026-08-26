# Links-System

運送業務基幹システム（QNAP NAS / 社内LAN向け）。

**AI で開発する場合**: 先に [`AGENTS.md`](AGENTS.md) と [`仕様MD/00_現状スナップショット.md`](仕様MD/00_現状スナップショット.md) を読む。日報・精算・帳票・FBに触れる場合は、[`仕様MD/09_日報・精算・帳票_業務要件.md`](仕様MD/09_日報・精算・帳票_業務要件.md) と [`仕様MD/10_入出金管理・FB_業務要件.md`](仕様MD/10_入出金管理・FB_業務要件.md) も必須。

現在は **全機能の仮組後、日報・精算・帳票・入出金管理の業務要件を確定するフェーズ**です。Docker Compose、MariaDB、認証API、各機能の仮組・HTMLプロトタイプはありますが、本計算とPDF帳票はこれから実装します。

## 構成

| 層 | 技術 | 説明 |
|----|------|------|
| フロント | HTML / CSS / JavaScript（SPA） | ログイン画面と基盤ホーム |
| API | Node.js 20 + Express | 認証・ヘルスチェック |
| DB | MariaDB 10.11 | 共有データ保存 |
| 配備 | Docker Compose | ローカル / QNAP Container Station |

> `app` 容器は `host.docker.internal` 経由で MariaDB の公開ポート（3306）へ接続します。QNAP / 一般的なDocker環境でも動作します。

## 起動方法（ローカル）

1. 環境変数ファイルを用意する

```bash
cp .env.example .env
```

2. コンテナを起動する

```bash
docker compose up --build -d
```

3. ブラウザで開く

- 画面: [http://localhost:8080](http://localhost:8080)
- ヘルスチェック: [http://localhost:8080/api/health](http://localhost:8080/api/health)

4. 初期管理者でログインする（`.env` の値）

| 項目 | 初期値 |
|------|--------|
| ログインID | `admin` |
| パスワード | `admin1234` |

> 本番（QNAP）では必ず `.env` のパスワードと `SESSION_SECRET` を変更してください。

## 主なAPI

| メソッド | パス | 認証 | 内容 |
|----------|------|------|------|
| GET | `/api/health` | 不要 | DB疎通を含むヘルスチェック |
| POST | `/api/auth/login` | 不要 | `{ "login_id", "password" }` |
| POST | `/api/auth/logout` | Cookie | ログアウト |
| GET | `/api/auth/me` | 必要 | ログイン中ユーザー（権限一覧含む） |
| GET/POST | `/api/users` | ユーザー管理権限 | ユーザー一覧 / 作成 |
| PUT/DELETE | `/api/users/:id` | ユーザー管理権限 | 更新 / 論理削除 |

### 機能権限

ログイン仕様は `仕様MD/Login.md` を正とします。

ユーザーには次の権限を複数付与できます。

- 管理者 / システム担当者 / 経営者 / 総務 / 営業 / パートナー / 企業

権限の組み合わせから、利用できる機能（マスタ・日報・請求など）が決まります。
無効化したユーザーはログインできません。

## ディレクトリ

```text
backend/          Express API
frontend/         SPA（静的配信）
db/migrations/    SQLマイグレーション
docker-compose.yml
Dockerfile
仕様MD/           業務・画面仕様
```

## 停止

```bash
docker compose down
```

DBデータを消してやり直す場合:

```bash
docker compose down
rm -rf data/mysql
docker compose up --build -d
```

## 次の開発予定

1. `仕様MD/09`・`10` の未確定事項を業務確認し、決定ログへ残す
2. 日報・前払・分割返済・請求・支払・入出金管理のデータモデルを分離して設計する
3. 計算・帳票のテストケースとPDFプロトタイプを作成する
4. 合意済みの単位からDB/API/画面を1作業1PRで実装する
