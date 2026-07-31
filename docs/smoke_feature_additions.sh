#!/usr/bin/env bash
# 機能追加仕様06 仮組の簡易 API スモーク
set -euo pipefail
BASE="${BASE_URL:-http://localhost:8080}"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

curl -sf -c "$COOKIE" -b "$COOKIE" -H 'Content-Type: application/json' \
  -d '{"login_id":"admin","password":"admin1234"}' "$BASE/api/auth/login" >/dev/null

check() {
  local name="$1" url="$2"
  local body
  body="$(curl -sf -b "$COOKIE" "$url")"
  echo "$body" | grep -q '"ok":true' || { echo "FAIL $name: $body"; exit 1; }
  echo "OK $name"
}

check health "$BASE/api/health"
check companies "$BASE/api/companies"
check partners "$BASE/api/partners"
check layouts "$BASE/api/layouts/companies"
check price_sets "$BASE/api/price-sets"
check master_hub "$BASE/api/master-settings/hub"
check month_projects "$BASE/api/daily-reports/month-projects?target_year_month=2026-07"
check invoices "$BASE/api/invoices"
check payments "$BASE/api/payments"
check advances "$BASE/api/advances?target_year_month=2026-07"
echo "ALL SMOKE OK"
