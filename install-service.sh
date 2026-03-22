#!/usr/bin/env bash
# =============================================================================
# install-service.sh — Install the One Shot Telegram Bot as a systemd service
# Run as root: sudo bash install-service.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="one-shot-telegram"
ENV_FILE="/home/mike/.env.one-shot"
LOG_FILE="/var/log/one-shot-bot.log"

echo "=== One Shot Bot — Service Installer ==="

# ── Check required env vars exist ─────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo ""
  echo "Creating ${ENV_FILE} — enter your environment variables:"
  echo ""

  read -rp "TELEGRAM_BOT_TOKEN: " TELEGRAM_BOT_TOKEN
  read -rp "TELEGRAM_CHAT_ID:   " TELEGRAM_CHAT_ID
  read -rp "GITHUB_TOKEN:       " GITHUB_TOKEN
  read -rp "OPENAI_API_KEY:     " OPENAI_API_KEY
  read -rp "RESEND_API_KEY:     " RESEND_API_KEY

  cat > "$ENV_FILE" <<EOF
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
GITHUB_TOKEN=${GITHUB_TOKEN}
OPENAI_API_KEY=${OPENAI_API_KEY}
RESEND_API_KEY=${RESEND_API_KEY}
EOF

  chmod 600 "$ENV_FILE"
  chown mike:mike "$ENV_FILE"
  echo "✅ Created ${ENV_FILE}"
else
  echo "✅ Found existing ${ENV_FILE}"
fi

# ── Create log file ──────────────────────────────────────────────────────────
touch "$LOG_FILE"
chmod 664 "$LOG_FILE"
chown mike:mike "$LOG_FILE"
echo "✅ Log file: ${LOG_FILE}"

# ── Create one-shots directory ────────────────────────────────────────────────
mkdir -p /home/mike/one-shots
chown mike:mike /home/mike/one-shots
echo "✅ One-shots directory: /home/mike/one-shots"

# ── Make scripts executable ───────────────────────────────────────────────────
chmod +x "${SCRIPT_DIR}/pipeline.sh"
chmod +x "${SCRIPT_DIR}/telegram-bot.sh"
echo "✅ Scripts are executable"

# ── Install systemd service ───────────────────────────────────────────────────
cp "${SCRIPT_DIR}/one-shot-telegram.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo ""
echo "✅ Service installed and started"
echo ""
echo "Management commands:"
echo "  sudo systemctl status ${SERVICE_NAME}"
echo "  sudo systemctl restart ${SERVICE_NAME}"
echo "  sudo systemctl stop ${SERVICE_NAME}"
echo "  sudo journalctl -u ${SERVICE_NAME} -f"
echo "  tail -f ${LOG_FILE}"
echo ""

# ── Show status ───────────────────────────────────────────────────────────────
sleep 2
systemctl status "${SERVICE_NAME}" --no-pager || true
