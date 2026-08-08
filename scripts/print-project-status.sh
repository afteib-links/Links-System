#!/usr/bin/env bash
# 作業開始時の現状を一行ずつ表示（Cursor / Antigravity 共通）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../" && pwd)"
cd "$ROOT"

echo "=== Links-System status ==="
echo "time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "cwd: $ROOT"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git fetch origin 2>/dev/null || true
  echo "branch: $(git branch --show-current)"
  echo "status: $(git status -sb | head -1)"
  if git rev-parse origin/main >/dev/null 2>&1; then
    echo "origin/main: $(git log origin/main -1 --format='%h %s')"
  fi
  echo "remote branches:"
  git branch -r | sed 's/^/  /'
else
  echo "not a git repo"
fi

MIG_DIR="$ROOT/db/migrations"
if [[ -d "$MIG_DIR" ]]; then
  count=$(ls -1 "$MIG_DIR"/*.sql 2>/dev/null | wc -l)
  echo "migrations: ${count} files in db/migrations/"
  ls -1 "$MIG_DIR"/*.sql 2>/dev/null | tail -3 | sed 's/^/  last: /'
fi

if command -v gh >/dev/null 2>&1; then
  echo "open PRs:"
  gh pr list --state open --limit 10 2>/dev/null | sed 's/^/  /' || echo "  (gh failed)"
fi

echo "read first: AGENTS.md, 仕様MD/00_現状スナップショット.md"
echo "=== end ==="
