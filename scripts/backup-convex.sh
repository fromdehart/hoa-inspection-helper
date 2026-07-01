#!/usr/bin/env bash
# Nightly-style Convex export: run from cron on a VPS (or manually).
# Defaults target dev deployment glorious-turtle-400; override via env vars.
#
# Env:
#   CONVEX_BACKUP_PROJECT_DIR  — repo root (default: parent of scripts/)
#   CONVEX_BACKUP_DIR          — output directory for snapshot-*.zip (default: <project>/backups/convex)
#   CONVEX_BACKUP_RETENTION_DAYS — delete local snapshot-*.zip older than this (default: 14)
#   CONVEX_BACKUP_DEPLOYMENT_NAME — e.g. glorious-turtle-400 (default: glorious-turtle-400)
#   CONVEX_BACKUP_USE_PROD       — if set to 1, export --prod instead of --deployment-name
#   CONVEX_BACKUP_INCLUDE_FILE_STORAGE — if 1, pass --include-file-storage
#   CONVEX_DEPLOY_KEY            — set in cron Environment or systemd EnvironmentFile for unattended auth
#
# B2 upload (optional — set in ~/.config/hoa-backup/b2.env):
#   B2_ENV_FILE                  — default ~/.config/hoa-backup/b2.env
#   B2_CONVEX_BUCKET             — e.g. hoa-convex-backups (unset = skip B2)
#   B2_CONVEX_ACCOUNT_ID         — falls back to B2_ACCOUNT_ID
#   B2_CONVEX_APPLICATION_KEY    — falls back to B2_APPLICATION_KEY
#   RCLONE_CONVEX_REMOTE           — default hoa-b2-convex
#   CONVEX_B2_RETENTION_DAYS       — delete B2 zips older than this (default: 30)
#
# Example crontab (03:15 daily, server local time):
#   15 3 * * * /home/mike/one-shots/hoa-inspection-helper/scripts/backup-convex.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CONVEX_BACKUP_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
BACKUP_DIR="${CONVEX_BACKUP_DIR:-$PROJECT_DIR/backups/convex}"
RETENTION_DAYS="${CONVEX_BACKUP_RETENTION_DAYS:-14}"
DEPLOYMENT_NAME="${CONVEX_BACKUP_DEPLOYMENT_NAME:-glorious-turtle-400}"
LOG_DIR="${CONVEX_BACKUP_LOG_DIR:-$BACKUP_DIR/logs}"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/backup-$STAMP.log"
SNAPSHOT_PATH="$BACKUP_DIR/snapshot-$STAMP.zip"

exec >>"$LOG" 2>&1
echo "[$STAMP] start project=$PROJECT_DIR backup_dir=$BACKUP_DIR"

cd "$PROJECT_DIR"

if [[ "${CONVEX_BACKUP_USE_PROD:-0}" == "1" ]]; then
  EXPORT_ARGS=(export --prod --path "$SNAPSHOT_PATH")
else
  EXPORT_ARGS=(export --deployment-name "$DEPLOYMENT_NAME" --path "$SNAPSHOT_PATH")
fi
if [[ "${CONVEX_BACKUP_INCLUDE_FILE_STORAGE:-0}" == "1" ]]; then
  EXPORT_ARGS+=(--include-file-storage)
fi

npx convex "${EXPORT_ARGS[@]}"

upload_convex_to_b2() {
  local b2_env_file="${B2_ENV_FILE:-$HOME/.config/hoa-backup/b2.env}"
  if [[ ! -f "$b2_env_file" ]]; then
    echo "[$STAMP] B2 convex upload skipped (no $b2_env_file)"
    return 0
  fi
  # shellcheck disable=SC1090
  set -a
  source "$b2_env_file"
  set +a

  if [[ -z "${B2_CONVEX_BUCKET:-}" ]]; then
    echo "[$STAMP] B2 convex upload skipped (B2_CONVEX_BUCKET unset)"
    return 0
  fi

  if ! command -v rclone >/dev/null 2>&1; then
    echo "[$STAMP] WARN: rclone not found; skipping B2 convex upload"
    return 0
  fi

  local remote="${RCLONE_CONVEX_REMOTE:-hoa-b2-convex}"
  local retention="${CONVEX_B2_RETENTION_DAYS:-30}"
  local dest="${remote}:${B2_CONVEX_BUCKET}/${DEPLOYMENT_NAME}/"

  if ! rclone listremotes 2>/dev/null | grep -q "^${remote}:$"; then
    echo "[$STAMP] WARN: rclone remote ${remote} not configured; skipping B2 convex upload"
    return 0
  fi

  if [[ ! -f "$SNAPSHOT_PATH" ]]; then
    echo "[$STAMP] ERROR: snapshot missing after export: $SNAPSHOT_PATH"
    return 1
  fi

  echo "[$STAMP] uploading to B2: $dest"
  rclone copy "$SNAPSHOT_PATH" "$dest" --log-level INFO

  echo "[$STAMP] pruning B2 zips older than ${retention}d in $dest"
  rclone delete "$dest" --min-age "${retention}d" --include "snapshot-*.zip" --log-level INFO || true

  rclone ls "$dest" 2>/dev/null | tail -3 || true
  echo "[$STAMP] B2 convex upload done"
}

upload_convex_to_b2

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'snapshot-*.zip' -mtime "+$RETENTION_DAYS" -delete || true

echo "[$STAMP] done"
