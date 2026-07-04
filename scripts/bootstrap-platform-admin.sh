#!/usr/bin/env bash
# One-shot platform admin bootstrap — no secrets in chat.
# - Generates PLATFORM_BOOTSTRAP_SECRET if missing (writes to .env.local + Convex)
# - Resolves your Clerk user ID from email (PLATFORM_ADMIN_EMAIL or first Clerk user match)
# - Calls api.platform.bootstrapPlatformAdmin
#
# Usage:
#   bash scripts/bootstrap-platform-admin.sh
#   PLATFORM_ADMIN_EMAIL=you@example.com bash scripts/bootstrap-platform-admin.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.local"

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing $ENV_FILE"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

append_env_if_missing() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  if [[ -n "$(tail -c 1 "$ENV_FILE" 2>/dev/null || true)" ]]; then
    echo "" >>"$ENV_FILE"
  fi
  echo "${key}=${val}" >>"$ENV_FILE"
  echo "Appended ${key} to .env.local"
}

load_env

CONVEX_URL="${VITE_CONVEX_URL:-${CONVEX_URL:-}}"
if [[ -z "$CONVEX_URL" ]]; then
  echo "Set VITE_CONVEX_URL in .env.local"
  exit 1
fi

if [[ -z "${CLERK_SECRET_KEY:-}" ]]; then
  echo "Set CLERK_SECRET_KEY in .env.local"
  exit 1
fi

if [[ -z "${PLATFORM_BOOTSTRAP_SECRET:-}" ]]; then
  PLATFORM_BOOTSTRAP_SECRET="$(openssl rand -hex 24)"
  append_env_if_missing "PLATFORM_BOOTSTRAP_SECRET" "$PLATFORM_BOOTSTRAP_SECRET"
  export PLATFORM_BOOTSTRAP_SECRET
  echo "Setting PLATFORM_BOOTSTRAP_SECRET on Convex deployment..."
  (cd "$PROJECT_DIR" && npx convex env set PLATFORM_BOOTSTRAP_SECRET "$PLATFORM_BOOTSTRAP_SECRET")
else
  echo "Using existing PLATFORM_BOOTSTRAP_SECRET from .env.local"
  echo "Syncing PLATFORM_BOOTSTRAP_SECRET to Convex..."
  (cd "$PROJECT_DIR" && npx convex env set PLATFORM_BOOTSTRAP_SECRET "$PLATFORM_BOOTSTRAP_SECRET")
fi

ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-mdehart1@gmail.com}"
echo "Looking up Clerk user for: $ADMIN_EMAIL"

CLERK_JSON="$(curl -sf -G "https://api.clerk.com/v1/users" \
  --data-urlencode "email_address[]=$ADMIN_EMAIL" \
  --data-urlencode "limit=1" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY")"

CLERK_USER_ID="$(node -e "
const j = JSON.parse(process.argv[1]);
const u = j[0];
if (!u?.id) process.exit(1);
console.log(u.id);
" "$CLERK_JSON")"

CLERK_NAME="$(node -e "
const j = JSON.parse(process.argv[1]);
const u = j[0];
const n = [u?.first_name, u?.last_name].filter(Boolean).join(' ');
console.log(n || '');
" "$CLERK_JSON")"

echo "Found Clerk user: $CLERK_USER_ID"
echo "Running bootstrap mutation..."

cd "$PROJECT_DIR"
npx tsx scripts/seed-platform-admin.ts "$CLERK_USER_ID" "$ADMIN_EMAIL" "$CLERK_NAME"

echo ""
echo "Done. Sign in and visit: /platform/hoas"
