#!/usr/bin/env bash
# Nightly-style Convex export: run from cron on a VPS (or manually).
# Defaults target dev deployment glorious-turtle-400; override via env vars.
#
# Env:
#   CONVEX_BACKUP_PROJECT_DIR  — repo root (default: parent of scripts/)
#   CONVEX_BACKUP_DIR          — output directory for snapshot-*.zip (default: $HOME/backups/convex)
#   CONVEX_BACKUP_RETENTION_DAYS — delete snapshot-*.zip older than this (default: 14)
#   CONVEX_BACKUP_DEPLOYMENT_NAME — e.g. glorious-turtle-400 (default: glorious-turtle-400)
#   CONVEX_BACKUP_USE_PROD       — if set to 1, export --prod instead of --deployment-name
#   CONVEX_BACKUP_INCLUDE_FILE_STORAGE — if 1, pass --include-file-storage
#   CONVEX_DEPLOY_KEY            — set in cron Environment or systemd EnvironmentFile for unattended auth
#
# Example crontab (03:15 daily, server local time):
#   15 3 * * * CONVEX_BACKUP_PROJECT_DIR=/var/www/hoa-inspection-helper /var/www/hoa-inspection-helper/scripts/backup-convex.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CONVEX_BACKUP_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_DIR="${CONVEX_BACKUP_DIR:-$HOME/backups/convex}"
RETENTION_DAYS="${CONVEX_BACKUP_RETENTION_DAYS:-14}"
DEPLOYMENT_NAME="${CONVEX_BACKUP_DEPLOYMENT_NAME:-glorious-turtle-400}"
LOG_DIR="${CONVEX_BACKUP_LOG_DIR:-$BACKUP_DIR/logs}"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/backup-$STAMP.log"

exec >>"$LOG" 2>&1
echo "[$STAMP] start project=$PROJECT_DIR backup_dir=$BACKUP_DIR"

cd "$PROJECT_DIR"

if [[ "${CONVEX_BACKUP_USE_PROD:-0}" == "1" ]]; then
  EXPORT_ARGS=(export --prod --path "$BACKUP_DIR/snapshot-$STAMP.zip")
else
  EXPORT_ARGS=(export --deployment-name "$DEPLOYMENT_NAME" --path "$BACKUP_DIR/snapshot-$STAMP.zip")
fi
if [[ "${CONVEX_BACKUP_INCLUDE_FILE_STORAGE:-0}" == "1" ]]; then
  EXPORT_ARGS+=(--include-file-storage)
fi

npx convex "${EXPORT_ARGS[@]}"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'snapshot-*.zip' -mtime "+$RETENTION_DAYS" -delete || true

echo "[$STAMP] done"
