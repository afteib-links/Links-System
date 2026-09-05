---
name: docker-update
description: Safely rebuild and verify Links-System Docker Compose. Use automatically whenever the user says "Docker更新", "Dockerを更新", asks to rebuild/restart/update Docker, or requests an ASUSTOR/QNAP/NAS Docker deployment.
---

# Docker Update

Use the repository-managed updater instead of composing Docker commands manually.

## Select the mode

- If the user only says「Docker更新」or names no environment, update the current workspace only.
  - Windows: `pwsh -NoProfile -File scripts/docker-update.ps1`
  - Linux/macOS: `bash scripts/docker-update.sh`
- Only when the user explicitly names NAS, ASUSTOR, or QNAP, run `bash scripts/docker-update.sh --nas --backup` on that target environment.
- Never infer NAS deployment from a bare Docker update request.

## Execution rules

1. Run the updater from the repository root and do not replace it with ad-hoc commands.
2. Let the tool validate Compose, rebuild, start, and require `/api/health` with `db=up`.
3. If Docker or the requested target is unavailable, stop and report that exact limitation; do not claim the update completed.
4. Report the mode, current commit, container status, and health result.
5. Never add `docker compose down -v`, delete `data/mysql`, or remove a database volume during a normal update.

Use `--dry-run` (PowerShell: `-DryRun`) only when validating the updater itself or when the user explicitly asks to preview without applying changes.
