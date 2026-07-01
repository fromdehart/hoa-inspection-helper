#!/usr/bin/env bash
# Run interactive B2 setup on awesomework-vps from your Mac (SSH host: awesomework-vps).
# Secrets are typed into the VPS terminal only — not stored locally or in chat.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_HOST="${B2_SETUP_SSH_HOST:-awesomework-vps}"
REMOTE_DIR="${B2_SETUP_REMOTE_DIR:-/home/mike/one-shots/hoa-inspection-helper/scripts}"

echo "Syncing setup scripts to $SSH_HOST:$REMOTE_DIR ..."
ssh "$SSH_HOST" "mkdir -p $REMOTE_DIR"
scp \
  "$SCRIPT_DIR/setup-b2-backup-interactive.sh" \
  "$SCRIPT_DIR/b2-configure-vps.sh" \
  "$SCRIPT_DIR/setup-b2-backup-vps.sh" \
  "$SCRIPT_DIR/backup-photos-b2.sh" \
  "$SSH_HOST:$REMOTE_DIR/"

echo ""
echo "Starting interactive setup on $SSH_HOST (type credentials when prompted)..."
ssh -t "$SSH_HOST" "chmod +x $REMOTE_DIR/*.sh && bash $REMOTE_DIR/setup-b2-backup-interactive.sh"
