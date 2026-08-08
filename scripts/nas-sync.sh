#!/usr/bin/env bash
# NAS 上で main を取り込み Docker を再ビルド（仕様MD/計画/08 §2）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../" && pwd)"
cd "$ROOT"

WITH_BACKUP=0
if [[ "${1:-}" == "--backup" ]]; then
  WITH_BACKUP=1
fi

if [[ $WITH_BACKUP -eq 1 ]]; then
  "$(dirname "$0")/nas-backup.sh"
fi

git fetch origin
git checkout main
git pull origin main

docker compose up --build -d
docker compose logs app --tail 50

echo "--- health ---"
curl -sf "http://127.0.0.1:8080/api/health" || curl -sf "http://127.0.0.1:3000/api/health" || true
echo ""
