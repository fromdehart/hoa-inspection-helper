#!/usr/bin/env bash
set -e
trap 'echo "❌ Script failed. See above for details."' ERR

DRY_RUN=false
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    DRY_RUN=true
    break
  fi
done

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "Usage: $0 <slug> [--dry-run]"
  echo "Example: $0 one-shot-003"
  exit 1
fi

if [[ ! "$SLUG" =~ ^one-shot-[0-9]{3}$ ]]; then
  echo "Slug must be like one-shot-003"
  exit 1
fi

if [ -d "$SLUG" ]; then
  echo "Folder $SLUG already exists."
  exit 1
fi

for cmd in gh vercel node; do
  if ! command -v "$cmd" > /dev/null 2>&1; then
    echo "Missing required command: $cmd. Please install it and try again."
    exit 1
  fi
done

TEMPLATE_URL=""
if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would get origin URL and clone into $SLUG"
else
  TEMPLATE_URL=$(git remote get-url origin 2>/dev/null || true)
  if [ -z "$TEMPLATE_URL" ]; then
    echo "Could not get git remote origin URL. Run from the template repo."
    exit 1
  fi
  git clone "$TEMPLATE_URL" "$SLUG"
  cd "$SLUG"
  rm -rf .git
  git init
  git add .
  git commit -m "Initial commit from template"
  cd ..
fi

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would create GitHub repo and collect keys"
  echo "[DRY RUN] Would run: npm install, convex init/deploy, vercel --yes"
  echo "[DRY RUN] Done."
  exit 0
fi

cd "$SLUG"

gh repo create "$SLUG" --public --source=. --push --description "One Shot — built in one shot."

echo "Opening browser for API keys..."
open_url() {
  if command -v open > /dev/null 2>&1; then
    open "$1"
  elif command -v xdg-open > /dev/null 2>&1; then
    xdg-open "$1"
  fi
}
open_url "https://platform.openai.com/api-keys"
echo "Paste your OpenAI API key (will be sent to Convex only):"
read -s OPENAI_API_KEY
echo
if [ -z "$OPENAI_API_KEY" ]; then
  echo "OPENAI_API_KEY cannot be empty"
  exit 1
fi

open_url "https://resend.com/api-keys"
echo "Paste your Resend API key:"
read -s RESEND_API_KEY
echo
if [ -z "$RESEND_API_KEY" ]; then
  echo "RESEND_API_KEY cannot be empty"
  exit 1
fi
echo "Paste your Resend FROM address (e.g. noreply@yourdomain.com):"
read -r RESEND_FROM
if [ -z "$RESEND_FROM" ]; then
  echo "RESEND_FROM cannot be empty"
  exit 1
fi

open_url "https://dashboard.convex.dev"
echo "Paste your Convex deployment URL (VITE_CONVEX_URL):"
read -r VITE_CONVEX_URL
if [ -z "$VITE_CONVEX_URL" ]; then
  echo "VITE_CONVEX_URL cannot be empty"
  exit 1
fi

# Only client vars in .env; server keys stay in Convex
cat > .env << ENVEOF
VITE_CONVEX_URL=$VITE_CONVEX_URL
VITE_CHALLENGE_ID=$SLUG

# Server-only (already pushed to Convex via npx convex env set)
OPENAI_API_KEY=
RESEND_API_KEY=
RESEND_FROM=
ENVEOF

npx convex env set OPENAI_API_KEY "$OPENAI_API_KEY"
npx convex env set RESEND_API_KEY "$RESEND_API_KEY"
npx convex env set RESEND_FROM "$RESEND_FROM"

npm install

if [ ! -d .convex ] || [ ! -f convex.json ]; then
  npx convex init --once 2>/dev/null || npx convex dev --once 2>/dev/null || true
fi
npx convex deploy

vercel --yes
echo "$VITE_CONVEX_URL" | vercel env add VITE_CONVEX_URL production 2>/dev/null || true
echo "$SLUG" | vercel env add VITE_CHALLENGE_ID production 2>/dev/null || true

DEPLOY_URL=$(vercel ls --token "$(cat .vercel/token 2>/dev/null)" 2>/dev/null | head -2 | tail -1 | awk '{print $2}' || echo "https://$SLUG.vercel.app")
open_url "${DEPLOY_URL:-https://vercel.com}"
if command -v cursor > /dev/null 2>&1; then
  cursor .
else
  open_url "."
fi

echo ""
echo "✅ $SLUG is live."
echo "GitHub:  https://github.com/$(gh repo view --json owner,name -q '.owner.login + "/" + .name')"
echo "Vercel:  $DEPLOY_URL"
echo ""
echo "You're in Cursor. One shot. Make it count."
