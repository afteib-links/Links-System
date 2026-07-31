# Links-System

運送業務基幹システム（QNAP NAS / 社内LAN向け）。

現在は **基盤フェーズ**（Docker Compose + MariaDB + 認証API + ログイン画面）まで実装済みです。

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

ユーザーごとに、次の機能の利用可否を設定できます。

- 企業マスタ / パートナーマスタ / 案件マスタ
- 日報 / 先払い / 請求 / 支払
- ユーザー管理

管理者ロールは全機能が自動付与されます。無効化したユーザーはログインできません。

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

1. 企業マスタ CRUD
2. パートナーマスタ CRUD
3. 案件マスタ（改定履歴）
4. 日報・先払い・請求・支払
