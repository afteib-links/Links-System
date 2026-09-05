#!/usr/bin/env bash
# 移行元マニフェストと、現在のNAS DB・アプリコミットが一致するかを確認する。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../" && pwd)"
cd "$ROOT"

MANIFEST_FILE="${1:-}"
if [[ -z "$MANIFEST_FILE" || ! -f "$MANIFEST_FILE" ]]; then
  echo "使い方: $0 <移行元マニフェスト>" >&2
  exit 2
fi

# マニフェストは値だけを読み込む。source しないことで、誤ったファイルを指定しても
# シェルコードとして実行されないようにする。
manifest_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$MANIFEST_FILE" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

FORMAT_VERSION="$(manifest_value FORMAT_VERSION)"
DATABASE="$(manifest_value DATABASE)"
MIGRATIONS="$(manifest_value MIGRATIONS)"
LATEST_MIGRATION="$(manifest_value LATEST_MIGRATION)"
COMPANIES="$(manifest_value COMPANIES)"
PARTNERS="$(manifest_value PARTNERS)"
BASE_PROJECTS="$(manifest_value BASE_PROJECTS)"
PROJECTS="$(manifest_value PROJECTS)"
PRICE_SETS="$(manifest_value PRICE_SETS)"
DAILY_REPORTS="$(manifest_value DAILY_REPORTS)"
ADVANCE_PAYMENTS="$(manifest_value ADVANCE_PAYMENTS)"
INVOICES="$(manifest_value INVOICES)"
PAYMENTS="$(manifest_value PAYMENTS)"
SOURCE_GIT_COMMIT="$(manifest_value SOURCE_GIT_COMMIT)"

if [[ "$FORMAT_VERSION" != "1" ]]; then
  echo "エラー: 未対応のマニフェストです。" >&2
  exit 2
fi
if [[ ! "$DATABASE" =~ ^[A-Za-z0-9_]+$ || ! "$SOURCE_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "エラー: マニフェストのDB名またはGitコミットが不正です。" >&2
  exit 2
fi
for value in "$MIGRATIONS" "$COMPANIES" "$PARTNERS" "$BASE_PROJECTS" "$PROJECTS" "$PRICE_SETS" "$DAILY_REPORTS" "$ADVANCE_PAYMENTS" "$INVOICES" "$PAYMENTS"; do
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "エラー: マニフェストの件数が不正です。" >&2
    exit 2
  fi
done

set -a
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +a

MYSQL_USER="${MYSQL_USER:-links}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-links_pass_change_me}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${DB_NAME:-links_system}}"

scalar() {
  docker compose exec -T db mysql -N -B \
    -u"${MYSQL_USER}" -p"${MYSQL_PASSWORD}" "${MYSQL_DATABASE}" -e "$1"
}

failed=0
check() {
  local label="$1"
  local expected="$2"
  local sql="$3"
  local actual
  actual="$(scalar "$sql")"
  if [[ "$actual" == "$expected" ]]; then
    echo "OK  ${label}: ${actual}"
  else
    echo "NG  ${label}: expected=${expected}, actual=${actual}" >&2
    failed=1
  fi
}

if [[ "$MYSQL_DATABASE" != "$DATABASE" ]]; then
  echo "NG  database: expected=${DATABASE}, actual=${MYSQL_DATABASE}" >&2
  failed=1
else
  echo "OK  database: ${MYSQL_DATABASE}"
fi

check 'migrations' "$MIGRATIONS" 'SELECT COUNT(*) FROM schema_migrations'
check 'latest migration' "$LATEST_MIGRATION" 'SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1'
check 'companies' "$COMPANIES" 'SELECT COUNT(*) FROM companies'
check 'partners' "$PARTNERS" 'SELECT COUNT(*) FROM partners'
check 'base projects' "$BASE_PROJECTS" 'SELECT COUNT(*) FROM base_projects'
check 'projects' "$PROJECTS" 'SELECT COUNT(*) FROM projects'
check 'price sets' "$PRICE_SETS" 'SELECT COUNT(*) FROM price_sets'
check 'daily reports' "$DAILY_REPORTS" 'SELECT COUNT(*) FROM daily_reports'
check 'advance payments' "$ADVANCE_PAYMENTS" 'SELECT COUNT(*) FROM advance_payments'
check 'invoices' "$INVOICES" 'SELECT COUNT(*) FROM invoices'
check 'payments' "$PAYMENTS" 'SELECT COUNT(*) FROM payments'

TARGET_GIT_COMMIT="$(git rev-parse HEAD)"
if [[ "$TARGET_GIT_COMMIT" == "$SOURCE_GIT_COMMIT" ]]; then
  echo "OK  git commit: ${TARGET_GIT_COMMIT}"
else
  echo "NG  git commit: expected=${SOURCE_GIT_COMMIT}, actual=${TARGET_GIT_COMMIT}" >&2
  failed=1
fi

exit "$failed"
