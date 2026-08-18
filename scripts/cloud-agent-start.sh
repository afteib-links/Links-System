#!/usr/bin/env bash
# Cloud Agent 用の起動時処理（冪等）: MariaDB を起動し、接続可能になるまで待つ。
# backend 本体は terminals（environment.json）側で起動する。
set -euo pipefail

sudo service mariadb start

for _ in $(seq 1 30); do
  if sudo mariadb -e "SELECT 1" >/dev/null 2>&1; then
    echo "[start] mariadb ready"
    exit 0
  fi
  sleep 1
done

echo "[start] mariadb failed to become ready" >&2
exit 1
