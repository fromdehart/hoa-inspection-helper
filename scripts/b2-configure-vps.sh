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

# Preserve convex vars from existing env when re-running photo setup
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

mkdir -p "$(dirname "$ENV_FILE")"
chmod 700 "$(dirname "$ENV_FILE")"
{
  echo "B2_ACCOUNT_ID=$B2_ACCOUNT_ID"
  echo "B2_APPLICATION_KEY=$B2_APPLICATION_KEY"
  echo "B2_BUCKET=$B2_BUCKET"
  echo "PHOTOS_SOURCE_DIR=$PHOTOS_SOURCE_DIR"
  echo "RCLONE_REMOTE=$RCLONE_REMOTE"
  [[ -n "${B2_CONVEX_BUCKET:-}" ]] && echo "B2_CONVEX_BUCKET=$B2_CONVEX_BUCKET"
  [[ -n "${B2_CONVEX_ACCOUNT_ID:-}" ]] && echo "B2_CONVEX_ACCOUNT_ID=$B2_CONVEX_ACCOUNT_ID"
  [[ -n "${B2_CONVEX_APPLICATION_KEY:-}" ]] && echo "B2_CONVEX_APPLICATION_KEY=$B2_CONVEX_APPLICATION_KEY"
  [[ -n "${RCLONE_CONVEX_REMOTE:-}" ]] && echo "RCLONE_CONVEX_REMOTE=$RCLONE_CONVEX_REMOTE"
  [[ -n "${CONVEX_B2_RETENTION_DAYS:-}" ]] && echo "CONVEX_B2_RETENTION_DAYS=$CONVEX_B2_RETENTION_DAYS"
} >"$ENV_FILE"
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

if [[ -n "${B2_CONVEX_BUCKET:-}" && -n "${B2_CONVEX_ACCOUNT_ID:-}" && -n "${B2_CONVEX_APPLICATION_KEY:-}" ]]; then
  export B2_ENV_FILE="$ENV_FILE"
  bash "$SCRIPT_DIR/b2-configure-convex-remote.sh" || echo "WARN: convex remote setup failed"
fi

bash "$SCRIPT_DIR/setup-b2-backup-vps.sh"
