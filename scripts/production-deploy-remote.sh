#!/usr/bin/env bash
# production-deploy.ps1 から QNAP 上で呼び出す本番反映処理。
set -euo pipefail

PROJECT_PATH="${1:-}"
TRANSFER_DIR="${2:-}"
SYSTEM_BACKUP="${3:-no}"
DATABASE_BACKUP="${4:-no}"
DATABASE_MODE="${5:-update}"
FILES_MODE="${6:-no}"
DEPLOYMENT_ID="${7:-unknown}"
ROTATE_WEAK_SECRETS="${8:-no}"
REASON_B64="${9:-}"

case "$PROJECT_PATH" in
  /share/*/Links-System|/share/Links-System) ;;
  *) echo "エラー: 本番パスが許可範囲外です: $PROJECT_PATH" >&2; exit 2 ;;
esac
[[ "$PROJECT_PATH" != *"/../"* && "$PROJECT_PATH" != *"/./"* ]] || {
  echo "エラー: 本番パスに相対移動要素は使用できません。" >&2
  exit 2
}
[[ "$TRANSFER_DIR" == /share/*/links-production-deploy-* ]] || {
  echo "エラー: 転送ディレクトリが不正です。" >&2
  exit 2
}
[[ "$SYSTEM_BACKUP" =~ ^(yes|no)$ ]] || exit 2
[[ "$DATABASE_BACKUP" =~ ^(yes|no)$ ]] || exit 2
[[ "$DATABASE_MODE" =~ ^(update|replace)$ ]] || exit 2
[[ "$FILES_MODE" =~ ^(yes|no)$ ]] || exit 2
[[ "$ROTATE_WEAK_SECRETS" =~ ^(yes|no)$ ]] || exit 2
[[ "$REASON_B64" =~ ^[A-Za-z0-9+/=]*$ ]] || { echo "エラー: 実行理由の形式が不正です。" >&2; exit 2; }
[[ -s "$TRANSFER_DIR/system.tgz" ]] || { echo "エラー: system.tgz がありません。" >&2; exit 2; }

REASON=""
if [[ -n "$REASON_B64" ]]; then
  REASON="$(printf '%s' "$REASON_B64" | base64 -d)" || {
    echo "エラー: 実行理由を復号できません。" >&2
    exit 2
  }
  REASON="${REASON//$'\r'/ }"
  REASON="${REASON//$'\n'/ }"
  REASON="${REASON//$'\t'/ }"
fi

find_docker() {
  local candidate
  for candidate in \
    /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker \
    /share/CACHEDEV2_DATA/.qpkg/container-station/bin/docker \
    /share/CACHEDEV3_DATA/.qpkg/container-station/bin/docker; do
    if [[ -x "$candidate" ]]; then printf '%s' "$candidate"; return; fi
  done
  command -v docker 2>/dev/null || true
}

DOCKER_BIN="$(find_docker)"
[[ -n "$DOCKER_BIN" ]] || { echo "エラー: Docker が見つかりません。" >&2; exit 1; }
export PATH="$(dirname "$DOCKER_BIN"):$PATH"
umask 077
mkdir -p "$PROJECT_PATH" "$PROJECT_PATH/backups" "$PROJECT_PATH/data/mysql" \
  "$PROJECT_PATH/data/uploads" "$PROJECT_PATH/data/pdf"

if [[ "$SYSTEM_BACKUP" == "yes" ]] && [[ -f "$PROJECT_PATH/docker-compose.yml" ]]; then
  system_backup="$PROJECT_PATH/backups/system_${DEPLOYMENT_ID}.tgz"
  echo "システムバックアップ: $system_backup"
  tar -C "$PROJECT_PATH" -czf "$system_backup" \
    --exclude='./data' --exclude='./backups' .
fi

# 現行コードだけを入れ替える。.env、DB、添付、PDF、既存バックアップは保持する。
find "$PROJECT_PATH" -mindepth 1 -maxdepth 1 \
  ! -name '.env' ! -name 'data' ! -name 'backups' \
  -exec rm -rf -- {} +
tar -C "$PROJECT_PATH" -xzf "$TRANSFER_DIR/system.tgz"

if [[ "$FILES_MODE" == "yes" ]]; then
  [[ -s "$TRANSFER_DIR/files.tgz" ]] || { echo "エラー: files.tgz がありません。" >&2; exit 2; }
  tar -C "$PROJECT_PATH" -xzf "$TRANSFER_DIR/files.tgz"
fi

cd "$PROJECT_PATH"
[[ -f .env ]] || {
  echo "エラー: 本番用 .env がありません。秘密情報を設定してから再実行してください。" >&2
  exit 1
}
# QNAPのSSHユーザーHOMEがContainer Station管理領域を指し、buildxが書き込めない
# 構成があるため、本ツール専用のDocker設定領域をプロジェクト内に置く。
DEPLOY_HOME="$PROJECT_PATH/.production-deploy-home"
mkdir -p "$DEPLOY_HOME/.docker"
chmod 700 "$DEPLOY_HOME" "$DEPLOY_HOME/.docker"
export HOME="$DEPLOY_HOME"
export DOCKER_CONFIG="$DEPLOY_HOME/.docker"
export XDG_CONFIG_HOME="$DEPLOY_HOME/.config"
"$DOCKER_BIN" compose config --quiet
"$DOCKER_BIN" compose build app
"$DOCKER_BIN" compose up -d db

for _ in $(seq 1 40); do
  if "$DOCKER_BIN" compose exec -T db healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
"$DOCKER_BIN" compose exec -T db healthcheck.sh --connect --innodb_initialized >/dev/null

if [[ "$ROTATE_WEAK_SECRETS" == "yes" ]]; then
  bash scripts/rotate-production-runtime-secrets.sh "$DOCKER_BIN"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a
MYSQL_USER="${MYSQL_USER:-links}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-links_pass_change_me}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${DB_NAME:-links_system}}"

db_has_schema=0
if "$DOCKER_BIN" compose exec -T db mysql -N -B \
  -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
  -e "SHOW TABLES LIKE 'schema_migrations'" 2>/dev/null | grep -q schema_migrations; then
  db_has_schema=1
fi

if [[ "$DATABASE_BACKUP" == "yes" && "$db_has_schema" == "1" ]]; then
  echo "データベースバックアップを作成します。"
  bash scripts/nas-db-export.sh backups
elif [[ "$DATABASE_BACKUP" == "yes" ]]; then
  echo "既存DBが未初期化のため、DBバックアップは対象なしです。"
fi

if [[ "$DATABASE_MODE" == "replace" ]]; then
  shopt -s nullglob
  db_dumps=("$TRANSFER_DIR"/links_*.sql)
  shopt -u nullglob
  if [[ "${#db_dumps[@]}" != "1" ]]; then
    echo "エラー: 差し替え用DBダンプは1件必要です（検出=${#db_dumps[@]}件）。" >&2
    exit 2
  fi
  db_dump="${db_dumps[0]}"
  db_manifest="${db_dump%.sql}.manifest"
  [[ -s "$db_dump" && -s "$db_manifest" ]] || {
    echo "エラー: 差し替え用DBダンプまたは対応するマニフェストがありません。" >&2
    exit 2
  }
  bash scripts/nas-db-replace.sh \
    "$db_dump" "$db_manifest" \
    --confirm-replace --no-backup --skip-git-check
else
  "$DOCKER_BIN" compose up -d
fi

health_ok=0
for _ in $(seq 1 60); do
  response="$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/api/health 2>/dev/null || true)"
  if grep -Eq '"db"[[:space:]]*:[[:space:]]*"up"' <<<"$response"; then
    health_ok=1
    echo "ヘルスチェック成功: $response"
    break
  fi
  sleep 2
done
if [[ "$health_ok" != "1" ]]; then
  echo "エラー: /api/health が db=up になりませんでした。" >&2
  "$DOCKER_BIN" compose ps >&2 || true
  "$DOCKER_BIN" compose logs app --tail 100 >&2 || true
  exit 1
fi

"$DOCKER_BIN" compose ps
printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$(date -Iseconds)" "$DEPLOYMENT_ID" "$SYSTEM_BACKUP" "$DATABASE_BACKUP" "$DATABASE_MODE/$FILES_MODE" "$REASON" \
  >> "$PROJECT_PATH/backups/production-deploy.log"
echo "本番反映が完了しました: $DEPLOYMENT_ID"
rm -rf -- "$TRANSFER_DIR"
