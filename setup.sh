#!/usr/bin/env bash
set -e
trap 'echo "❌ Script failed. See above for details."' ERR

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
  else
    echo "No .env.example found. Create .env manually with required keys."
    exit 1
  fi
fi

echo "Enter VITE_CONVEX_URL (from Convex dashboard):"
read -r VITE_CONVEX_URL
if [ -z "$VITE_CONVEX_URL" ]; then
  echo "VITE_CONVEX_URL cannot be empty"
  exit 1
fi

echo "Enter VITE_CHALLENGE_ID (optional, e.g. one-shot-template):"
read -r VITE_CHALLENGE_ID

echo "Enter OPENAI_API_KEY (will be pushed to Convex):"
read -s OPENAI_API_KEY
echo
if [ -z "$OPENAI_API_KEY" ]; then
  echo "OPENAI_API_KEY cannot be empty"
  exit 1
fi

echo "Enter RESEND_API_KEY (will be pushed to Convex):"
read -s RESEND_API_KEY
echo
if [ -z "$RESEND_API_KEY" ]; then
  echo "RESEND_API_KEY cannot be empty"
  exit 1
fi

echo "Enter RESEND_FROM (sender email, e.g. noreply@yourdomain.com):"
read -r RESEND_FROM
if [ -z "$RESEND_FROM" ]; then
  echo "RESEND_FROM cannot be empty"
  exit 1
fi

# Write client env to .env
if [ -n "$VITE_CHALLENGE_ID" ]; then
  sed -i.bak "s|VITE_CONVEX_URL=.*|VITE_CONVEX_URL=$VITE_CONVEX_URL|" .env 2>/dev/null || true
  sed -i.bak "s|VITE_CHALLENGE_ID=.*|VITE_CHALLENGE_ID=$VITE_CHALLENGE_ID|" .env 2>/dev/null || true
else
  sed -i.bak "s|VITE_CONVEX_URL=.*|VITE_CONVEX_URL=$VITE_CONVEX_URL|" .env 2>/dev/null || true
fi
# Write only client vars to .env (server keys stay in Convex)
cat > .env << ENVEOF
# Client (for Vite / .env and Vercel)
VITE_CONVEX_URL=$VITE_CONVEX_URL
VITE_CHALLENGE_ID=${VITE_CHALLENGE_ID:-one-shot-template}

# Server-only (push to Convex via npx convex env set)
OPENAI_API_KEY=
RESEND_API_KEY=
RESEND_FROM=
ENVEOF

echo "Pushing server keys to Convex..."
npx convex env set OPENAI_API_KEY "$OPENAI_API_KEY" 2>/dev/null || true
npx convex env set RESEND_API_KEY "$RESEND_API_KEY" 2>/dev/null || true
npx convex env set RESEND_FROM "$RESEND_FROM" 2>/dev/null || true

npm install

echo ""
echo "Run in two terminals:"
echo "  npx convex dev"
echo "  npm run dev"
echo ""
echo "You're ready. One shot. Make it count."
