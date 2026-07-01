#!/usr/bin/env bash
# Configure B2 restricted key on VPS (when bucket + key already exist in Backblaze console).
# Usage: B2_ACCOUNT_ID=... B2_APPLICATION_KEY=... bash scripts/b2-configure-vps.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PHOTOS_BACKUP_ENV_FILE:-$HOME/.config/hoa-backup/b2.env}"

B2_ACCOUNT_ID="${B2_ACCOUNT_ID:?B2_ACCOUNT_ID required}"
B2_APPLICATION_KEY="${B2_APPLICATION_KEY:?B2_APPLICATION_KEY required}"
B2_BUCKET="${B2_BUCKET:-hoa-inspection-photos}"
RCLONE_REMOTE="${RCLONE_REMOTE:-hoa-b2}"
PHOTOS_SOURCE_DIR="${PHOTOS_SOURCE_DIR:-/home/mike/hoa-inspection-upload-data}"

mkdir -p "$(dirname "$ENV_FILE")"
chmod 700 "$(dirname "$ENV_FILE")"
cat >"$ENV_FILE" <<EOF
B2_ACCOUNT_ID=$B2_ACCOUNT_ID
B2_APPLICATION_KEY=$B2_APPLICATION_KEY
B2_BUCKET=$B2_BUCKET
PHOTOS_SOURCE_DIR=$PHOTOS_SOURCE_DIR
RCLONE_REMOTE=$RCLONE_REMOTE
EOF
chmod 600 "$ENV_FILE"
echo "Wrote $ENV_FILE"

if ! command -v rclone >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y rclone
fi

if rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:$"; then
  rclone config delete "$RCLONE_REMOTE" >/dev/null 2>&1 || true
fi
rclone config create "$RCLONE_REMOTE" b2 \
  account="$B2_ACCOUNT_ID" \
  key="$B2_APPLICATION_KEY" \
  hard_delete=false

echo "Configured rclone remote: $RCLONE_REMOTE"
rclone lsd "${RCLONE_REMOTE}:" || true

bash "$SCRIPT_DIR/setup-b2-backup-vps.sh"
