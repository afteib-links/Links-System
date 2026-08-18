#!/usr/bin/env bash
# Cloud Agent 用インストール（冪等）: MariaDB 導入・依存インストール・DB/ユーザー作成
# ローカル Docker を使わず、VM 内に MariaDB を直接用意して backend を動かすための下準備。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. システム依存: MariaDB サーバー（未導入時のみ）
if ! command -v mariadbd >/dev/null 2>&1; then
  echo "[install] installing mariadb-server..."
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mariadb-server
fi

# 2. .env（未作成時のみ）。ローカル VM では DB へ 127.0.0.1 で接続する
if [ ! -f .env ]; then
  echo "[install] creating .env from .env.example"
  cp .env.example .env
  sed -i 's/^DB_HOST=db/DB_HOST=127.0.0.1/' .env
fi

# 3. backend 依存（lockfile 準拠）
echo "[install] installing backend dependencies..."
npm ci --prefix backend

# 4. MariaDB を起動し、アプリ用 DB とユーザーを用意（冪等）
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${DB_NAME:=links_system}"
: "${DB_USER:=links}"
: "${DB_PASSWORD:=links_pass_change_me}"

sudo service mariadb start
for _ in $(seq 1 30); do
  if sudo mariadb -e "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

sudo mariadb <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "[install] done"
