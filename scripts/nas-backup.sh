#!/usr/bin/env bash
# NAS 上の Links-System で DB バックアップ（仕様MD/計画/08 §4）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../" && pwd)"
cd "$ROOT"

mkdir -p backups
set -a
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +a

MYSQL_USER="${MYSQL_USER:-links}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-links_pass_change_me}"
MYSQL_DATABASE="${MYSQL_DATABASE:-links_system}"
OUT="backups/links_${MYSQL_DATABASE}_$(date +%Y%m%d_%H%M%S).sql"

docker compose exec -T db \
  mysqldump -u"${MYSQL_USER}" -p"${MYSQL_PASSWORD}" \
  --single-transaction --routines --triggers \
  "${MYSQL_DATABASE}" > "$OUT"

ls -lh "$OUT"
echo "backup: $OUT"
