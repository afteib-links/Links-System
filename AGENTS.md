# AGENTS.md

## Cursor Cloud specific instructions

このリポジトリは運送業務基幹システム「Links-System」です。スタックは Node.js + Express（API）、MariaDB（DB）、HTML5 SPA（`frontend/` を Express が同一オリジンで静的配信）、本番配備は Docker Compose（QNAP NAS）。標準的なコマンドは `README.md` を参照してください。ここには自動化されない・分かりにくい起動時の注意点のみ記載します。

### DBの起動（毎セッション必要）

- 開発DBは **VMにネイティブ導入した MariaDB 10.11** を使います（`docker` は未導入。Docker Compose は本番/NAS配備用の定義であり、ローカル開発では使いません）。
- MariaDB は systemd 非稼働のため、セッション開始時に手動起動が必要です:
  ```bash
  sudo service mariadb start
  ```
- データベース `links_system` とユーザー `links`（パスワード `changeme`、localhost と 127.0.0.1 両方）は作成済みで、MariaDB のデータディレクトリはVMスナップショットに永続化されます。もし接続エラーが出る場合のみ再作成してください:
  ```bash
  sudo mysql -e "CREATE DATABASE IF NOT EXISTS links_system CHARACTER SET utf8mb4; \
    CREATE USER IF NOT EXISTS 'links'@'localhost' IDENTIFIED BY 'changeme'; \
    CREATE USER IF NOT EXISTS 'links'@'127.0.0.1' IDENTIFIED BY 'changeme'; \
    GRANT ALL PRIVILEGES ON links_system.* TO 'links'@'localhost'; \
    GRANT ALL PRIVILEGES ON links_system.* TO 'links'@'127.0.0.1'; FLUSH PRIVILEGES;"
  ```

### アプリの起動

- 環境変数は `.env`（`.env.example` からコピー。DB_HOST は `127.0.0.1`）。`.env` は gitignore 済み。
- バックエンド起動で API と SPA の両方が `http://localhost:3000` で配信されます:
  ```bash
  cd backend && npm run dev   # node --watch でホットリロード
  ```
- 起動時にスキーマ（`db/init.sql`）を自動適用し、初期管理者 `admin` / `admin123` を自動作成します（既存なら何もしない）。

### 注意点（gotchas）

- スキーマを変更したら `db/init.sql` を更新してください。起動時に `IF NOT EXISTS` で適用するため、**既存テーブルの列変更は自動反映されません**（手動 ALTER が必要）。
- 楽観的ロック: `companies` の更新は `version` 列一致時のみ成功し、不一致は HTTP 409 を返します。更新APIには取得時の `version` を必ず添えてください。
- `frontend/` は静的配信のためビルド不要。JS/HTML/CSS の変更はブラウザ再読み込みだけで反映されます（バックエンドの `node --watch` とは別）。
