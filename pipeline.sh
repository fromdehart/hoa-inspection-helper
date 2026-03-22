#!/usr/bin/env bash
# =============================================================================
# pipeline.sh — One Shot PoC Factory Pipeline
# Usage:  pipeline.sh <slug> <stage>
# Stages: init | plan | build-plan | critique | revise | approve |
#         build | test | fix | launch | full
# =============================================================================
set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ONE_SHOTS_DIR="/home/mike/one-shots"
readonly TEMPLATE_REPO="https://github.com/fromdehart/one-shot.git"
readonly GITHUB_USER="fromdehart"
readonly CLAUDE_BIN="/home/mike/.local/bin/claude"

# ── Logging ───────────────────────────────────────────────────────────────────
_ts()   { date '+%H:%M:%S'; }
log()   { echo "[$(_ts)] $*" | tee -a "${_LOG_FILE:-/dev/stderr}"; }
info()  { log "ℹ  $*"; }
ok()    { log "✅ $*"; }
fail()  { log "❌ $*"; exit 1; }
stage_log() { echo "[$(_ts)] [${STAGE:-?}] $*"; }

# ── Telegram ──────────────────────────────────────────────────────────────────
tg_send() {
  local msg="$1"
  local chat_id="${TELEGRAM_CHAT_ID:-}"
  local token="${TELEGRAM_BOT_TOKEN:-}"
  [[ -z "$chat_id" || -z "$token" ]] && return 0
  # Split long messages (Telegram limit 4096 chars)
  if (( ${#msg} > 4000 )); then
    tg_send "${msg:0:4000}"
    tg_send "...${msg:4000}"
    return
  fi
  curl -sf -X POST "https://api.telegram.org/bot${token}/sendMessage" \
    --data-urlencode "chat_id=${chat_id}" \
    --data-urlencode "text=${msg}" \
    -d "parse_mode=Markdown" \
    >/dev/null 2>&1 || true
}

tg_send_doc() {
  # Send a file as a document
  local chat_id="${TELEGRAM_CHAT_ID:-}"
  local token="${TELEGRAM_BOT_TOKEN:-}"
  local file="$1"
  local caption="${2:-}"
  [[ -z "$chat_id" || -z "$token" || ! -f "$file" ]] && return 0
  curl -sf -X POST "https://api.telegram.org/bot${token}/sendDocument" \
    -F "chat_id=${chat_id}" \
    -F "document=@${file}" \
    -F "caption=${caption}" \
    >/dev/null 2>&1 || true
}

tg_stage_start() {
  local slug="$1" stage="$2"
  tg_send "🚀 *[${slug}]* Stage \`${stage}\` started"
}

tg_stage_ok() {
  local slug="$1" stage="$2" msg="${3:-}"
  tg_send "✅ *[${slug}]* Stage \`${stage}\` complete${msg:+ — ${msg}}"
}

tg_stage_fail() {
  local slug="$1" stage="$2" msg="${3:-}"
  tg_send "❌ *[${slug}]* Stage \`${stage}\` failed${msg:+ — ${msg}}"
}

# ── Slug & path helpers ───────────────────────────────────────────────────────
validate_slug() {
  local slug="$1"
  [[ "$slug" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$ ]] || \
    fail "Invalid slug '${slug}'. Use lowercase letters, numbers, and hyphens."
}

slug_dir()      { echo "${ONE_SHOTS_DIR}/${1}"; }
artifact_dir()  { echo "${ONE_SHOTS_DIR}/${1}/.one-shot"; }
log_dir()       { echo "${ONE_SHOTS_DIR}/${1}/.one-shot/logs"; }
artifact_path() { echo "${ONE_SHOTS_DIR}/${1}/.one-shot/${2}"; }

require_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || fail "Directory not found: ${dir}"
}

require_artifact() {
  local slug="$1" name="$2"
  local path; path="$(artifact_path "$slug" "$name")"
  [[ -f "$path" ]] || fail "Required artifact missing: .one-shot/${name} — run prerequisite stage first."
}

# ── State machine ─────────────────────────────────────────────────────────────
set_state() {
  local slug="$1" state="$2"
  echo "$state" > "$(artifact_path "$slug" "STATE")"
  log "State → ${state}"
}

get_state() {
  local slug="$1"
  local f; f="$(artifact_path "$slug" "STATE")"
  [[ -f "$f" ]] && cat "$f" || echo "uninitialized"
}

# ── Claude invocation ─────────────────────────────────────────────────────────
# Run claude in non-interactive print mode from within the slug dir.
# Writes response to stdout; all tool calls (file reads/writes) happen live.
claude_run() {
  local slug="$1"
  local prompt="$2"
  local extra_flags="${3:-}"
  cd "$(slug_dir "$slug")"
  # shellcheck disable=SC2086
  "$CLAUDE_BIN" -p "$prompt" --output-format text --dangerously-skip-permissions $extra_flags 2>&1
}

# Run claude and capture output to a file
claude_to_file() {
  local slug="$1"
  local prompt="$2"
  local out_file="$3"
  claude_run "$slug" "$prompt" > "$out_file"
}

# ── Git helpers ───────────────────────────────────────────────────────────────
git_commit_if_changed() {
  local dir="$1" msg="$2"
  cd "$dir"
  if ! git diff --quiet || ! git diff --cached --quiet || \
     [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    git add -A
    git commit -m "$msg" --quiet
  fi
}

# =============================================================================
# STAGES
# =============================================================================

# ── stage: init ───────────────────────────────────────────────────────────────
stage_init() {
  local slug="$1"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  info "Initializing one-shot: ${slug}"
  tg_stage_start "$slug" "init"

  # Validate prerequisites
  command -v gh >/dev/null 2>&1  || fail "gh CLI not found"
  [[ -f "$CLAUDE_BIN" ]]        || fail "claude CLI not found at ${CLAUDE_BIN}"

  mkdir -p "$ONE_SHOTS_DIR"

  local _stashed_artifacts=""
  if [[ -d "$sdir" ]]; then
    if [[ ! -f "${adir}/STATE" ]]; then
      # Bot pre-created the directory before init ran — stash artifacts, wipe, then restore after clone
      info "Partial directory found (no state). Reinitializing..."
      _stashed_artifacts="$(mktemp -d)"
      [[ -d "$adir" ]] && cp -r "$adir/." "$_stashed_artifacts/" 2>/dev/null || true
      rm -rf "$sdir"
    else
      fail "Directory already exists: ${sdir} (state: $(cat "${adir}/STATE")). Delete it first or use a different slug."
    fi
  fi

  # Clone template
  info "Cloning template into ${sdir}..."
  git clone "$TEMPLATE_REPO" "$sdir" --quiet

  # Restore any stashed artifacts (e.g. IDEA.md written by bot before init ran)
  if [[ -n "$_stashed_artifacts" && -d "$_stashed_artifacts" ]]; then
    mkdir -p "$adir"
    cp -r "$_stashed_artifacts/." "$adir/" 2>/dev/null || true
    rm -rf "$_stashed_artifacts"
  fi

  # Fresh git history
  cd "$sdir"
  rm -rf .git
  git init --quiet
  git add -A
  git commit -m "Initial commit from template" --quiet

  # Create .one-shot artifact directory
  mkdir -p "${adir}/logs"
  set_state "$slug" "initialized"

  # Create GitHub repository
  info "Creating GitHub repository: ${slug}..."
  gh repo create "${GITHUB_USER}/${slug}" \
    --public \
    --source=. \
    --push \
    --description "One Shot PoC — ${slug}" \
    --remote=origin \
    2>&1 | tee "${adir}/logs/init.log" || \
    fail "GitHub repo creation failed. Check gh auth."

  ok "Repository created: https://github.com/${GITHUB_USER}/${slug}"
  tg_stage_ok "$slug" "init" "https://github.com/${GITHUB_USER}/${slug}"
}

# ── stage: plan ───────────────────────────────────────────────────────────────
# Generates HIGH_LEVEL_PLAN.md from IDEA.md + PLANNING_DIALOGUE.md.
# In terminal mode (--terminal): runs interactive loop until user confirms.
# In Telegram mode (default): generates once, sends to Telegram, sets state=planning.
stage_plan() {
  local slug="$1"
  local terminal_mode="${2:-false}"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  require_dir "$sdir"
  require_artifact "$slug" "IDEA.md"

  mkdir -p "${adir}/logs"
  _LOG_FILE="${adir}/logs/plan.log"

  info "Generating high-level plan..."
  tg_stage_start "$slug" "plan"

  local idea; idea="$(cat "$(artifact_path "$slug" "IDEA.md")")"
  local dialogue=""
  local dialogue_file; dialogue_file="$(artifact_path "$slug" "PLANNING_DIALOGUE.md")"
  [[ -f "$dialogue_file" ]] && dialogue="$(cat "$dialogue_file")"

  local prompt
  prompt="$(cat <<PROMPT
You are a senior product engineer planning a one-shot PoC web application.

Read the following idea and planning dialogue, then produce a HIGH_LEVEL_PLAN.md artifact.

## IDEA
${idea}

## PLANNING DIALOGUE SO FAR
${dialogue:-"(none yet)"}

## OUTPUT REQUIREMENTS
Write ONLY the content for HIGH_LEVEL_PLAN.md. No preamble. No meta-commentary.

Structure:
# High-Level Plan: <App Name>

## What It Does
<1-3 sentences describing the app's purpose>

## Key Features
- <feature 1>
- <feature 2>
- ...

## Tech Stack
- Frontend: React + Vite + Tailwind (template already in place)
- Backend: Convex (real-time, serverless)
- AI: OpenAI (if needed)
- Email: Resend (if needed)
- Auth: <approach>

## Scope & Constraints
<What is in scope, what is explicitly out of scope for this one-shot>

## Implementation Approach
<High-level sequencing of work, 3-5 bullet points>

## Open Questions
<Any ambiguities that need clarification, or "None">
PROMPT
)"

  local plan_file; plan_file="$(artifact_path "$slug" "HIGH_LEVEL_PLAN.md")"

  # Generate plan
  cd "$sdir"
  info "Running claude for plan generation..."
  "$CLAUDE_BIN" -p "$prompt" --output-format text --dangerously-skip-permissions 2>&1 \
    | tee "${adir}/logs/plan.log" \
    > "$plan_file"

  ok "HIGH_LEVEL_PLAN.md generated"

  if [[ "$terminal_mode" == "true" ]]; then
    # Interactive terminal loop
    while true; do
      echo ""
      echo "═══════════════════════════════════════════════════"
      cat "$plan_file"
      echo "═══════════════════════════════════════════════════"
      echo ""
      echo "Enter feedback (or type 'approve' / 'finalize' to proceed):"
      read -r user_input

      if [[ "$user_input" =~ ^(approve|finalize|ok|yes|done)$ ]]; then
        break
      fi

      # Append feedback to dialogue
      {
        echo ""
        echo "## User Feedback ($(date))"
        echo "$user_input"
      } >> "$dialogue_file"

      # Regenerate with feedback
      dialogue="$(cat "$dialogue_file")"
      prompt="$(cat <<PROMPT
You are a senior product engineer. The user has reviewed the plan and provided feedback.
Update HIGH_LEVEL_PLAN.md accordingly.

## ORIGINAL IDEA
${idea}

## PLANNING DIALOGUE INCLUDING FEEDBACK
${dialogue}

## CURRENT PLAN
$(cat "$plan_file")

Write ONLY the updated plan content. No preamble.
PROMPT
)"
      info "Regenerating plan with feedback..."
      "$CLAUDE_BIN" -p "$prompt" --output-format text --dangerously-skip-permissions 2>&1 \
        | tee -a "${adir}/logs/plan.log" \
        > "$plan_file"
    done

    set_state "$slug" "planning-approved"
    ok "High-level plan approved"
  else
    # Telegram mode: send plan, set state, bot handles loop
    tg_send "*[${slug}]* 📋 High-Level Plan ready:"
    tg_send "$(cat "$plan_file")"
    tg_send "Reply with feedback or send /approve to proceed."
    set_state "$slug" "planning"
  fi

  tg_stage_ok "$slug" "plan"
}

# Regenerate plan with new feedback (called by Telegram bot on each feedback message)
stage_plan_feedback() {
  local slug="$1"
  local feedback="$2"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  require_artifact "$slug" "IDEA.md"
  require_artifact "$slug" "HIGH_LEVEL_PLAN.md"

  local dialogue_file; dialogue_file="$(artifact_path "$slug" "PLANNING_DIALOGUE.md")"

  # Append feedback
  {
    echo ""
    echo "## User Feedback ($(date))"
    echo "$feedback"
  } >> "$dialogue_file"

  local idea; idea="$(cat "$(artifact_path "$slug" "IDEA.md")")"
  local dialogue; dialogue="$(cat "$dialogue_file")"
  local current_plan; current_plan="$(cat "$(artifact_path "$slug" "HIGH_LEVEL_PLAN.md")")"

  local prompt
  prompt="$(cat <<PROMPT
You are a senior product engineer. Update the high-level plan based on user feedback.

## IDEA
${idea}

## PLANNING DIALOGUE
${dialogue}

## CURRENT PLAN
${current_plan}

Write ONLY the updated HIGH_LEVEL_PLAN.md content. No preamble.
PROMPT
)"

  local plan_file; plan_file="$(artifact_path "$slug" "HIGH_LEVEL_PLAN.md")"
  cd "$sdir"
  "$CLAUDE_BIN" -p "$prompt" --output-format text --dangerously-skip-permissions 2>&1 > "$plan_file"

  tg_send "*[${slug}]* 📋 Updated plan:"
  tg_send "$(cat "$plan_file")"
  tg_send "Reply with more feedback or /approve to proceed."
}

# ── stage: build-plan ─────────────────────────────────────────────────────────
stage_build_plan() {
  local slug="$1"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  require_artifact "$slug" "HIGH_LEVEL_PLAN.md"
  mkdir -p "${adir}/logs"
  _LOG_FILE="${adir}/logs/build-plan.log"

  info "Generating BUILD_PLAN.md..."
  tg_stage_start "$slug" "build-plan"
  set_state "$slug" "build-planning"

  local plan; plan="$(cat "$(artifact_path "$slug" "HIGH_LEVEL_PLAN.md")")"

  # Read template structure for context
  local template_files
  template_files="$(find "$sdir" -type f \
    ! -path '*/.git/*' ! -path '*/.one-shot/*' \
    ! -path '*/node_modules/*' ! -path '*/_generated/*' \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' \) \
    2>/dev/null | sort | head -40 || true)"

  local prompt
  prompt="$(cat <<PROMPT
You are a senior full-stack engineer creating a detailed BUILD_PLAN.md for a one-shot PoC.

## HIGH-LEVEL PLAN
${plan}

## TEMPLATE STRUCTURE
The project is a Vite + React + Convex + Tailwind app. Key existing files:
${template_files}

The template includes:
- convex/schema.ts — Convex DB schema (events, data, votes, leads tables)
- convex/openai.ts — OpenAI integration
- convex/resend.ts — Email via Resend
- convex/telegram.ts — Telegram notifications
- src/App.tsx — React app with ConvexProvider + routing
- src/components/GateScreen.tsx — Email gate component
- src/pages/Index.tsx — Main page

## OUTPUT: BUILD_PLAN.md

Write a complete, detailed BUILD_PLAN.md with NO placeholders or TODOs. Every section must be concrete.

# Build Plan: <App Name>

## 1. Overview
<What we're building and why>

## 2. File Changes Required
For each file that needs to be created or modified:
### File: <path>
- Action: CREATE | MODIFY | DELETE
- Purpose: <why>
- Key changes: <specific changes needed>

## 3. Convex Schema Changes
<Exact schema additions/modifications with field types>

## 4. Convex Functions
For each function:
### <module>/<functionName> (<query|mutation|action>)
- Purpose: <what it does>
- Args: <typed args>
- Returns: <return type>
- Logic: <step-by-step>

## 5. React Components & Pages
For each component:
### <ComponentName>
- File: <path>
- Props: <typed props>
- State: <local state>
- Behavior: <what it does>
- Key UI: <description>

## 6. Environment Variables
- VITE_CONVEX_URL — Convex deployment URL (client)
- VITE_CHALLENGE_ID — Unique app identifier (client)
- OPENAI_API_KEY — OpenAI key (Convex server only)
- RESEND_API_KEY — Resend key (Convex server only)
<any additional>

## 7. Build Sequence
Ordered list of implementation steps (must be followed exactly):
1. <step>
2. <step>
...

## 8. Test Criteria
How to verify the build succeeds:
- npm run build — must exit 0
- npx convex codegen — must exit 0
- <any app-specific checks>

## 9. Deployment Notes
<Any special Convex or Vercel configuration needed>
PROMPT
)"

  local build_plan_file; build_plan_file="$(artifact_path "$slug" "BUILD_PLAN.md")"
  cd "$sdir"

  info "Running claude for BUILD_PLAN generation..."
  "$CLAUDE_BIN" -p "$prompt" --output-format text --dangerously-skip-permissions 2>&1 \
    | tee "${adir}/logs/build-plan.log" \
    > "$build_plan_file"

  set_state "$slug" "critique-pending"
  ok "BUILD_PLAN.md generated"
  tg_stage_ok "$slug" "build-plan"
  tg_send_doc "$build_plan_file" "BUILD_PLAN.md for ${slug}"
}

# ── stage: critique ───────────────────────────────────────────────────────────
stage_critique() {
  local slug="$1"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  require_artifact "$slug" "BUILD_PLAN.md"
  mkdir -p "${adir}/logs"
  _LOG_FILE="${adir}/logs/critique.log"

  info "Running critique cycle..."
  tg_stage_start "$slug" "critique"
  set_state "$slug" "critiquing"

  local build_plan; build_plan="$(cat "$(artifact_path "$slug" "BUILD_PLAN.md")")"

  # ── Critique 1 ──
  local critique1_prompt
  critique1_prompt="$(cat <<PROMPT
You are a senior engineer performing a critical code review of a build plan BEFORE implementation.
Your job is to find problems, gaps, and risks.

## BUILD_PLAN
${build_plan}

## OUTPUT: CRITIQUE_1.md
Write only the critique content. Be specific and actionable. Structure:

# Critique 1

## Critical Issues (must fix before build)
- <issue>: <impact> → <fix>

## Architecture Concerns
- <concern>: <why it matters> → <suggested approach>

## Missing Pieces
- <what's missing>: <why it's needed>

## Edge Cases Not Handled
- <edge case>: <potential impact>

## Overall Risk Level
HIGH / MEDIUM / LOW — <brief reason>
PROMPT
)"

  local critique1_file; critique1_file="$(artifact_path "$slug" "CRITIQUE_1.md")"
  cd "$sdir"

  info "Generating CRITIQUE_1.md..."
  "$CLAUDE_BIN" -p "$critique1_prompt" --output-format text --dangerously-skip-permissions 2>&1 \
    | tee "${adir}/logs/critique.log" \
    > "$critique1_file"

  ok "CRITIQUE_1.md generated"

  # ── Revise BUILD_PLAN based on Critique 1 ──
  local revise_prompt
  revise_prompt="$(cat <<PROMPT
You are a senior engineer. Apply the critique feedback to improve the BUILD_PLAN.

## CURRENT BUILD_PLAN
${build_plan}

## CRITIQUE_1
$(cat "$critique1_file")

## TASK
1. Write an improved BUILD_PLAN.md addressing all critical issues and architecture concerns.
2. Write a REVISIONS.md summarizing exactly what changed and why.

Output format — write two files:
First output the full content of BUILD_PLAN.md, then a line with exactly: ---REVISIONS---
Then output the full content of REVISIONS.md.
PROMPT
)"

  local combined; combined="$(cd "$sdir" && "$CLAUDE_BIN" -p "$revise_prompt" --output-format text --dangerously-skip-permissions 2>&1 \
    | tee -a "${adir}/logs/critique.log")"

  # Split on ---REVISIONS---
  local build_plan_revised; build_plan_revised="${combined%%---REVISIONS---*}"
  local revisions; revisions="${combined##*---REVISIONS---}"

  echo "$build_plan_revised" > "$(artifact_path "$slug" "BUILD_PLAN.md")"
  echo "$revisions" > "$(artifact_path "$slug" "REVISIONS.md")"

  ok "BUILD_PLAN.md revised, REVISIONS.md written"

  # ── Critique 2 ──
  local critique2_prompt
  critique2_prompt="$(cat <<PROMPT
You are a senior engineer performing a final review of the revised build plan.

## REVISED BUILD_PLAN
$(cat "$(artifact_path "$slug" "BUILD_PLAN.md")")

## ORIGINAL CRITIQUE
$(cat "$critique1_file")

## OUTPUT: CRITIQUE_2.md
Has the plan addressed the concerns? What remains?

# Critique 2 (Final Review)

## Resolved Issues
- <issue>: ✅ addressed / ⚠️ partially addressed

## Remaining Concerns
- <concern>: <recommended action>

## Build Readiness
READY / NEEDS_WORK — <brief rationale>

## Final Recommendations
<1-3 specific things to watch for during implementation>
PROMPT
)"

  local critique2_file; critique2_file="$(artifact_path "$slug" "CRITIQUE_2.md")"
  cd "$sdir"

  info "Generating CRITIQUE_2.md..."
  "$CLAUDE_BIN" -p "$critique2_prompt" --output-format text --dangerously-skip-permissions 2>&1 \
    | tee -a "${adir}/logs/critique.log" \
    > "$critique2_file"

  set_state "$slug" "awaiting-approval"
  ok "Critique cycle complete"

  tg_stage_ok "$slug" "critique"
  tg_send "*[${slug}]* 📝 Build plan ready for your approval.\n\nSend */build ${slug}* to begin building.\n\nSummary of critique:"
  tg_send "$(cat "$critique2_file")"
}

# ── stage: approve ────────────────────────────────────────────────────────────
stage_approve() {
  local slug="$1"

  require_artifact "$slug" "BUILD_PLAN.md"
  local approval_file; approval_file="$(artifact_path "$slug" "APPROVAL.md")"

  if [[ ! -f "$approval_file" ]]; then
    fail "No APPROVAL.md found. Create .one-shot/APPROVAL.md with 'approved: yes' to proceed."
  fi

  if ! grep -qi "^approved:[[:space:]]*yes" "$approval_file"; then
    fail "Build not approved. Set 'approved: yes' in .one-shot/APPROVAL.md"
  fi

  set_state "$slug" "approved"
  ok "Build approved. Ready to build."
  tg_send "✅ *[${slug}]* Build approved — starting build stage"
}

# ── stage: build ──────────────────────────────────────────────────────────────
stage_build() {
  local slug="$1"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  require_artifact "$slug" "BUILD_PLAN.md"
  require_artifact "$slug" "APPROVAL.md"

  # Verify approval
  grep -qi "^approved:[[:space:]]*yes" "$(artifact_path "$slug" "APPROVAL.md")" || \
    fail "Build not approved. Run stage 'approve' first."

  mkdir -p "${adir}/logs"
  _LOG_FILE="${adir}/logs/build.log"

  info "Starting build stage..."
  tg_stage_start "$slug" "build"
  set_state "$slug" "building"

  # Install dependencies first
  cd "$sdir"
  info "Installing dependencies..."
  npm install --prefer-offline 2>&1 | tee -a "${adir}/logs/build.log"
  git_commit_if_changed "$sdir" "chore: npm install"

  # ── Let Claude implement the BUILD_PLAN ──
  local build_plan; build_plan="$(cat "$(artifact_path "$slug" "BUILD_PLAN.md")")"

  local build_prompt
  build_prompt="$(cat <<PROMPT
You are implementing a one-shot PoC web application. Build it completely according to the BUILD_PLAN.

## BUILD_PLAN
${build_plan}

## CRITICAL RULES
1. Follow BUILD_PLAN.md exactly — it is the single source of truth
2. No placeholders, no TODOs, no stub implementations
3. Use the existing template code as a foundation — modify/extend it
4. All Convex functions must be in convex/ directory
5. All React components must be in src/ directory
6. Never hardcode secrets — use process.env (Convex) or import.meta.env (Vite)
7. The app must work with: npm run build && npx convex codegen

## EXISTING TEMPLATE
The template has: React+Vite frontend, Convex backend, Tailwind CSS, shadcn/ui components.
Key files already exist — examine them before modifying.

Implement everything now. Write all files. Make it work.
PROMPT
)"

  info "Running claude to implement BUILD_PLAN..."
  cd "$sdir"
  "$CLAUDE_BIN" -p "$build_prompt" --output-format text --dangerously-skip-permissions 2>&1 \
    | tee "${adir}/logs/build.log"

  # Commit what was built
  git_commit_if_changed "$sdir" "feat: implement PoC — ${slug}"

  # ── Initialize Convex project ──
  info "Setting up Convex project..."
  cd "$sdir"

  if ! [[ -f ".env.local" ]] || ! grep -q "CONVEX_DEPLOYMENT" ".env.local" 2>/dev/null; then
    # Auto-detect team slug from logged-in Convex account
    local convex_token convex_team_slug
    convex_token="$(python3 -c "import json; print(json.load(open('${HOME}/.convex/config.json'))['accessToken'])" 2>/dev/null || true)"

    if [[ -z "$convex_token" ]]; then
      fail "Not logged in to Convex — run: npx convex login"
    fi

    convex_team_slug="$(curl -sf \
      -H "Authorization: Bearer ${convex_token}" \
      "https://api.convex.dev/api/teams" 2>/dev/null \
      | python3 -c "import sys,json; teams=json.load(sys.stdin); print(teams[0]['slug'])" 2>/dev/null || true)"

    if [[ -z "$convex_team_slug" ]]; then
      fail "Could not detect Convex team — check your Convex login"
    fi

    info "Creating Convex project '${slug}' under team '${convex_team_slug}'..."

    # Create project via API (idempotent — ignores already-exists errors)
    curl -sf -X POST \
      -H "Authorization: Bearer ${convex_token}" \
      -H "Content-Type: application/json" \
      -H "Convex-Client: npm-cli-1.32.0" \
      -d "{\"team\": \"${convex_team_slug}\", \"projectName\": \"${slug}\"}" \
      "https://api.convex.dev/api/create_project" \
      2>&1 | tee -a "${adir}/logs/build.log" || true

    # Configure project non-interactively (writes convex.json + .env.local)
    npx convex dev --once \
      --configure=existing \
      --team "$convex_team_slug" \
      --project "$slug" \
      2>&1 | tee -a "${adir}/logs/build.log"
  fi

  # ── Inject runtime secrets ──
  info "Injecting runtime secrets into Convex..."

  # Set env secrets in Convex (never stored in Git)
  [[ -n "${OPENAI_API_KEY:-}" ]] && \
    npx convex env set OPENAI_API_KEY "$OPENAI_API_KEY" 2>&1 | tee -a "${adir}/logs/build.log"
  [[ -n "${RESEND_API_KEY:-}" ]] && \
    npx convex env set RESEND_API_KEY "$RESEND_API_KEY" 2>&1 | tee -a "${adir}/logs/build.log"

  # Deploy Convex
  info "Deploying Convex..."
  npx convex deploy 2>&1 | tee -a "${adir}/logs/build.log"

  # Commit any generated files
  git_commit_if_changed "$sdir" "chore: post-convex-deploy artifacts"

  set_state "$slug" "built"
  ok "Build stage complete"
  tg_stage_ok "$slug" "build"
}

# ── stage: test ───────────────────────────────────────────────────────────────
stage_test() {
  local slug="$1"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  require_dir "$sdir"
  mkdir -p "${adir}/logs"
  _LOG_FILE="${adir}/logs/test.log"

  local results_file; results_file="$(artifact_path "$slug" "TEST_RESULTS.md")"

  info "Running tests..."
  tg_stage_start "$slug" "test"
  set_state "$slug" "testing"

  cd "$sdir"

  {
    echo "# Test Results — ${slug}"
    echo "Date: $(date)"
    echo ""
  } > "$results_file"

  local all_passed=true

  # ── Test 1: npm run build ──
  echo "## npm run build" >> "$results_file"
  if npm run build 2>&1 | tee "${adir}/logs/test.log" | tee -a "$results_file"; then
    echo "**PASS**" >> "$results_file"
    ok "npm run build: PASS"
  else
    echo "**FAIL**" >> "$results_file"
    all_passed=false
    info "npm run build: FAIL"
  fi
  echo "" >> "$results_file"

  # ── Test 2: npx convex codegen ──
  echo "## npx convex codegen" >> "$results_file"
  if npx convex codegen 2>&1 | tee -a "${adir}/logs/test.log" | tee -a "$results_file"; then
    echo "**PASS**" >> "$results_file"
    ok "npx convex codegen: PASS"
  else
    echo "**FAIL**" >> "$results_file"
    all_passed=false
    info "npx convex codegen: FAIL"
  fi
  echo "" >> "$results_file"

  # ── Test 3: TypeScript check ──
  if [[ -f "tsconfig.json" ]]; then
    echo "## TypeScript check" >> "$results_file"
    if npx tsc --noEmit 2>&1 | tee -a "${adir}/logs/test.log" | tee -a "$results_file"; then
      echo "**PASS**" >> "$results_file"
      ok "TypeScript: PASS"
    else
      echo "**FAIL**" >> "$results_file"
      all_passed=false
      info "TypeScript: FAIL"
    fi
    echo "" >> "$results_file"
  fi

  if [[ "$all_passed" == "true" ]]; then
    echo "## Overall: ✅ ALL TESTS PASSED" >> "$results_file"
    set_state "$slug" "tested"
    ok "All tests passed"
    tg_stage_ok "$slug" "test" "all tests passed"
  else
    echo "## Overall: ❌ SOME TESTS FAILED" >> "$results_file"
    set_state "$slug" "test-failed"
    info "Some tests failed — run 'fix' stage"
    tg_send "⚠️ *[${slug}]* Tests failed — running fix stage..."
    tg_stage_fail "$slug" "test" "see TEST_RESULTS.md"
    return 1
  fi
}

# ── stage: fix ────────────────────────────────────────────────────────────────
stage_fix() {
  local slug="$1"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"
  local max_iterations="${2:-3}"

  require_artifact "$slug" "TEST_RESULTS.md"
  mkdir -p "${adir}/logs"
  _LOG_FILE="${adir}/logs/fix.log"

  info "Fixing test failures (max ${max_iterations} iterations)..."
  tg_stage_start "$slug" "fix"
  set_state "$slug" "fixing"

  local iteration=0
  while (( iteration < max_iterations )); do
    (( iteration++ ))
    info "Fix iteration ${iteration}/${max_iterations}..."

    local test_results; test_results="$(cat "$(artifact_path "$slug" "TEST_RESULTS.md")")"
    local build_plan; build_plan="$(cat "$(artifact_path "$slug" "BUILD_PLAN.md")" 2>/dev/null || echo "(no build plan)")"

    local fix_prompt
    fix_prompt="$(cat <<PROMPT
You are fixing build/test failures in a one-shot PoC application.

## TEST RESULTS (failing)
${test_results}

## BUILD_PLAN (for reference)
${build_plan}

## YOUR TASK
Read the test output carefully. Fix all errors.
- For TypeScript errors: fix type mismatches, missing imports, wrong APIs
- For build errors: fix syntax errors, missing dependencies, broken imports
- For Convex codegen errors: fix schema/function type issues

After fixing, the following must pass:
1. npm run build
2. npx convex codegen

Make only the necessary changes to fix the errors. Do not refactor unrelated code.
PROMPT
)"

    cd "$sdir"
    info "Running claude fix iteration ${iteration}..."
    "$CLAUDE_BIN" -p "$fix_prompt" --output-format text --dangerously-skip-permissions 2>&1 \
      | tee -a "${adir}/logs/fix.log"

    git_commit_if_changed "$sdir" "fix: iteration ${iteration} — address test failures"

    # Re-run tests
    if stage_test "$slug"; then
      set_state "$slug" "tested"
      ok "Fix successful after ${iteration} iteration(s)"
      tg_stage_ok "$slug" "fix" "all tests pass after ${iteration} fix(es)"
      return 0
    fi
  done

  fail "Fix stage exhausted ${max_iterations} iterations. Manual intervention required."
}

# ── stage: launch ─────────────────────────────────────────────────────────────
stage_launch() {
  local slug="$1"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  require_dir "$sdir"
  mkdir -p "${adir}/logs"
  _LOG_FILE="${adir}/logs/launch.log"

  info "Launching to Vercel..."
  tg_stage_start "$slug" "launch"
  set_state "$slug" "launching"

  cd "$sdir"

  # Read Convex URL from .env.local (where Convex CLI writes it)
  local convex_url=""
  for env_file in ".env.local" ".env"; do
    if [[ -f "$env_file" ]]; then
      convex_url="$(grep '^VITE_CONVEX_URL=' "$env_file" | cut -d= -f2- | tr -d '"' || true)"
      [[ -n "$convex_url" ]] && break
    fi
  done

  # Set Vercel env vars BEFORE first deploy so they're baked into the build
  info "Setting Vercel environment variables..."
  if [[ -n "$convex_url" ]]; then
    echo "$convex_url" | vercel env add VITE_CONVEX_URL production --force \
      2>&1 | tee -a "${adir}/logs/launch.log" || true
  fi
  echo "$slug" | vercel env add VITE_CHALLENGE_ID production --force \
    2>&1 | tee -a "${adir}/logs/launch.log" || true

  # Deploy to Vercel (production)
  info "Running vercel --prod..."
  local vercel_output
  vercel_output="$(vercel --prod --yes 2>&1 | tee -a "${adir}/logs/launch.log")"

  # Extract deployment URL
  local deploy_url
  deploy_url="$(echo "$vercel_output" | grep -Eo 'https://[a-z0-9._-]+\.vercel\.app' | tail -1 || true)"

  if [[ -z "$deploy_url" ]]; then
    deploy_url="$(vercel inspect --prod 2>/dev/null | grep -Eo 'https://[a-z0-9._-]+\.vercel\.app' | head -1 || true)"
  fi

  if [[ -z "$deploy_url" ]]; then
    deploy_url="https://${slug}.vercel.app"
    info "Could not auto-detect URL; using: ${deploy_url}"
  fi

  # Write LAUNCH_URL.md
  cat > "$(artifact_path "$slug" "LAUNCH_URL.md")" <<EOF
# Launch URL — ${slug}

Deployed: $(date)
URL: ${deploy_url}
GitHub: https://github.com/${GITHUB_USER}/${slug}
Convex: https://dashboard.convex.dev
EOF

  # Final git push
  git_commit_if_changed "$sdir" "chore: post-launch artifacts"
  git push origin main --quiet 2>&1 | tee -a "${adir}/logs/launch.log" || true

  set_state "$slug" "done"
  ok "Launched: ${deploy_url}"
  tg_stage_ok "$slug" "launch" "🎉 Live at ${deploy_url}"
  tg_send "🚀 *[${slug}]* is live!\n\n🌐 ${deploy_url}\n📦 https://github.com/${GITHUB_USER}/${slug}"
}

# ── stage: status ─────────────────────────────────────────────────────────────
stage_status() {
  local slug="$1"
  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  if [[ ! -d "$adir" ]]; then
    echo "No project found: ${slug}"
    return 1
  fi

  local state; state="$(get_state "$slug")"
  echo ""
  echo "═══════════════════════════════════════"
  echo " One Shot: ${slug}"
  echo " State:    ${state}"
  echo "═══════════════════════════════════════"
  echo " Artifacts:"
  for f in IDEA.md HIGH_LEVEL_PLAN.md BUILD_PLAN.md CRITIQUE_1.md CRITIQUE_2.md \
            REVISIONS.md APPROVAL.md TEST_RESULTS.md LAUNCH_URL.md; do
    local fpath="${adir}/${f}"
    if [[ -f "$fpath" ]]; then
      printf "  ✅ %s\n" "$f"
    else
      printf "  ⬜ %s\n" "$f"
    fi
  done
  echo "═══════════════════════════════════════"
}

# ── stage: full ───────────────────────────────────────────────────────────────
# Runs the entire pipeline end-to-end.
# In terminal mode: interactive planning loop.
# In Telegram mode: pauses at planning and approval gates.
stage_full() {
  local slug="$1"
  local mode="${2:-terminal}"  # terminal | telegram

  local sdir; sdir="$(slug_dir "$slug")"
  local adir; adir="$(artifact_dir "$slug")"

  validate_slug "$slug"

  # ── init ──
  local state; state="$(get_state "$slug")"
  if [[ "$state" == "uninitialized" ]]; then
    stage_init "$slug"
  fi

  # ── IDEA ──
  local idea_file; idea_file="$(artifact_path "$slug" "IDEA.md")"
  if [[ ! -f "$idea_file" ]]; then
    if [[ "$mode" == "terminal" ]]; then
      echo ""
      echo "Describe your idea for ${slug}:"
      echo "(Enter your idea, press Enter twice when done)"
      local idea_lines=()
      local line
      local blank_count=0
      while IFS= read -r line; do
        if [[ -z "$line" ]]; then
          (( blank_count++ ))
          (( blank_count >= 2 )) && break
        else
          blank_count=0
        fi
        idea_lines+=("$line")
      done
      printf '%s\n' "${idea_lines[@]}" > "$idea_file"
    else
      fail "IDEA.md not found. In Telegram mode, idea must be provided via /new-shot command."
    fi
  fi

  # ── plan ──
  state="$(get_state "$slug")"
  if [[ "$state" =~ ^(initialized|plan-failed)$ ]] || [[ ! -f "$(artifact_path "$slug" "HIGH_LEVEL_PLAN.md")" ]]; then
    if [[ "$mode" == "terminal" ]]; then
      stage_plan "$slug" "true"
    else
      stage_plan "$slug" "false"
      info "Telegram mode: waiting for planning approval (send /approve)"
      return 0
    fi
  fi

  # ── build-plan ──
  state="$(get_state "$slug")"
  if [[ ! -f "$(artifact_path "$slug" "BUILD_PLAN.md")" ]]; then
    stage_build_plan "$slug"
  fi

  # ── critique ──
  if [[ ! -f "$(artifact_path "$slug" "CRITIQUE_2.md")" ]]; then
    stage_critique "$slug"
  fi

  # ── approval gate ──
  state="$(get_state "$slug")"
  if [[ "$state" != "approved" && "$state" != "built" && "$state" != "tested" && "$state" != "done" ]]; then
    if [[ "$mode" == "terminal" ]]; then
      echo ""
      echo "═══════════════════════════════════════════════════"
      echo " BUILD PLAN APPROVAL REQUIRED"
      echo "═══════════════════════════════════════════════════"
      echo " Review: $(artifact_path "$slug" "BUILD_PLAN.md")"
      echo " Review: $(artifact_path "$slug" "CRITIQUE_2.md")"
      echo ""
      read -rp "Approve build? (yes/no): " answer
      if [[ "$answer" =~ ^(yes|y)$ ]]; then
        cat > "$(artifact_path "$slug" "APPROVAL.md")" <<EOF
approved: yes
approved_by: terminal
approved_at: $(date)
EOF
      else
        fail "Build not approved. Pipeline halted."
      fi
    else
      info "Telegram mode: waiting for /build command"
      return 0
    fi
  fi

  stage_approve "$slug"

  # ── build ──
  state="$(get_state "$slug")"
  if [[ ! "$state" =~ ^(built|tested|done)$ ]]; then
    stage_build "$slug"
  fi

  # ── test ──
  state="$(get_state "$slug")"
  if [[ ! "$state" =~ ^(tested|done)$ ]]; then
    if ! stage_test "$slug"; then
      stage_fix "$slug" 3
    fi
  fi

  # ── launch ──
  state="$(get_state "$slug")"
  if [[ "$state" != "done" ]]; then
    stage_launch "$slug"
  fi

  ok "Pipeline complete for: ${slug}"
}

# =============================================================================
# ENTRY POINT
# =============================================================================
usage() {
  cat <<EOF
Usage: $(basename "$0") <slug> <stage> [options]

Stages:
  init          Clone template, init git, create GitHub repo
  plan          Generate HIGH_LEVEL_PLAN.md (--terminal for interactive loop)
  plan-feedback "<feedback text>"  Update plan with feedback (Telegram mode)
  build-plan    Generate detailed BUILD_PLAN.md
  critique      Run critic/revision cycle → CRITIQUE_1.md, CRITIQUE_2.md
  approve       Verify APPROVAL.md has 'approved: yes'
  build         Implement BUILD_PLAN, deploy Convex
  test          Run build tests → TEST_RESULTS.md
  fix           Iterate on test failures
  launch        Deploy to Vercel, write LAUNCH_URL.md
  status        Show current state and artifacts
  full          Run entire pipeline end-to-end

Options:
  --terminal    Use terminal for interactive steps (plan, full)

Example:
  $(basename "$0") my-app init
  $(basename "$0") my-app plan --terminal
  $(basename "$0") my-app full --terminal
EOF
}

main() {
  local slug="${1:-}"
  local stage="${2:-}"
  local opt="${3:-}"

  [[ -z "$slug" || -z "$stage" ]] && { usage; exit 1; }
  [[ "$slug" == "--help" || "$slug" == "-h" ]] && { usage; exit 0; }

  validate_slug "$slug"

  case "$stage" in
    init)
      stage_init "$slug"
      ;;
    plan)
      local terminal_mode="false"
      [[ "$opt" == "--terminal" ]] && terminal_mode="true"
      stage_plan "$slug" "$terminal_mode"
      ;;
    plan-feedback)
      local feedback="${3:-}"
      [[ -z "$feedback" ]] && fail "Usage: $0 <slug> plan-feedback \"<feedback text>\""
      stage_plan_feedback "$slug" "$feedback"
      ;;
    build-plan)
      stage_build_plan "$slug"
      ;;
    critique)
      stage_critique "$slug"
      ;;
    revise)
      # Revise is incorporated into critique; kept for compatibility
      require_artifact "$slug" "BUILD_PLAN.md"
      require_artifact "$slug" "CRITIQUE_1.md"
      info "Revise is run as part of the critique stage."
      ;;
    approve)
      stage_approve "$slug"
      ;;
    build)
      stage_build "$slug"
      ;;
    test)
      stage_test "$slug"
      ;;
    fix)
      local max_iter="${opt:-3}"
      stage_fix "$slug" "$max_iter"
      ;;
    launch)
      stage_launch "$slug"
      ;;
    status)
      stage_status "$slug"
      ;;
    full)
      local mode="terminal"
      [[ "$opt" == "--telegram" ]] && mode="telegram"
      stage_full "$slug" "$mode"
      ;;
    *)
      echo "Unknown stage: ${stage}"
      usage
      exit 1
      ;;
  esac
}

main "$@"
