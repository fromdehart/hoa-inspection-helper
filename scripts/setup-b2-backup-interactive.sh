#!/usr/bin/env bash
# Interactive B2 backup setup — prompts for credentials (secret hidden), writes
# ~/.config/hoa-backup/b2.env on the VPS, configures rclone, and installs cron.
#
# Run on awesomework-vps:
#   bash scripts/setup-b2-backup-interactive.sh
#
# Or from your Mac (recommended — secrets never touch chat or local disk):
#   npm run setup:photos-backup
#   bash scripts/run-b2-setup-on-vps.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== HOA photo backup — Backblaze B2 setup ==="
echo ""
echo "You need a restricted Application Key from Backblaze (B2 → Application Keys)."
echo "Credentials are saved only on this machine: ~/.config/hoa-backup/b2.env"
echo ""

read -rp "B2 Application Key ID (keyID): " B2_ACCOUNT_ID
if [[ -z "$B2_ACCOUNT_ID" ]]; then
  echo "Key ID cannot be empty."
  exit 1
fi

read -rsp "B2 Application Key (hidden): " B2_APPLICATION_KEY
echo ""
if [[ -z "$B2_APPLICATION_KEY" ]]; then
  echo "Application key cannot be empty."
  exit 1
fi

read -rp "B2 bucket name [hoa-inspection-photos]: " B2_BUCKET
B2_BUCKET="${B2_BUCKET:-hoa-inspection-photos}"

read -rp "Photo folder on this server [/home/mike/hoa-inspection-upload-data]: " PHOTOS_SOURCE_DIR
PHOTOS_SOURCE_DIR="${PHOTOS_SOURCE_DIR:-/home/mike/hoa-inspection-upload-data}"

echo ""
echo "Configuring backup (bucket=$B2_BUCKET, source=$PHOTOS_SOURCE_DIR)..."

export B2_ACCOUNT_ID B2_APPLICATION_KEY B2_BUCKET PHOTOS_SOURCE_DIR
bash "$SCRIPT_DIR/b2-configure-vps.sh"

echo ""
read -rp "Run first backup now? [y/N]: " RUN_NOW
if [[ "${RUN_NOW,,}" == "y" || "${RUN_NOW,,}" == "yes" ]]; then
  echo "Running first backup..."
  bash "$HOME/bin/backup-photos-b2.sh"
  echo ""
  echo "Latest log:"
  ls -t "$HOME/backups/photos/logs/" 2>/dev/null | head -1 | xargs -I{} tail -20 "$HOME/backups/photos/logs/{}"
fi

echo ""
echo "Done. Nightly backup runs at 03:45 via cron."
echo "Manual backup: $HOME/bin/backup-photos-b2.sh"
