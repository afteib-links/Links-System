#!/usr/bin/env bash
# Links-System Docker Compose updater for local Unix environments and NAS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="local"
WITH_BACKUP=0
DRY_RUN=0
TIMEOUT_SECONDS=120
HEALTH_URL=""

usage() {
  cat <<'USAGE'
Usage: bash scripts/docker-update.sh [options]

Options:
  --nas                 Back up optionally, sync origin/main, then update Docker
  --backup              Run scripts/nas-backup.sh before NAS source sync
  --dry-run             Print the planned commands without changing anything
  --timeout SECONDS     Health-check timeout (default: 120)
  --health-url URL      Check only the specified health endpoint
  -h, --help            Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --nas) MODE="nas"; shift ;;
    --backup) WITH_BACKUP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --timeout)
      [[ $# -ge 2 && "$2" =~ ^[1-9][0-9]*$ ]] || { echo "--timeout requires a positive integer" >&2; exit 2; }
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --health-url)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--health-url requires a URL" >&2; exit 2; }
      HEALTH_URL="$2"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$MODE" != "nas" && $WITH_BACKUP -eq 1 ]]; then
  echo "--backup can only be used with --nas" >&2
  exit 2
fi

[[ -f "$ROOT/docker-compose.yml" ]] || { echo "docker-compose.yml not found: $ROOT" >&2; exit 1; }
cd "$ROOT"

print_command() {
  printf '  '
  printf '%q ' "$@"
  printf '\n'
}

run() {
  print_command "$@"
  if [[ $DRY_RUN -eq 0 ]]; then
    "$@"
  fi
}

echo "Links-System Docker update"
echo "  mode: $MODE"
echo "  root: $ROOT"
echo "  dry-run: $DRY_RUN"

if [[ $DRY_RUN -eq 0 ]]; then
  command -v docker >/dev/null 2>&1 || { echo "docker command not found" >&2; exit 1; }
  docker compose version >/dev/null
fi

if [[ "$MODE" == "nas" ]]; then
  if [[ $DRY_RUN -eq 0 ]]; then
    command -v git >/dev/null 2>&1 || { echo "git command not found" >&2; exit 1; }
    if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
      echo "NAS update stopped: the working tree has uncommitted changes." >&2
      git status --short >&2
      exit 1
    fi
    git remote get-url origin >/dev/null
  fi

  if [[ $WITH_BACKUP -eq 1 ]]; then
    run "$ROOT/scripts/nas-backup.sh"
  fi
  run git fetch origin
  run git checkout main
  run git pull --ff-only origin main
fi

run docker compose config --quiet
run docker compose up --build -d
run docker compose ps

if [[ -n "$HEALTH_URL" ]]; then
  HEALTH_URLS=("$HEALTH_URL")
else
  HEALTH_URLS=("http://127.0.0.1:8080/api/health" "http://127.0.0.1:3000/api/health")
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "  health: poll ${HEALTH_URLS[*]} until db=up (${TIMEOUT_SECONDS}s)"
  echo "Dry-run completed. No Docker, Git, or database state was changed."
  exit 0
fi

command -v curl >/dev/null 2>&1 || { echo "curl command not found" >&2; exit 1; }
deadline=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  for url in "${HEALTH_URLS[@]}"; do
    response="$(curl --fail --silent --show-error --max-time 5 "$url" 2>/dev/null || true)"
    if grep -Eq '"db"[[:space:]]*:[[:space:]]*"up"' <<<"$response"; then
      echo "Docker update completed: $url reports db=up"
      exit 0
    fi
  done
  sleep 2
done

echo "Docker update failed: health check did not report db=up within ${TIMEOUT_SECONDS}s." >&2
docker compose ps >&2 || true
docker compose logs app --tail 100 >&2 || true
exit 1
