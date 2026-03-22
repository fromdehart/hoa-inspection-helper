#!/usr/bin/env bash
# =============================================================================
# telegram-bot.sh — One Shot Telegram Bot Server
#
# Persistent long-polling bot. Routes commands to pipeline.sh.
# Run as a systemd service (see one-shot-telegram.service).
#
# Commands:
#   /new-shot <slug>         Start a new one-shot with optional slug
#   /approve               Approve current high-level plan, generate build plan
#   /build           Write APPROVAL.md and trigger build
#   /status                  Show current state of active shot
#   /cancel-shot             Cancel active shot
#   /help                    Show help
#
# Text messages (while a shot is active):
#   - If state == "planning": treated as plan feedback
#   - Otherwise: ignored with hint
# =============================================================================
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
readonly BOT_TOKEN="${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is not set}"
readonly PIPELINE_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pipeline.sh"
readonly STATE_DIR="/tmp/one-shot-bot"
readonly ONE_SHOTS_DIR="/home/mike/one-shots"
readonly GITHUB_USER="fromdehart"
readonly POLL_TIMEOUT=30     # seconds for long-polling
readonly LOG_FILE="/var/log/one-shot-bot.log"

mkdir -p "$STATE_DIR"

# ── Logging ───────────────────────────────────────────────────────────────────
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# ── Telegram API ──────────────────────────────────────────────────────────────
TG_BASE="https://api.telegram.org/bot${BOT_TOKEN}"

tg_call() {
  local method="$1"
  shift
  curl -sf -X POST "${TG_BASE}/${method}" "$@" 2>/dev/null || true
}

tg_send() {
  local chat_id="$1"
  local text="$2"
  # Telegram message limit: 4096 chars
  if (( ${#text} > 4000 )); then
    tg_send "$chat_id" "${text:0:4000}"
    tg_send "$chat_id" "...${text:4000}"
    return
  fi
  tg_call "sendMessage" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=${text}" \
    -d "parse_mode=Markdown" \
    >/dev/null
}

tg_send_file() {
  local chat_id="$1"
  local file="$2"
  local caption="${3:-}"
  [[ -f "$file" ]] || return 0
  tg_call "sendDocument" \
    -F "chat_id=${chat_id}" \
    -F "document=@${file}" \
    -F "caption=${caption}" \
    >/dev/null
}

tg_get_updates() {
  local offset="${1:-0}"
  tg_call "getUpdates" \
    -d "offset=${offset}" \
    -d "timeout=${POLL_TIMEOUT}" \
    -d "allowed_updates=[\"message\"]"
}

# ── Per-chat state ────────────────────────────────────────────────────────────
# State files: /tmp/one-shot-bot/<chat_id>/active_slug
#              /tmp/one-shot-bot/<chat_id>/idea_buffer
chat_dir()    { echo "${STATE_DIR}/${1}"; }
chat_slug()   { local f="${STATE_DIR}/${1}/active_slug"; [[ -f "$f" ]] && cat "$f" || echo ""; }
chat_set_slug(){ mkdir -p "${STATE_DIR}/${1}"; echo "$2" > "${STATE_DIR}/${1}/active_slug"; }
chat_clear()  { rm -rf "${STATE_DIR}/${1}"; }

pipeline_state() {
  local slug="$1"
  local state_file="${ONE_SHOTS_DIR}/${slug}/.one-shot/STATE"
  [[ -f "$state_file" ]] && cat "$state_file" || echo "uninitialized"
}

artifact_file() {
  echo "${ONE_SHOTS_DIR}/${1}/.one-shot/${2}"
}

# ── Run pipeline stage in background ─────────────────────────────────────────
run_stage_bg() {
  local slug="$1"
  local stage="$2"
  local chat_id="$3"
  local extra="${4:-}"

  log "Running stage '${stage}' for ${slug} (bg, chat=${chat_id})"

  # Export env so child process inherits them
  export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID="${chat_id}"

  (
    set +e
    bash "$PIPELINE_SH" "$slug" "$stage" $extra \
      >> "${ONE_SHOTS_DIR}/${slug}/.one-shot/logs/${stage}.log" 2>&1
    local exit_code=$?
    if (( exit_code != 0 )); then
      tg_send "$chat_id" "❌ *[${slug}]* Stage \`${stage}\` failed (exit ${exit_code}). Check logs."
    fi
  ) &
}

# ── Slug validation ───────────────────────────────────────────────────────────
validate_slug() {
  local slug="$1"
  [[ "$slug" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$ ]]
}

# =============================================================================
# COMMAND HANDLERS
# =============================================================================

cmd_help() {
  local chat_id="$1"
  tg_send "$chat_id" "$(cat <<'EOF'
*One Shot Factory Bot* 🏭

*How to kick off a new app:*
1. Send `/new My App Name`
   _any text works — it gets auto-formatted to a slug_
2. Send your idea as plain text
   _e.g. "A voting app where people rank coffee shops"_
3. Review the generated plan — reply with feedback to refine it
4. Send `/approve` when the plan looks good
   _This generates a detailed build plan + critique cycle_
5. Review the build plan sent to you
6. Send `/build` to start building
   _The bot will notify you at each stage_
7. Get your live URL when it's done 🚀

*Commands:*
/new \<name\> — Start a new PoC (any text, auto-formatted)
/approve — Approve the high-level plan & generate build plan
/build — Approve build plan & start building
/status — Show current state & artifacts
/cancel-shot — Cancel active shot (files preserved)
/help — Show this message

*What happens automatically:*
• Init: clones template, creates GitHub repo
• Plan: AI generates high-level plan, you refine it
• Build plan: detailed file-by-file implementation spec
• Critique: AI reviews its own plan, revises it
• Build: AI implements everything from the plan
• Test: npm build + Convex codegen + TypeScript check
• Fix: auto-fixes failures (up to 3 iterations)
• Launch: deploys to Vercel, sends you the live URL

*Logs are at:*
`/home/mike/one-shots/<slug>/.one-shot/logs/`
EOF
)"
}

cmd_new_shot() {
  local chat_id="$1"
  local raw="$2"

  if [[ -z "$raw" ]]; then
    tg_send "$chat_id" "Usage: /new \<name\>\nExample: /new My Cool App"
    return
  fi

  # Normalize: lowercase, spaces→hyphens, strip invalid chars, collapse hyphens
  local slug
  slug="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | tr -s '-' | sed 's/^-//;s/-$//')"

  if ! validate_slug "$slug"; then
    tg_send "$chat_id" "❌ Couldn't make a valid slug from \"${raw}\". Try something like: /new my cool app"
    return
  fi

  # Check if already exists
  if [[ -d "${ONE_SHOTS_DIR}/${slug}" ]]; then
    local existing_state; existing_state="$(pipeline_state "$slug")"
    tg_send "$chat_id" "⚠️ Shot '${slug}' already exists (state: ${existing_state}).\nUse /status to check it or /cancel-shot to clear."
    chat_set_slug "$chat_id" "$slug"
    return
  fi

  # Set as active shot
  chat_set_slug "$chat_id" "$slug"

  # Create artifact dir and capture idea
  mkdir -p "${ONE_SHOTS_DIR}/${slug}/.one-shot/logs"

  tg_send "$chat_id" "🆕 New shot: *${slug}*\n\nSend me your idea (unstructured text is fine — describe what you want to build):"

  # Signal that we're waiting for idea
  echo "awaiting-idea" > "${STATE_DIR}/${chat_id}/active_slug_state"
}

cmd_finalize_high_level() {
  local chat_id="$1"
  local slug; slug="$(chat_slug "$chat_id")"

  if [[ -z "$slug" ]]; then
    tg_send "$chat_id" "No active shot. Use /new-shot \<slug\> to start."
    return
  fi

  local state; state="$(pipeline_state "$slug")"
  if [[ ! "$state" =~ ^(planning|build-planning|critique-pending)$ ]]; then
    tg_send "$chat_id" "⚠️ Shot '${slug}' is not in planning state (current: ${state})."
    return
  fi

  # Verify plan exists
  local plan_file; plan_file="$(artifact_file "$slug" "HIGH_LEVEL_PLAN.md")"
  if [[ ! -f "$plan_file" ]]; then
    tg_send "$chat_id" "❌ No HIGH_LEVEL_PLAN.md found. Cannot finalize."
    return
  fi

  tg_send "$chat_id" "👍 High-level plan approved! Generating detailed BUILD_PLAN.md..."

  # Lock state immediately so any further messages aren't treated as plan feedback
  echo "build-planning" > "${ONE_SHOTS_DIR}/${slug}/.one-shot/STATE"

  # Run build-plan stage in background
  run_stage_bg "$slug" "build-plan" "$chat_id"

  # After build-plan, run critique
  (
    sleep 5
    # Wait for build-plan to complete (max 5 min)
    local waited=0
    while (( waited < 300 )); do
      local s; s="$(pipeline_state "$slug")"
      if [[ "$s" == "critique-pending" ]]; then
        export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID="${chat_id}"
        bash "$PIPELINE_SH" "$slug" "critique" \
          >> "${ONE_SHOTS_DIR}/${slug}/.one-shot/logs/critique.log" 2>&1 || \
          tg_send "$chat_id" "❌ Critique stage failed for ${slug}"
        break
      elif [[ "$s" =~ ^(build-planning)$ ]]; then
        sleep 10
        (( waited += 10 ))
      else
        break
      fi
    done
  ) &
}

cmd_approve_build() {
  local chat_id="$1"
  local slug; slug="$(chat_slug "$chat_id")"

  if [[ -z "$slug" ]]; then
    tg_send "$chat_id" "No active shot. Use /new-shot \<slug\> to start."
    return
  fi

  local state; state="$(pipeline_state "$slug")"
  if [[ ! "$state" =~ ^(awaiting-approval|critique-pending|critiquing|built|test-failed)$ ]]; then
    tg_send "$chat_id" "⚠️ Shot '${slug}' cannot be approved in state: ${state}"
    return
  fi

  local build_plan_file; build_plan_file="$(artifact_file "$slug" "BUILD_PLAN.md")"
  if [[ ! -f "$build_plan_file" ]]; then
    tg_send "$chat_id" "❌ No BUILD_PLAN.md found. Cannot approve."
    return
  fi

  # Write approval if not already present
  local approval_file; approval_file="$(artifact_file "$slug" "APPROVAL.md")"
  if [[ ! -f "$approval_file" ]]; then
    cat > "$approval_file" <<EOF
approved: yes
approved_by: telegram:${chat_id}
approved_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
  fi

  # If already built, skip straight to test → launch
  if [[ "$state" =~ ^(built|test-failed)$ ]]; then
    tg_send "$chat_id" "⚡ Code already built — running test & launch for *${slug}*..."
    (
      export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID="${chat_id}"
      local log_base="${ONE_SHOTS_DIR}/${slug}/.one-shot/logs"

      local test_passed=false
      bash "$PIPELINE_SH" "$slug" "test" >> "${log_base}/test.log" 2>&1 && test_passed=true

      if [[ "$test_passed" == "false" ]]; then
        bash "$PIPELINE_SH" "$slug" "fix" >> "${log_base}/fix.log" 2>&1 || {
          tg_send "$chat_id" "❌ Fix stage failed after 3 iterations for ${slug}"
          exit 1
        }
      fi

      bash "$PIPELINE_SH" "$slug" "launch" >> "${log_base}/launch.log" 2>&1 || {
        tg_send "$chat_id" "❌ Launch stage failed for ${slug}"
        exit 1
      }

      local launch_url_file; launch_url_file="$(artifact_file "$slug" "LAUNCH_URL.md")"
      [[ -f "$launch_url_file" ]] && tg_send "$chat_id" "$(cat "$launch_url_file")"
    ) &
    return
  fi

  tg_send "$chat_id" "✅ Build approved! Starting build pipeline for *${slug}*..."
  tg_send "$chat_id" "This will take a few minutes. I'll notify you at each stage."

  # Run: approve → build → test → fix (if needed) → launch
  (
    export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID="${chat_id}"
    local log_base="${ONE_SHOTS_DIR}/${slug}/.one-shot/logs"

    bash "$PIPELINE_SH" "$slug" "approve" >> "${log_base}/approve.log" 2>&1 || {
      tg_send "$chat_id" "❌ Approve stage failed for ${slug}"
      exit 1
    }

    bash "$PIPELINE_SH" "$slug" "build" >> "${log_base}/build.log" 2>&1 || {
      tg_send "$chat_id" "❌ Build stage failed for ${slug}"
      exit 1
    }

    # Test, with auto-fix on failure
    local test_passed=false
    bash "$PIPELINE_SH" "$slug" "test" >> "${log_base}/test.log" 2>&1 && test_passed=true

    if [[ "$test_passed" == "false" ]]; then
      bash "$PIPELINE_SH" "$slug" "fix" >> "${log_base}/fix.log" 2>&1 || {
        tg_send "$chat_id" "❌ Fix stage failed after 3 iterations for ${slug}"
        exit 1
      }
    fi

    bash "$PIPELINE_SH" "$slug" "launch" >> "${log_base}/launch.log" 2>&1 || {
      tg_send "$chat_id" "❌ Launch stage failed for ${slug}"
      exit 1
    }

    # Send launch URL
    local launch_url_file; launch_url_file="$(artifact_file "$slug" "LAUNCH_URL.md")"
    if [[ -f "$launch_url_file" ]]; then
      tg_send "$chat_id" "$(cat "$launch_url_file")"
    fi
  ) &
}

cmd_status() {
  local chat_id="$1"
  local slug; slug="$(chat_slug "$chat_id")"

  if [[ -z "$slug" ]]; then
    tg_send "$chat_id" "No active shot. Use /new-shot \<slug\> to start."
    return
  fi

  local state; state="$(pipeline_state "$slug")"
  local artifacts=""

  for f in IDEA.md HIGH_LEVEL_PLAN.md BUILD_PLAN.md CRITIQUE_1.md CRITIQUE_2.md \
            REVISIONS.md APPROVAL.md TEST_RESULTS.md LAUNCH_URL.md; do
    local fpath="${ONE_SHOTS_DIR}/${slug}/.one-shot/${f}"
    if [[ -f "$fpath" ]]; then
      artifacts="${artifacts}✅ ${f}\n"
    else
      artifacts="${artifacts}⬜ ${f}\n"
    fi
  done

  tg_send "$chat_id" "*Shot:* ${slug}\n*State:* ${state}\n\n*Artifacts:*\n${artifacts}"
}

cmd_cancel_shot() {
  local chat_id="$1"
  local slug; slug="$(chat_slug "$chat_id")"

  if [[ -z "$slug" ]]; then
    tg_send "$chat_id" "No active shot to cancel."
    return
  fi

  chat_clear "$chat_id"
  tg_send "$chat_id" "🗑️ Cancelled shot: *${slug}*\n(Files in ${ONE_SHOTS_DIR}/${slug} are preserved)"
}

# ── Handle idea text ─────────────────────────────────────────────────────────
handle_idea() {
  local chat_id="$1"
  local slug="$2"
  local text="$3"

  local idea_file="${ONE_SHOTS_DIR}/${slug}/.one-shot/IDEA.md"
  local dialogue_file="${ONE_SHOTS_DIR}/${slug}/.one-shot/PLANNING_DIALOGUE.md"

  # Save idea
  cat > "$idea_file" <<EOF
# Idea — ${slug}

Received: $(date)

${text}
EOF

  # Initialize dialogue log
  cat > "$dialogue_file" <<EOF
# Planning Dialogue — ${slug}

## Initial Idea ($(date))
${text}

EOF

  # Clear awaiting-idea flag
  rm -f "${STATE_DIR}/${chat_id}/active_slug_state"

  tg_send "$chat_id" "💡 Got it! Generating high-level plan for *${slug}*..."

  # Run init then plan
  (
    export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID="${chat_id}"
    local log_base="${ONE_SHOTS_DIR}/${slug}/.one-shot/logs"
    mkdir -p "$log_base"

    # Init (creates GitHub repo, etc.)
    bash "$PIPELINE_SH" "$slug" "init" >> "${log_base}/init.log" 2>&1 || {
      tg_send "$chat_id" "❌ Init stage failed for ${slug}"
      exit 1
    }

    # Generate high-level plan (Telegram mode — sends to chat, sets state=planning)
    bash "$PIPELINE_SH" "$slug" "plan" >> "${log_base}/plan.log" 2>&1 || {
      tg_send "$chat_id" "❌ Plan stage failed for ${slug}"
      exit 1
    }
  ) &
}

# ── Handle planning feedback ──────────────────────────────────────────────────
handle_plan_feedback() {
  local chat_id="$1"
  local slug="$2"
  local text="$3"

  tg_send "$chat_id" "📝 Got your feedback! Updating the plan..."

  (
    export TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID="${chat_id}"
    bash "$PIPELINE_SH" "$slug" "plan-feedback" "$text" \
      >> "${ONE_SHOTS_DIR}/${slug}/.one-shot/logs/plan.log" 2>&1 || \
      tg_send "$chat_id" "❌ Plan update failed for ${slug}"
  ) &
}

# =============================================================================
# MESSAGE ROUTER
# =============================================================================
handle_message() {
  local chat_id="$1"
  local text="$2"

  log "MSG chat=${chat_id} text=${text:0:80}"

  # ── Strip leading slash for command detection ──
  local cmd="" cmd_arg=""
  if [[ "$text" == /* ]]; then
    # Extract command (first word) and arg (rest)
    cmd="$(echo "$text" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"
    cmd_arg="$(echo "$text" | cut -d' ' -f2- | sed 's/^[[:space:]]*//')"
    [[ "$cmd_arg" == "$cmd" ]] && cmd_arg=""  # no arg
  fi

  case "$cmd" in
    /start|/help)
      cmd_help "$chat_id"
      return
      ;;
    /new|/new-shot)
      cmd_new_shot "$chat_id" "$cmd_arg"
      return
      ;;
    /approve|/finalize-high-level|/approve-high-level)
      cmd_finalize_high_level "$chat_id"
      return
      ;;
    /build)
      cmd_approve_build "$chat_id"
      return
      ;;
    /status)
      cmd_status "$chat_id"
      return
      ;;
    /cancel-shot)
      cmd_cancel_shot "$chat_id"
      return
      ;;
  esac

  # ── Non-command text: route based on current state ──
  local slug; slug="$(chat_slug "$chat_id")"

  if [[ -z "$slug" ]]; then
    tg_send "$chat_id" "No active shot. Use /new-shot \<slug\> to start."
    return
  fi

  # Check if waiting for idea
  local slug_state_file="${STATE_DIR}/${chat_id}/active_slug_state"
  if [[ -f "$slug_state_file" ]] && [[ "$(cat "$slug_state_file")" == "awaiting-idea" ]]; then
    handle_idea "$chat_id" "$slug" "$text"
    return
  fi

  # Check pipeline state
  local state; state="$(pipeline_state "$slug")"

  case "$state" in
    planning)
      handle_plan_feedback "$chat_id" "$slug" "$text"
      ;;
    uninitialized|initialized)
      tg_send "$chat_id" "Shot '${slug}' is being set up. Please wait..."
      ;;
    building|testing|fixing|launching|build-planning|critiquing)
      tg_send "$chat_id" "⏳ Shot '${slug}' is currently in state: *${state}*. Please wait..."
      ;;
    awaiting-approval)
      tg_send "$chat_id" "Use /build to start building, or send more feedback."
      ;;
    done)
      local url_file; url_file="$(artifact_file "$slug" "LAUNCH_URL.md")"
      if [[ -f "$url_file" ]]; then
        tg_send "$chat_id" "✅ Shot '${slug}' is already live!\n$(cat "$url_file")"
      else
        tg_send "$chat_id" "✅ Shot '${slug}' is complete. Use /new-shot for another."
      fi
      ;;
    *)
      tg_send "$chat_id" "Shot '${slug}' is in state: ${state}\nUse /status for details."
      ;;
  esac
}

# =============================================================================
# MAIN POLL LOOP
# =============================================================================
main() {
  log "=== One Shot Telegram Bot starting ==="
  log "Pipeline: ${PIPELINE_SH}"
  log "One-shots dir: ${ONE_SHOTS_DIR}"

  [[ -f "$PIPELINE_SH" ]] || { log "ERROR: pipeline.sh not found at ${PIPELINE_SH}"; exit 1; }
  chmod +x "$PIPELINE_SH"

  # Verify bot token works
  local me
  me="$(tg_call "getMe" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('username','?'))" 2>/dev/null || echo "unknown")"
  log "Bot: @${me}"

  local offset=0

  # Main long-poll loop
  while true; do
    local response
    response="$(tg_get_updates "$offset" 2>/dev/null || echo '{"ok":false}')"

    # Check for valid response
    local ok_val
    ok_val="$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok','false'))" 2>/dev/null || echo "false")"

    if [[ "$ok_val" != "True" && "$ok_val" != "true" ]]; then
      log "getUpdates failed, retrying in 5s..."
      sleep 5
      continue
    fi

    # Parse updates
    local updates_json
    updates_json="$(echo "$response" | python3 -c "
import sys, json
d = json.load(sys.stdin)
updates = d.get('result', [])
for u in updates:
    uid = u.get('update_id', 0)
    msg = u.get('message', {})
    chat_id = str(msg.get('chat', {}).get('id', ''))
    text = msg.get('text', '')
    if chat_id and text:
        # Escape newlines in text for shell
        text_escaped = text.replace('\\\\', '\\\\\\\\').replace('\n', '\\\\n').replace('\t', '\\\\t')
        print(f'{uid}\t{chat_id}\t{text_escaped}')
" 2>/dev/null || echo "")"

    while IFS=$'\t' read -r update_id chat_id text_escaped; do
      [[ -z "$update_id" ]] && continue

      # Unescape newlines
      local text
      text="$(printf '%b' "${text_escaped//\\n/$'\n'}")"

      # Update offset (mark as processed)
      offset=$(( update_id + 1 ))

      # Handle message
      handle_message "$chat_id" "$text" &

    done <<< "$updates_json"

    # Small sleep to prevent tight loop if updates are empty
    sleep 0.5
  done
}

main "$@"
