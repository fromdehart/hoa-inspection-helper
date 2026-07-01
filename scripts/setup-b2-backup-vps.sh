#!/usr/bin/env bash
# One-time VPS setup for B2 photo backup. Run on awesomework-vps as user mike.
#
# Usage (after filling ~/.config/hoa-backup/b2.env from scripts/b2.env.example):
#   bash scripts/setup-b2-backup-vps.sh
#
# Or pass env file path:
#   PHOTOS_BACKUP_ENV_FILE=~/.config/hoa-backup/b2.env bash scripts/setup-b2-backup-vps.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PHOTOS_BACKUP_ENV_FILE:-$HOME/.config/hoa-backup/b2.env}"
INSTALL_BIN="${PHOTOS_BACKUP_INSTALL_BIN:-$HOME/bin/backup-photos-b2.sh}"

echo "=== HOA B2 photo backup — VPS setup ==="

if ! command -v rclone >/dev/null 2>&1; then
  echo "Installing rclone..."
  sudo apt-get update -qq
  sudo apt-get install -y rclone
fi
echo "rclone: $(rclone version | head -1)"

mkdir -p "$HOME/.config/hoa-backup"
chmod 700 "$HOME/.config/hoa-backup"

if [[ ! -f "$ENV_FILE" ]]; then
  echo ""
  echo "Missing $ENV_FILE"
  echo "Copy scripts/b2.env.example and fill in B2_ACCOUNT_ID + B2_APPLICATION_KEY:"
  echo "  mkdir -p ~/.config/hoa-backup"
  echo "  cp $SCRIPT_DIR/b2.env.example ~/.config/hoa-backup/b2.env"
  echo "  chmod 600 ~/.config/hoa-backup/b2.env"
  echo "  \$EDITOR ~/.config/hoa-backup/b2.env"
  exit 1
fi

chmod 600 "$ENV_FILE"
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if [[ -z "${B2_ACCOUNT_ID:-}" || -z "${B2_APPLICATION_KEY:-}" ]]; then
  echo "ERROR: B2_ACCOUNT_ID and B2_APPLICATION_KEY must be set in $ENV_FILE"
  exit 1
fi

RCLONE_REMOTE="${RCLONE_REMOTE:-hoa-b2}"
if rclone listremotes | grep -q "^${RCLONE_REMOTE}:$"; then
  echo "rclone remote $RCLONE_REMOTE already configured"
else
  echo "Creating rclone remote $RCLONE_REMOTE..."
  rclone config create "$RCLONE_REMOTE" b2 \
    account="$B2_ACCOUNT_ID" \
    key="$B2_APPLICATION_KEY" \
    hard_delete=false
fi

mkdir -p "$HOME/bin" "$HOME/backups/photos/logs"
cp "$SCRIPT_DIR/backup-photos-b2.sh" "$INSTALL_BIN"
chmod +x "$INSTALL_BIN"
echo "Installed backup script: $INSTALL_BIN"

CRON_LINE="45 3 * * * $INSTALL_BIN"
if crontab -l 2>/dev/null | grep -qF "$INSTALL_BIN"; then
  echo "Cron entry already present"
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "Added cron: $CRON_LINE"
fi

echo ""
echo "Smoke test (dry-run)..."
rclone copy "${PHOTOS_SOURCE_DIR:-/home/mike/hoa-inspection-upload-data}/" \
  "${RCLONE_REMOTE}:${B2_BUCKET:-hoa-inspection-photos}/" \
  --exclude "_tmp/**" --dry-run -v | tail -5

echo ""
echo "=== Setup complete ==="
echo "Run first backup: $INSTALL_BIN"
echo "Verify: rclone size ${RCLONE_REMOTE}:${B2_BUCKET:-hoa-inspection-photos}"
