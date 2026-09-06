#!/usr/bin/env bash
# Compatibility entry point. The canonical implementation is docker-update.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/docker-update.sh" --nas "$@"
