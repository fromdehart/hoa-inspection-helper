#!/usr/bin/env bash
# =============================================================================
# init-pipeline.sh — One Shot Pipeline Initialization
#
# Run once to configure all required secrets and verify service auth.
# Secrets are stored in ~/.env.one-shot (chmod 600, never committed to git).
#
# Usage: bash init-pipeline.sh
# =============================================================================
set -euo pipefail

readonly ENV_FILE="${HOME}/.env.one-shot"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CLAUDE_BIN="${HOME}/.local/bin/claude"
readonly ONE_SHOTS_DIR="${HOME}/one-shots"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()    { echo -e "${GREEN}  ✅ $*${RESET}"; }
fail()  { echo -e "${RED}  ❌ $*${RESET}"; }
warn()  { echo -e "${YELLOW}  ⚠️  $*${RESET}"; }
info()  { echo -e "${CYAN}  ℹ  $*${RESET}"; }
header(){ echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

# Load existing env file if present
load_existing() {
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
    info "Loaded existing values from ${ENV_FILE}"
  fi
}

# Prompt for a secret, showing masked current value if set
prompt_secret() {
  local var_name="$1"
  local label="$2"
  local current="${!var_name:-}"

  if [[ -n "$current" ]]; then
    local masked="${current:0:8}...${current: -4}"
    echo -e "  ${BOLD}${label}${RESET} (current: ${masked})" >&2
    read -rp "  Press Enter to keep, or paste new value: " new_val
    if [[ -z "$new_val" ]]; then
      echo "$current"
    else
      echo "$new_val"
    fi
  else
    read -rsp "  ${BOLD}${label}${RESET}: " new_val
    echo "" >&2
    echo "$new_val"
  fi
}

# Prompt for a non-secret value
prompt_value() {
  local var_name="$1"
  local label="$2"
  local current="${!var_name:-}"

  if [[ -n "$current" ]]; then
    echo -e "  ${BOLD}${label}${RESET} (current: ${current})" >&2
    read -rp "  Press Enter to keep, or type new value: " new_val
    if [[ -z "$new_val" ]]; then
      echo "$current"
    else
      echo "$new_val"
    fi
  else
    read -rp "  ${BOLD}${label}${RESET}: " new_val
    echo "$new_val"
  fi
}

# Write the env file atomically
write_env_file() {
  local tmp; tmp="$(mktemp)"
  cat > "$tmp" <<EOF
# One Shot Pipeline — Environment Secrets
# Generated: $(date)
# DO NOT COMMIT THIS FILE

TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
GITHUB_TOKEN=${GITHUB_TOKEN:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
RESEND_API_KEY=${RESEND_API_KEY:-}
EOF
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# =============================================================================
# VALIDATORS
# =============================================================================

validate_telegram_token() {
  local token="$1"
  local response
  response="$(curl -sf "https://api.telegram.org/bot${token}/getMe" 2>/dev/null || echo '{}')"
  local username
  username="$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('username',''))" 2>/dev/null || echo "")"
  if [[ -n "$username" ]]; then
    ok "Telegram bot token valid — @${username}"
    return 0
  else
    fail "Telegram bot token invalid or network error"
    return 1
  fi
}

validate_telegram_chat() {
  local token="$1"
  local chat_id="$2"
  local response
  response="$(curl -sf -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=✅ One Shot pipeline initialized!" \
    2>/dev/null || echo '{}')"
  local ok_val
  ok_val="$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok',False))" 2>/dev/null || echo "False")"
  if [[ "$ok_val" == "True" ]]; then
    ok "Telegram chat ID valid — message sent"
    return 0
  else
    local err
    err="$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('description','unknown'))" 2>/dev/null || echo "unknown")"
    fail "Telegram chat ID invalid: ${err}"
    return 1
  fi
}

validate_github_token() {
  local token="$1"
  local response
  response="$(curl -sf -H "Authorization: token ${token}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/user" 2>/dev/null || echo '{}')"
  local login
  login="$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('login',''))" 2>/dev/null || echo "")"
  if [[ -n "$login" ]]; then
    ok "GitHub token valid — logged in as ${login}"
    return 0
  else
    fail "GitHub token invalid or insufficient permissions"
    return 1
  fi
}

validate_openai_key() {
  local key="$1"
  local status
  status="$(curl -sf -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${key}" \
    "https://api.openai.com/v1/models" 2>/dev/null || echo "000")"
  if [[ "$status" == "200" ]]; then
    ok "OpenAI API key valid"
    return 0
  elif [[ "$status" == "401" ]]; then
    fail "OpenAI API key invalid (401 unauthorized)"
    return 1
  else
    warn "OpenAI API key check returned HTTP ${status} — may still be valid"
    return 0
  fi
}

validate_resend_key() {
  local key="$1"
  local status
  status="$(curl -sf -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${key}" \
    "https://api.resend.com/domains" 2>/dev/null || echo "000")"
  if [[ "$status" == "200" ]]; then
    ok "Resend API key valid"
    return 0
  elif [[ "$status" == "401" ]]; then
    fail "Resend API key invalid (401 unauthorized)"
    return 1
  else
    warn "Resend API key check returned HTTP ${status} — may still be valid"
    return 0
  fi
}

# =============================================================================
# CLI AUTH CHECKS
# =============================================================================

check_gh_auth() {
  header "GitHub CLI (gh)"
  if ! command -v gh &>/dev/null; then
    fail "gh CLI not found — install: https://cli.github.com"
    return 1
  fi

  if gh auth status &>/dev/null; then
    local user; user="$(gh api user --jq .login 2>/dev/null || echo "unknown")"
    ok "gh CLI authenticated as: ${user}"
  else
    warn "gh CLI not authenticated"
    echo ""
    read -rp "  Run 'gh auth login' now? (y/n): " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      gh auth login
    else
      warn "Skipping — gh must be authenticated before running the pipeline"
    fi
  fi
}

check_vercel_auth() {
  header "Vercel CLI"
  if ! command -v vercel &>/dev/null && ! npx vercel --version &>/dev/null 2>&1; then
    fail "vercel CLI not found — install: npm i -g vercel"
    return 1
  fi

  local vercel_cmd="vercel"
  command -v vercel &>/dev/null || vercel_cmd="npx vercel"

  local whoami
  whoami="$($vercel_cmd whoami 2>/dev/null || echo "")"
  if [[ -n "$whoami" && "$whoami" != *"Error"* ]]; then
    ok "Vercel CLI authenticated as: ${whoami}"
  else
    warn "Vercel CLI not authenticated"
    echo ""
    read -rp "  Run 'vercel login' now? (y/n): " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      $vercel_cmd login
    else
      warn "Skipping — vercel must be authenticated before running the pipeline"
    fi
  fi
}

check_convex_auth() {
  header "Convex CLI"
  if ! npx convex --version &>/dev/null 2>&1; then
    fail "convex CLI not available via npx"
    return 1
  fi

  # Convex stores auth in ~/.convex — check for it
  if [[ -f "${HOME}/.convex/config.json" ]] || [[ -f "${HOME}/.config/convex/config.json" ]]; then
    ok "Convex CLI authenticated (config found)"
  else
    warn "Convex CLI may not be authenticated"
    echo ""
    read -rp "  Run 'npx convex login' now? (y/n): " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      npx convex login
    else
      warn "Skipping — run 'npx convex login' before your first pipeline run"
    fi
  fi
}

check_claude_cli() {
  header "Claude CLI"
  if [[ ! -f "$CLAUDE_BIN" ]]; then
    fail "claude CLI not found at ${CLAUDE_BIN}"
    info "Install: npm install -g @anthropic-ai/claude-code"
    return 1
  fi

  local version
  version="$("$CLAUDE_BIN" --version 2>/dev/null | head -1 || echo "unknown")"
  ok "claude CLI found — ${version}"

  # Verify it can actually run (has API key / auth)
  local test_result
  test_result="$("$CLAUDE_BIN" -p "Reply with only the word READY" --output-format text 2>&1 | head -1 || echo "")"
  if echo "$test_result" | grep -qi "READY"; then
    ok "claude CLI is responsive"
  else
    warn "claude CLI test response: ${test_result:0:60}"
    warn "Ensure ANTHROPIC_API_KEY is set or you are logged into Claude Code"
  fi
}

check_git_identity() {
  header "Git Identity"
  local name; name="$(git config --global user.name 2>/dev/null || echo "")"
  local email; email="$(git config --global user.email 2>/dev/null || echo "")"

  if [[ -n "$name" && -n "$email" ]]; then
    ok "Git identity: ${name} <${email}>"
  else
    warn "Git global identity not set"
    read -rp "  Your name for git commits: " git_name
    read -rp "  Your email for git commits: " git_email
    git config --global user.name "$git_name"
    git config --global user.email "$git_email"
    ok "Git identity set"
  fi
}

# =============================================================================
# SHELL PROFILE SETUP
# =============================================================================

offer_shell_source() {
  header "Shell Profile"
  local profile=""
  local shell_name; shell_name="$(basename "${SHELL:-bash}")"

  case "$shell_name" in
    zsh)  profile="${HOME}/.zshrc" ;;
    bash) profile="${HOME}/.bashrc" ;;
    *)    profile="${HOME}/.profile" ;;
  esac

  local source_line="[ -f \"${ENV_FILE}\" ] && source \"${ENV_FILE}\""

  if grep -qF "$ENV_FILE" "$profile" 2>/dev/null; then
    ok "Already sourced in ${profile}"
    return
  fi

  echo ""
  echo -e "  Add the following to ${BOLD}${profile}${RESET} so secrets are available in every session:"
  echo -e "  ${CYAN}${source_line}${RESET}"
  echo ""
  read -rp "  Add it now? (y/n): " ans
  if [[ "$ans" =~ ^[Yy]$ ]]; then
    echo "" >> "$profile"
    echo "# One Shot Pipeline secrets" >> "$profile"
    echo "$source_line" >> "$profile"
    ok "Added to ${profile} — run 'source ${profile}' or open a new terminal"
  else
    warn "Skipping — remember to source ${ENV_FILE} before running the pipeline"
  fi
}

# =============================================================================
# DIRECTORIES & PERMISSIONS
# =============================================================================

setup_directories() {
  header "Directories"
  mkdir -p "$ONE_SHOTS_DIR"
  ok "One-shots directory: ${ONE_SHOTS_DIR}"

  mkdir -p "${HOME}/.claude/projects"
  ok "Claude memory directory ready"
}

# =============================================================================
# FINAL SUMMARY
# =============================================================================

print_summary() {
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  One Shot Pipeline — Ready${RESET}"
  echo -e "${BOLD}═══════════════════════════════════════════════${RESET}"
  echo ""
  echo -e "  Secrets:   ${ENV_FILE}"
  echo -e "  Shots:     ${ONE_SHOTS_DIR}"
  echo -e "  Pipeline:  ${SCRIPT_DIR}/pipeline.sh"
  echo -e "  Bot:       ${SCRIPT_DIR}/telegram-bot.sh"
  echo ""
  echo -e "${BOLD}  Next steps:${RESET}"
  echo -e "  1. Terminal mode:  ./pipeline.sh my-app full --terminal"
  echo -e "  2. Telegram mode:  ./telegram-bot.sh  (then /new-shot my-app)"
  echo -e "  3. As a service:   sudo bash install-service.sh"
  echo ""
}

# =============================================================================
# MAIN
# =============================================================================
main() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}║   One Shot Pipeline — Initialization         ║${RESET}"
  echo -e "${BOLD}╚══════════════════════════════════════════════╝${RESET}"

  # Load any existing values as defaults
  load_existing

  # ── Collect secrets ────────────────────────────────────────────────────────
  header "Secrets"
  echo -e "  Secrets are saved to ${BOLD}${ENV_FILE}${RESET} (chmod 600, not committed to git)"
  echo ""

  local errors=0

  # Telegram Bot Token
  echo -e "\n  ${BOLD}1. Telegram Bot Token${RESET}"
  info "Create a bot at https://t.me/BotFather — send /newbot"
  TELEGRAM_BOT_TOKEN="$(prompt_secret TELEGRAM_BOT_TOKEN "Bot token")"
  if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
    fail "TELEGRAM_BOT_TOKEN is required"
    (( errors++ ))
  else
    validate_telegram_token "$TELEGRAM_BOT_TOKEN" || (( errors++ )) || true
  fi

  # Telegram Chat ID
  echo -e "\n  ${BOLD}2. Telegram Chat ID${RESET}"
  info "Send a message to your bot, then visit: https://api.telegram.org/bot\$TOKEN/getUpdates"
  TELEGRAM_CHAT_ID="$(prompt_value TELEGRAM_CHAT_ID "Chat ID (numeric)")"
  if [[ -z "$TELEGRAM_CHAT_ID" ]]; then
    fail "TELEGRAM_CHAT_ID is required"
    (( errors++ ))
  elif [[ -n "$TELEGRAM_BOT_TOKEN" ]]; then
    validate_telegram_chat "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_CHAT_ID" || (( errors++ )) || true
  fi

  # GitHub Token
  echo -e "\n  ${BOLD}3. GitHub Personal Access Token${RESET}"
  info "Create at: https://github.com/settings/tokens/new"
  info "Scopes needed: repo, workflow"
  GITHUB_TOKEN="$(prompt_secret GITHUB_TOKEN "GitHub token")"
  if [[ -z "$GITHUB_TOKEN" ]]; then
    warn "GITHUB_TOKEN not set — gh CLI auth will be used instead"
  else
    validate_github_token "$GITHUB_TOKEN" || (( errors++ )) || true
  fi

  # OpenAI API Key
  echo -e "\n  ${BOLD}4. OpenAI API Key${RESET}"
  info "Get at: https://platform.openai.com/api-keys"
  OPENAI_API_KEY="$(prompt_secret OPENAI_API_KEY "OpenAI key (sk-...)")"
  if [[ -z "$OPENAI_API_KEY" ]]; then
    fail "OPENAI_API_KEY is required (used for AI code generation in Convex)"
    (( errors++ ))
  else
    validate_openai_key "$OPENAI_API_KEY" || (( errors++ )) || true
  fi

  # Resend API Key
  echo -e "\n  ${BOLD}5. Resend API Key${RESET}"
  info "Get at: https://resend.com/api-keys"
  RESEND_API_KEY="$(prompt_secret RESEND_API_KEY "Resend key (re_...)")"
  if [[ -z "$RESEND_API_KEY" ]]; then
    warn "RESEND_API_KEY not set — email features will be unavailable"
  else
    validate_resend_key "$RESEND_API_KEY" || (( errors++ )) || true
  fi

  # Write env file after collecting all secrets
  write_env_file
  ok "Secrets written to ${ENV_FILE}"

  # ── Check CLI auth ────────────────────────────────────────────────────────
  check_git_identity
  check_gh_auth
  check_vercel_auth
  check_convex_auth
  check_claude_cli

  # ── Setup directories ─────────────────────────────────────────────────────
  setup_directories

  # ── Shell profile ─────────────────────────────────────────────────────────
  offer_shell_source

  # ── Summary ───────────────────────────────────────────────────────────────
  if (( errors > 0 )); then
    echo ""
    warn "${errors} validation error(s) — fix them before running the pipeline"
  fi

  print_summary
}

main "$@"
