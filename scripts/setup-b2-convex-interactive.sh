#!/usr/bin/env bash
# Interactive setup for Convex DB exports to a separate B2 bucket.
# Merges into ~/.config/hoa-backup/b2.env and configures hoa-b2-convex remote.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${B2_ENV_FILE:-$HOME/.config/hoa-backup/b2.env}"

echo "=== HOA Convex backup — Backblaze B2 setup ==="
echo ""
echo "Create bucket hoa-convex-backups + restricted Application Key in Backblaze first."
echo ""

read -rp "Convex B2 Application Key ID (keyID): " B2_CONVEX_ACCOUNT_ID
if [[ -z "$B2_CONVEX_ACCOUNT_ID" ]]; then
  echo "Key ID cannot be empty."
  exit 1
fi

read -rsp "Convex B2 Application Key (hidden): " B2_CONVEX_APPLICATION_KEY
echo ""
if [[ -z "$B2_CONVEX_APPLICATION_KEY" ]]; then
  echo "Application key cannot be empty."
  exit 1
fi

read -rp "Convex B2 bucket name [hoa-convex-backups]: " B2_CONVEX_BUCKET
B2_CONVEX_BUCKET="${B2_CONVEX_BUCKET:-hoa-convex-backups}"

read -rp "B2 retention days for Convex zips [30]: " CONVEX_B2_RETENTION_DAYS
CONVEX_B2_RETENTION_DAYS="${CONVEX_B2_RETENTION_DAYS:-30}"

mkdir -p "$(dirname "$ENV_FILE")"
chmod 700 "$(dirname "$ENV_FILE")"

# Preserve existing photo vars
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

export B2_CONVEX_ACCOUNT_ID B2_CONVEX_APPLICATION_KEY B2_CONVEX_BUCKET CONVEX_B2_RETENTION_DAYS
RCLONE_CONVEX_REMOTE="${RCLONE_CONVEX_REMOTE:-hoa-b2-convex}"

{
  echo "# HOA backup secrets — $(date -Iseconds)"
  [[ -n "${B2_ACCOUNT_ID:-}" ]] && echo "B2_ACCOUNT_ID=$B2_ACCOUNT_ID"
  [[ -n "${B2_APPLICATION_KEY:-}" ]] && echo "B2_APPLICATION_KEY=$B2_APPLICATION_KEY"
  echo "B2_BUCKET=${B2_BUCKET:-hoa-inspection-photos}"
  echo "PHOTOS_SOURCE_DIR=${PHOTOS_SOURCE_DIR:-/home/mike/hoa-inspection-upload-data}"
  echo "RCLONE_REMOTE=${RCLONE_REMOTE:-hoa-b2}"
  echo "B2_CONVEX_BUCKET=$B2_CONVEX_BUCKET"
  echo "B2_CONVEX_ACCOUNT_ID=$B2_CONVEX_ACCOUNT_ID"
  echo "B2_CONVEX_APPLICATION_KEY=$B2_CONVEX_APPLICATION_KEY"
  echo "RCLONE_CONVEX_REMOTE=$RCLONE_CONVEX_REMOTE"
  echo "CONVEX_B2_RETENTION_DAYS=$CONVEX_B2_RETENTION_DAYS"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Updated $ENV_FILE"

export B2_ENV_FILE="$ENV_FILE"
bash "$SCRIPT_DIR/b2-configure-convex-remote.sh"

echo ""
read -rp "Run Convex backup now (export + upload)? [y/N]: " RUN_NOW
if [[ "${RUN_NOW,,}" == "y" || "${RUN_NOW,,}" == "yes" ]]; then
  bash "$SCRIPT_DIR/backup-convex.sh"
  echo ""
  echo "Latest log:"
  ls -t "${CONVEX_BACKUP_LOG_DIR:-$HOME/one-shots/hoa-inspection-helper/backups/convex/logs}/" 2>/dev/null | head -1 | xargs -I{} tail -25 "{}" 2>/dev/null || true
fi

echo ""
echo "Done. Convex exports upload during nightly backup-convex.sh (03:15 cron)."
