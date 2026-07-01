#!/usr/bin/env bash
# One-time Backblaze B2 provisioning: bucket + restricted application key.
# Requires master application key (create in B2 → Application Keys → Add New Master Key).
#
# Usage:
#   cp scripts/b2-master.env.example ~/.config/hoa-backup/b2-master.env
#   # fill B2_MASTER_ACCOUNT_ID + B2_MASTER_APPLICATION_KEY
#   bash scripts/b2-provision.sh
#
# Writes ~/.config/hoa-backup/b2.env and configures rclone remote hoa-b2.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MASTER_ENV="${B2_MASTER_ENV_FILE:-$HOME/.config/hoa-backup/b2-master.env}"
OUT_ENV="${PHOTOS_BACKUP_ENV_FILE:-$HOME/.config/hoa-backup/b2.env}"
BUCKET_NAME="${B2_BUCKET:-hoa-inspection-photos}"
KEY_NAME="${B2_APP_KEY_NAME:-hoa-vps-backup}"
RCLONE_REMOTE="${RCLONE_REMOTE:-hoa-b2}"

if [[ ! -f "$MASTER_ENV" ]]; then
  echo "Missing $MASTER_ENV — copy scripts/b2-master.env.example and add master key."
  exit 1
fi
# shellcheck disable=SC1090
set -a
source "$MASTER_ENV"
set +a

if [[ -z "${B2_MASTER_ACCOUNT_ID:-}" || -z "${B2_MASTER_APPLICATION_KEY:-}" ]]; then
  echo "B2_MASTER_ACCOUNT_ID and B2_MASTER_APPLICATION_KEY required in $MASTER_ENV"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Installing jq..."
  sudo apt-get update -qq && sudo apt-get install -y jq
fi

echo "Authorizing B2 account..."
AUTH_JSON="$(curl -sf -u "${B2_MASTER_ACCOUNT_ID}:${B2_MASTER_APPLICATION_KEY}" \
  https://api.backblazeb2.com/b2api/v2/b2_authorize_account")"
API_URL="$(echo "$AUTH_JSON" | jq -r .apiUrl)"
AUTH_TOKEN="$(echo "$AUTH_JSON" | jq -r .authorizationToken)"
ACCOUNT_ID="$(echo "$AUTH_JSON" | jq -r .accountId)"

echo "Ensuring bucket: $BUCKET_NAME"
EXISTING="$(curl -sf -H "Authorization: $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"accountId\":\"$ACCOUNT_ID\",\"bucketName\":\"$BUCKET_NAME\"}" \
  "$API_URL/b2api/v2/b2_list_buckets")"

if echo "$EXISTING" | jq -e ".buckets[] | select(.bucketName==\"$BUCKET_NAME\")" >/dev/null 2>&1; then
  BUCKET_ID="$(echo "$EXISTING" | jq -r ".buckets[] | select(.bucketName==\"$BUCKET_NAME\") | .bucketId")"
  echo "Bucket exists: $BUCKET_ID"
else
  CREATE_JSON="$(curl -sf -H "Authorization: $AUTH_TOKEN" \
    "$API_URL/b2api/v2/b2_create_bucket" \
    -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCOUNT_ID\",\"bucketName\":\"$BUCKET_NAME\",\"bucketType\":\"allPrivate\"}")"
  BUCKET_ID="$(echo "$CREATE_JSON" | jq -r .bucketId)"
  echo "Created bucket: $BUCKET_ID"
fi

echo "Creating application key: $KEY_NAME"
KEY_JSON="$(curl -sf -H "Authorization: $AUTH_TOKEN" \
  "$API_URL/b2api/v2/b2_create_key" \
  -H "Content-Type: application/json" \
  -d "{\"keyName\":\"$KEY_NAME\",\"capabilities\":[\"readFiles\",\"writeFiles\",\"listFiles\",\"listBuckets\",\"readBucketEncryption\"],\"bucketId\":\"$BUCKET_ID\"}")"

APP_KEY_ID="$(echo "$KEY_JSON" | jq -r .applicationKeyId)"
APP_KEY="$(echo "$KEY_JSON" | jq -r .applicationKey)"

mkdir -p "$(dirname "$OUT_ENV")"
chmod 700 "$(dirname "$OUT_ENV")"
cat >"$OUT_ENV" <<EOF
B2_ACCOUNT_ID=$APP_KEY_ID
B2_APPLICATION_KEY=$APP_KEY
B2_BUCKET=$BUCKET_NAME
PHOTOS_SOURCE_DIR=/home/mike/hoa-inspection-upload-data
RCLONE_REMOTE=$RCLONE_REMOTE
EOF
chmod 600 "$OUT_ENV"
echo "Wrote $OUT_ENV"

if command -v rclone >/dev/null 2>&1; then
  if rclone listremotes 2>/dev/null | grep -q "^${RCLONE_REMOTE}:$"; then
    rclone config delete "$RCLONE_REMOTE" >/dev/null 2>&1 || true
  fi
  rclone config create "$RCLONE_REMOTE" b2 \
    account="$APP_KEY_ID" \
    key="$APP_KEY" \
    hard_delete=false
  echo "Configured rclone remote: $RCLONE_REMOTE"
fi

echo ""
echo "=== Provisioned ==="
echo "Bucket: $BUCKET_NAME ($BUCKET_ID)"
echo "App key: $APP_KEY_ID"
echo ""
echo "Set daily spend caps manually in Backblaze console:"
echo "  B2 → Caps & Alerts → Storage \$0.05/day, Downloads \$0.01/day"
