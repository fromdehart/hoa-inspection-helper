#!/usr/bin/env bash
# Configure rclone remote for Convex B2 bucket (hoa-b2-convex).
# Sources ~/.config/hoa-backup/b2.env or uses env vars.
set -euo pipefail

ENV_FILE="${B2_ENV_FILE:-${PHOTOS_BACKUP_ENV_FILE:-$HOME/.config/hoa-backup/b2.env}}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

B2_CONVEX_BUCKET="${B2_CONVEX_BUCKET:-hoa-convex-backups}"
B2_CONVEX_ACCOUNT_ID="${B2_CONVEX_ACCOUNT_ID:-${B2_ACCOUNT_ID:-}}"
B2_CONVEX_APPLICATION_KEY="${B2_CONVEX_APPLICATION_KEY:-${B2_APPLICATION_KEY:-}}"
RCLONE_CONVEX_REMOTE="${RCLONE_CONVEX_REMOTE:-hoa-b2-convex}"

if [[ -z "$B2_CONVEX_ACCOUNT_ID" || -z "$B2_CONVEX_APPLICATION_KEY" ]]; then
  echo "ERROR: B2_CONVEX_ACCOUNT_ID and B2_CONVEX_APPLICATION_KEY required (or B2_ACCOUNT_ID fallback)"
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y rclone
fi

if rclone listremotes 2>/dev/null | grep -q "^${RCLONE_CONVEX_REMOTE}:$"; then
  rclone config delete "$RCLONE_CONVEX_REMOTE" >/dev/null 2>&1 || true
fi

rclone config create "$RCLONE_CONVEX_REMOTE" b2 \
  account="$B2_CONVEX_ACCOUNT_ID" \
  key="$B2_CONVEX_APPLICATION_KEY" \
  hard_delete=false

echo "Configured rclone remote: $RCLONE_CONVEX_REMOTE → $B2_CONVEX_BUCKET"
rclone lsd "${RCLONE_CONVEX_REMOTE}:${B2_CONVEX_BUCKET}" 2>/dev/null || rclone lsd "${RCLONE_CONVEX_REMOTE}:" || true
