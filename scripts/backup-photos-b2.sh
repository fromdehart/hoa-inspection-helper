#!/usr/bin/env bash
# Nightly HOA inspection photo backup to Backblaze B2 (archive mode: copy only).
# Run from cron on awesomework-vps or manually.
#
# Prerequisites:
#   - rclone installed with remote configured (see scripts/b2.env.example)
#   - ~/.config/hoa-backup/b2.env with B2_ACCOUNT_ID, B2_APPLICATION_KEY, B2_BUCKET
#
# Env (set in ~/.config/hoa-backup/b2.env or exported):
#   PHOTOS_BACKUP_ENV_FILE     — path to secrets file (default: ~/.config/hoa-backup/b2.env)
#   PHOTOS_SOURCE_DIR          — VPS photo root (default: /home/mike/hoa-inspection-upload-data)
#   PHOTOS_BACKUP_LOG_DIR      — log directory (default: ~/backups/photos/logs)
#   PHOTOS_BACKUP_MAX_SOURCE_GB — optional; abort if source exceeds this many GB
#   RCLONE_REMOTE              — rclone remote name (default: hoa-b2)
#   B2_BUCKET                  — bucket name (default: hoa-inspection-photos)
#
# Example crontab (03:45 daily, after Convex backup at 03:15):
#   45 3 * * * /home/mike/bin/backup-photos-b2.sh
set -euo pipefail

ENV_FILE="${PHOTOS_BACKUP_ENV_FILE:-$HOME/.config/hoa-backup/b2.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

PHOTOS_SOURCE_DIR="${PHOTOS_SOURCE_DIR:-/home/mike/hoa-inspection-upload-data}"
LOG_DIR="${PHOTOS_BACKUP_LOG_DIR:-$HOME/backups/photos/logs}"
RCLONE_REMOTE="${RCLONE_REMOTE:-hoa-b2}"
B2_BUCKET="${B2_BUCKET:-hoa-inspection-photos}"
MAX_SOURCE_GB="${PHOTOS_BACKUP_MAX_SOURCE_GB:-}"

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/backup-$STAMP.log"

exec >>"$LOG" 2>&1
echo "[$STAMP] start source=$PHOTOS_SOURCE_DIR remote=${RCLONE_REMOTE}:${B2_BUCKET}"

if ! command -v rclone >/dev/null 2>&1; then
  echo "[$STAMP] ERROR: rclone not found in PATH"
  exit 1
fi

if [[ -z "${B2_ACCOUNT_ID:-}" || -z "${B2_APPLICATION_KEY:-}" ]]; then
  echo "[$STAMP] ERROR: B2_ACCOUNT_ID and B2_APPLICATION_KEY required (see $ENV_FILE)"
  exit 1
fi

if [[ ! -d "$PHOTOS_SOURCE_DIR" ]]; then
  echo "[$STAMP] ERROR: source directory does not exist: $PHOTOS_SOURCE_DIR"
  exit 1
fi

if [[ -n "$MAX_SOURCE_GB" ]]; then
  SOURCE_KB="$(du -sk "$PHOTOS_SOURCE_DIR" | cut -f1)"
  MAX_KB=$((MAX_SOURCE_GB * 1024 * 1024))
  if [[ "$SOURCE_KB" -gt "$MAX_KB" ]]; then
    echo "[$STAMP] ERROR: source size ${SOURCE_KB}KB exceeds limit ${MAX_KB}KB (${MAX_SOURCE_GB}GB)"
    exit 1
  fi
fi

DEST="${RCLONE_REMOTE}:${B2_BUCKET}/"

rclone copy "$PHOTOS_SOURCE_DIR/" "$DEST" \
  --exclude "_tmp/**" \
  --transfers 4 \
  --log-level INFO

echo "[$STAMP] local size: $(du -sh "$PHOTOS_SOURCE_DIR" | cut -f1)"
rclone size "$DEST" || true
echo "[$STAMP] done"
