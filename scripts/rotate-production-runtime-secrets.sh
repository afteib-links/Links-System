#!/usr/bin/env bash
# 初期値のDB内部資格情報とセッション秘密鍵だけを安全なランダム値へ更新する。
# usersテーブルおよびADMIN_PASSWORDは変更しない。
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DOCKER_BIN="${1:-docker}"
[[ -f .env ]] || { echo "エラー: .env がありません。" >&2; exit 1; }

set -a
# shellcheck disable=SC1091
source .env
set +a

OLD_ROOT="${MYSQL_ROOT_PASSWORD:-links_root_change_me}"
OLD_DB="${MYSQL_PASSWORD:-links_pass_change_me}"
MYSQL_USER="${MYSQL_USER:-links}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${DB_NAME:-links_system}}"
CURRENT_SESSION="${SESSION_SECRET:-links_session_secret_change_me}"

if [[ "$OLD_ROOT" != "links_root_change_me" && "$OLD_DB" != "links_pass_change_me" && "$CURRENT_SESSION" != "links_session_secret_change_me" ]]; then
  echo "本番内部の秘密値は既に初期値から変更済みです。"
  exit 0
fi
[[ "$MYSQL_USER" =~ ^[A-Za-z0-9_]+$ && "$MYSQL_DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || {
  echo "エラー: DB名またはDBユーザー名が不正です。" >&2
  exit 1
}
command -v openssl >/dev/null 2>&1 || { echo "エラー: openssl が必要です。" >&2; exit 1; }

NEW_ROOT="$(openssl rand -hex 32)"
NEW_DB="$(openssl rand -hex 32)"
NEW_SESSION="$(openssl rand -hex 48)"
TEMP_ENV=".env.rotate.$$"

awk -v root="$NEW_ROOT" -v db="$NEW_DB" -v session="$NEW_SESSION" '
  BEGIN { root_seen=0; mysql_seen=0; db_seen=0; session_seen=0 }
  /^[[:space:]]*MYSQL_ROOT_PASSWORD=/ { print "MYSQL_ROOT_PASSWORD=" root; root_seen=1; next }
  /^[[:space:]]*MYSQL_PASSWORD=/      { print "MYSQL_PASSWORD=" db; mysql_seen=1; next }
  /^[[:space:]]*DB_PASSWORD=/         { print "DB_PASSWORD=" db; db_seen=1; next }
  /^[[:space:]]*SESSION_SECRET=/      { print "SESSION_SECRET=" session; session_seen=1; next }
  { print }
  END {
    if (!root_seen) print "MYSQL_ROOT_PASSWORD=" root
    if (!mysql_seen) print "MYSQL_PASSWORD=" db
    if (!db_seen) print "DB_PASSWORD=" db
    if (!session_seen) print "SESSION_SECRET=" session
  }
' .env > "$TEMP_ENV"

cleanup() { rm -f -- "$TEMP_ENV"; }
trap cleanup EXIT

"$DOCKER_BIN" compose exec -T db mysql -uroot -p"$OLD_ROOT" -e \
  "ALTER USER 'root'@'localhost' IDENTIFIED BY '${NEW_ROOT}'; ALTER USER '${MYSQL_USER}'@'%' IDENTIFIED BY '${NEW_DB}'; FLUSH PRIVILEGES;"

if ! mv -f -- "$TEMP_ENV" .env; then
  "$DOCKER_BIN" compose exec -T db mysql -uroot -p"$NEW_ROOT" -e \
    "ALTER USER 'root'@'localhost' IDENTIFIED BY '${OLD_ROOT}'; ALTER USER '${MYSQL_USER}'@'%' IDENTIFIED BY '${OLD_DB}'; FLUSH PRIVILEGES;" || true
  echo "エラー: .env更新に失敗したためDB資格情報を復旧しました。" >&2
  exit 1
fi
trap - EXIT

"$DOCKER_BIN" compose exec -T db mysql -u"$MYSQL_USER" -p"$NEW_DB" "$MYSQL_DATABASE" -e 'SELECT 1' >/dev/null
echo "本番内部のDB資格情報とセッション秘密鍵を初期値から更新しました（adminパスワードは変更していません）。"
