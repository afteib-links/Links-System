#!/usr/bin/env bash
# Git追跡中 + Git除外されていない未追跡ファイルから本番用アーカイブを作る。
set -euo pipefail
export PATH="/mingw64/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${1:-}"
[[ -n "$OUTPUT" ]] || { echo "使い方: $0 <出力.tgz>" >&2; exit 2; }
if command -v cygpath >/dev/null 2>&1; then
  OUTPUT="$(cygpath -u "$OUTPUT")"
fi
case "$OUTPUT" in
  "$ROOT"/*) OUTPUT="${OUTPUT#"$ROOT"/}" ;;
esac
mkdir -p "$(dirname "$OUTPUT")"
cd "$ROOT"

STAGING="$(mktemp -d)"
trap 'rm -rf -- "$STAGING"' EXIT

while IFS= read -r -d '' path; do
  case "$path" in
    .env|data/*|backups/*|node_modules/*|tmp/*|.worktrees/*|.codex-worktrees/*|output/*|backend/test-results/*)
      continue
      ;;
  esac
  if [[ -f "$path" || -L "$path" ]]; then
    cp --parents -- "$path" "$STAGING"
  fi
done < <(git -c core.quotepath=false ls-files --cached --others --exclude-standard -z)

# Windowsの作業ツリーがCRLFでも、NASで実行するシェルスクリプトはLFに統一する。
while IFS= read -r -d '' script; do
  sed -i 's/\r$//' "$script"
done < <(find "$STAGING" -type f -name '*.sh' -print0)

find "$STAGING" -mindepth 1 -maxdepth 1 -printf '%f\0' |
  tar -C "$STAGING" --null --files-from=- -czf "$OUTPUT"

[[ -s "$OUTPUT" ]] || { echo "エラー: システムアーカイブが空です。" >&2; exit 1; }
echo "システムアーカイブ作成完了: $OUTPUT"
