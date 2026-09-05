#!/usr/bin/env bash
# 移行先NASのDBを、移行元で作成したダンプで完全置換する。
# 対象DBを削除するため、--confirm-replace を明示しない限り実行しない。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../" && pwd)"
cd "$ROOT"
umask 077

DUMP_FILE="${1:-}"
MANIFEST_FILE="${2:-}"
CONFIRMATION="${3:-}"
if [[ -z "$DUMP_FILE" || -z "$MANIFEST_FILE" || "$CONFIRMATION" != "--confirm-replace" ]]; then
  echo "使い方: $0 <移行元.sql> <移行元.manifest> --confirm-replace" >&2
  exit 2
fi
if [[ ! -s "$DUMP_FILE" || ! -f "$MANIFEST_FILE" ]]; then
  echo "エラー: ダンプまたはマニフェストが見つからないか空です。" >&2
  exit 2
fi
SOURCE_DUMP_PATH="$DUMP_FILE"

# マニフェストは値だけを読み込む。source しないことで、指定ファイルをシェルコードとして
# 実行しないようにする。
manifest_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$MANIFEST_FILE" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

FORMAT_VERSION="$(manifest_value FORMAT_VERSION)"
DATABASE="$(manifest_value DATABASE)"
MANIFEST_DUMP_FILE="$(manifest_value DUMP_FILE)"
DUMP_SHA256="$(manifest_value DUMP_SHA256)"
SOURCE_GIT_COMMIT="$(manifest_value SOURCE_GIT_COMMIT)"
if [[ "$FORMAT_VERSION" != "1" || "$MANIFEST_DUMP_FILE" != "${SOURCE_DUMP_PATH##*/}" ]]; then
  echo "エラー: マニフェスト形式またはダンプ名が不正です。" >&2
  exit 2
fi

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  fi
}

if [[ "$(sha256 "$SOURCE_DUMP_PATH")" != "$DUMP_SHA256" ]]; then
  echo "エラー: 移行元ダンプのSHA-256がマニフェストと一致しません。" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +a

MYSQL_USER="${MYSQL_USER:-links}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-links_pass_change_me}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${DB_NAME:-links_system}}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-links_root_change_me}"

if [[ "$MYSQL_DATABASE" != "$DATABASE" ]]; then
  echo "エラー: 移行元DB=${DATABASE} と移行先DB=${MYSQL_DATABASE} が一致しません。" >&2
  exit 1
fi
if [[ ! "$MYSQL_DATABASE" =~ ^[A-Za-z0-9_]+$ || ! "$MYSQL_USER" =~ ^[A-Za-z0-9_]+$ || ! "$DATABASE" =~ ^[A-Za-z0-9_]+$ || ! "$MANIFEST_DUMP_FILE" =~ ^[A-Za-z0-9_.-]+$ || ! "$DUMP_SHA256" =~ ^[0-9a-fA-F]{64}$ || ! "$SOURCE_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "エラー: DB名またはDBユーザー名に使用できない文字が含まれます。" >&2
  exit 1
fi
if [[ "$(git rev-parse HEAD)" != "$SOURCE_GIT_COMMIT" ]]; then
  echo "エラー: 移行元と移行先のアプリコミットが一致しません。先に同じコミットへ更新してください。" >&2
  exit 1
fi

ROLLBACK_MANIFEST=""
app_stopped=0
cleanup() {
  local code=$?
  if [[ "$app_stopped" == "1" ]]; then
    docker compose start app >/dev/null 2>&1 || true
  fi
  if [[ "$code" != "0" ]]; then
    echo "移行失敗。移行先の直前バックアップで復旧してください: ${ROLLBACK_MANIFEST:-未作成}" >&2
  fi
  exit "$code"
}
trap cleanup EXIT

echo "移行先DBの復旧用バックアップを作成します。"
BACKUP_OUTPUT="$(bash ./scripts/nas-db-export.sh backups)"
printf '%s\n' "$BACKUP_OUTPUT"
ROLLBACK_MANIFEST="$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^照合情報: //p' | tail -n 1)"
if [[ -z "$ROLLBACK_MANIFEST" || ! -f "$ROLLBACK_MANIFEST" ]]; then
  echo "エラー: 移行先の復旧用マニフェストを確認できません。" >&2
  exit 1
fi

echo "アプリを停止し、DBを再作成して完全置換します。"
docker compose stop app
app_stopped=1
docker compose exec -T db mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" -e \
  "DROP DATABASE IF EXISTS \`${MYSQL_DATABASE}\`; CREATE DATABASE \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%'; FLUSH PRIVILEGES;"
docker compose exec -T db mysql -u"${MYSQL_USER}" -p"${MYSQL_PASSWORD}" "${MYSQL_DATABASE}" < "$SOURCE_DUMP_PATH"

# DBを再作成すると旧セッションは消えるが、明示的に空にして全利用者の再ログインを保証する。
docker compose exec -T db mysql -u"${MYSQL_USER}" -p"${MYSQL_PASSWORD}" "${MYSQL_DATABASE}" -e 'DELETE FROM sessions'

docker compose start app
app_stopped=0

echo "アプリ起動とマイグレーション完了を待機します。"
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:8080/api/health >/dev/null; then
    break
  fi
  sleep 2
done
curl --fail --silent --show-error http://127.0.0.1:8080/api/health >/dev/null
docker compose logs --tail=200 app | grep -E 'migration|migrate|Migration' || true

bash ./scripts/nas-db-verify.sh "$MANIFEST_FILE"
trap - EXIT
echo "完全置換が完了しました。復旧用マニフェスト: $ROLLBACK_MANIFEST"
