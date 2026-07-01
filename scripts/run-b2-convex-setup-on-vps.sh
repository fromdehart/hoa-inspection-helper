#!/usr/bin/env bash
# Run interactive Convex B2 setup on awesomework-vps from your Mac.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_HOST="${B2_SETUP_SSH_HOST:-awesomework-vps}"
REMOTE_DIR="${B2_SETUP_REMOTE_DIR:-/home/mike/one-shots/hoa-inspection-helper/scripts}"

echo "Syncing scripts to $SSH_HOST:$REMOTE_DIR ..."
ssh "$SSH_HOST" "mkdir -p $REMOTE_DIR"
scp \
  "$SCRIPT_DIR/setup-b2-convex-interactive.sh" \
  "$SCRIPT_DIR/b2-configure-convex-remote.sh" \
  "$SCRIPT_DIR/backup-convex.sh" \
  "$SCRIPT_DIR/b2.env.example" \
  "$SSH_HOST:$REMOTE_DIR/"

echo ""
echo "Starting Convex B2 setup on $SSH_HOST..."
ssh -t "$SSH_HOST" "chmod +x $REMOTE_DIR/setup-b2-convex-interactive.sh $REMOTE_DIR/b2-configure-convex-remote.sh $REMOTE_DIR/backup-convex.sh && bash $REMOTE_DIR/setup-b2-convex-interactive.sh"
