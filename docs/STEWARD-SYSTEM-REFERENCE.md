# The Steward System — Complete Reference

**Purpose of this document:** independent, context-free reference for the AI-native board
system built July 2026. Written so a human or coding agent with zero conversation history
can understand what exists, how it works, where it runs, and what's left. Assume nothing
else is loaded.

**Companion docs (read in this order for full context):**
1. `docs/product/board-opportunity-map.md` — the evidence: 8 months of a real HOA board's
   email, mined into recurring pain (referenced below as *OM §n*).
2. `docs/product/ai-native-board-prd.md` — the product spec this implements (*PRD §n*).
3. `docs/product/phase-3-4-plan.md` — v1 scopes for the later phases.
4. `docs/beta-environment-runbook.md` — the beta deployment environment.

---

## 1. What this is

Happier Block started as an HOA inspection tool (walkthrough photos/notes → AI-summarized
findings → letters). It is evolving into an **AI-native HOA board platform**: volunteer
board members provide judgment, votes, and oversight; **deterministic tools** are the only
way state changes; a proactive agent (**the Steward**) does the operational labor, checked
by an internal verification agent (**the Reviewer**). Design partner: Ridge Top Terrace
(RTT), a 120-unit Fairfax VA HOA whose board includes the product's developer.

**Core architectural creed** (violate nothing here):
- The agent cannot free-write state. Every effect is a typed tool call into a guarded
  Convex mutation, and every effect lands in an append-only audit trail.
- Autonomy is earned per **action type** on a ladder (L0 watch → L1 draft → L2 ask-first →
  L3 auto+log) with **hard ceilings enforced in code**, never in prompts.
- Deterministic wherever facts suffice; LLM only where prose matters — always behind the
  Reviewer for anything consequential.
- Nothing outward (email to a homeowner/PM) is ever sent automatically. On the beta
  environment, email sending is physically impossible (no `RESEND_API_KEY`).
- Hearings outcomes, fines, and legal escalation are human-only, permanently.
- Silence is distinguishable from failure: every agent run writes a record even when
  nothing happened.

---

## 2. Environments & deployment topology (read this before touching anything)

### 2.1 The three Convex deployments

| Deployment | Role | ⚠️ |
|---|---|---|
| `glorious-turtle-400` (team take-one-shot, project hoa-inspection-helper, **dev**) | **THE LIVE PRODUCTION BACKEND.** happierblock.com's bundle points here. Local `npx convex dev` pushes straight to it. | **Never run `npx convex dev` or `deploy` from beta-lineage branches** — you would push unreleased schema/functions into the live product. |
| `dashing-goldfinch-750` (same project, **prod**) | Unused, empty. Historical accident. | A bare `npx convex deploy` in this repo targets THIS (or worse). `convex deploy` **ignores `CONVEX_DEPLOYMENT`** — proven by dry-run. Only `CONVEX_DEPLOY_KEY` selects a deploy target safely. |
| `industrious-avocet-551` (project happier-block-beta, prod deployment) | **The beta backend.** Seeded from a live-data snapshot (552 docs incl. 190 real properties). | CLI access: prefix commands with `CONVEX_DEPLOYMENT=prod:industrious-avocet-551` (works for `data`, `env`, `run`, `import` — NOT for `deploy`). |

### 2.2 Git branches

| Branch | Contents |
|---|---|
| `master` | The live product (Vercel production branch; pushes auto-deploy happierblock.com's frontend). Letter-template/no-violations work lives here. |
| `beta` | **The long-lived beta track**: master + case tracking + petrol/paper redesign + all Steward work + product docs. Deploys to beta.happierblock.com on push. Pull live fixes with `git merge master`. Features graduate via flag-gated PRs beta→master. |
| `steward-foundation` | Feature branch where the Steward was built; fully merged into `beta`. New agent work: branch off `beta`. |
| `product-research` | Docs-only lineage (opportunity map, PRD); merged into beta. |
| `ui-redesign`, `case-tracking` | Historical; contents merged into beta via ui-redesign. |

### 2.3 Vercel (ONE project: `hoa-inspection-helper`, team `team_ptsZF7v5fuiMKQ3ES6vdrabj`, project `prj_XxpVkQMG5EOy9zEE13s4Wh8KhheE`)

- Production branch = `master` → happierblock.com (+ www).
- Branch domain `beta.happierblock.com` → `beta` branch (Vercel nameservers; DNS automatic).
- **Env scoping is the isolation mechanism**: `VITE_CONVEX_URL` (live backend URL) is
  Production-scope ONLY. Preview scope carries the shared Clerk publishable key + upload
  URL. `CONVEX_DEPLOY_KEY` (beta project's key) is Preview-scoped, pinned to branch `beta`.
- **Build routing** is `package.json`'s `vercel-build` script:
  production → plain `npm run build` (byte-identical to before);
  preview **with** `CONVEX_DEPLOY_KEY` (= beta branch) → `npx convex deploy
  --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build'` (backend + frontend deploy
  atomically); preview **without** a key (any other branch) → plain build with no backend
  attached (safe dead shell).
- **Known open issue:** Vercel deployment protection gates branch domains (the
  "all_except_custom_domains" mode only exempts production domains), so
  beta.happierblock.com 302s to a Vercel login until Vercel Authentication is disabled for
  the project (or a Pro-plan protection exception is added for the domain). See §8.

### 2.4 Beta backend environment (`industrious-avocet-551`)

Set: Clerk trio (SAME production Clerk instance as live — the snapshot's user IDs require
it; beta.happierblock.com must be in Clerk's allowed origins), `OPENAI_API_KEY`,
`UPLOAD_SERVER_URL` + `VITE_UPLOAD_DELETE_TOKEN` (SHARED VPS store — deleting a photo from
beta deletes the real file), `PUBLIC_BASE_URL=https://beta.happierblock.com`, fresh
`DEMO_SEED_SECRET`/`PLATFORM_BOOTSTRAP_SECRET`. **Deliberately absent: `RESEND_API_KEY`**
— snapshot data contains real homeowner emails; all sends must fail visibly. Any future
email path must tolerate the key's absence (resend.sendEmail returns `{success:false}`,
never throws).

### 2.5 LLM configuration

All model calls go through `convex/llm.ts` → `internal.llm.generateText`, keyed by **model
role**, resolved from env: `LLM_PROVIDER` (default `openai`) and `LLM_MODEL_<ROLE>`
overrides. Roles → defaults: `bullets`/`chat`/`copilot`/`intakeTriage`/`reviewer` =
gpt-4o-mini, `arcReview` = gpt-4.1-mini, `steward` = gpt-4o. Provider implementations live
in `convex/lib/llmProviders.ts` (OpenAI Responses API today; adding Anthropic/OpenRouter =
one function + registry entry, zero caller changes). `convex/openai.ts:generateText` is a
deprecated back-compat wrapper; `transcribeAudio` (Whisper) still lives there.

---

## 3. The Steward architecture

### 3.1 The findings pipeline (the deterministic monitor)

**Detectors → deduplicated findings queue → playbook routing → consumers.** The agent
never scans the world; it reads this queue.

- **Sweep detectors** (`convex/steward.ts:detect`, run by the daily-sweep cron, per HOA
  with the `steward` flag): `case_overdue` (cases.actionDueAt past, case open),
  `arc_aging` (ARC submission >7d without verdict), `deadline_unverified` (compliance
  deadline past due; deterministically escalates the deadline as a side-effect),
  `motion_stalled` (open >3d below quorum), `email_quarantined`, `fix_photo_pending`,
  `work_order_stalled` (quote/approved untouched 14d), `inspection_ready_for_review`
  (property status "review").
- **Event detectors** (fired from email intake, via `steward.createEventFinding`):
  `concurrence_needs_match`, `deadline_evidence_maybe`, `financial_packet_review`.
- **Dedupe:** every finding has `dedupeKey` (`kind:refId`); re-detection refreshes
  `lastSeenAt` instead of duplicating.
- **Self-healing:** sweep findings whose condition disappeared are auto-resolved each
  sweep (including dismissed ones, so real recurrences fire fresh). **Event findings are
  exempt** (`findings.source === "event"`) — no detector re-asserts them; they close by
  human dismissal.
- **Routing** (`convex/lib/stewardPlaybooks.ts`): each kind → `awaiting_human` (lands on
  the Desk; a human surface exists or judgment is human-only) or `awaiting_agent` (the
  Steward's LLM duties consume it). **Unknown kinds default to the agent.**

### 3.2 The two agents

- **The Steward** — the single user-facing agent identity. Duties implemented: **sweep**
  (detection), **chase** (drafting PM follow-ups from `case_overdue` findings), **triage**
  (email classification/filing/reply drafts/concurrence capture), **review** (financial
  question drafts), **digest** (weekly rollup), **recall** (ask-the-record), plus
  deterministic board-reminder nudges.
- **The Reviewer** — internal verification agent, never user-facing. Sees the task's
  deterministic context bundle + the Steward's OUTPUT (never its reasoning), runs at
  temperature 0, returns strict-JSON verdicts.
- **The shared pipeline** (`convex/lib/stewardPipeline.ts:draftWithReview`): Steward pass →
  **code prechecks** (cheap; run before spending a Reviewer call — address present, word
  bounds) → Reviewer pass → reject-with-reasons feeds ONE retry → exhausted = the caller
  records a `needs_human` proposal with both agents' artifacts. Used by: chase, intake
  reply drafts, financial question drafts.

### 3.3 The autonomy ladder (`convex/lib/stewardAutonomy.ts`)

Per **action type**: L0 observe / L1 draft / L2 act-on-approval / L3 auto+log.
`AUTONOMY_DEFAULTS` (conservative) and `AUTONOMY_CEILINGS` (hard caps clamped in code).
Action types: `internal_note` (L3/L3), `board_reminder` (L3/L3), `pm_status_check`
(L2/L3), `file_intake_case` (L2/L3), `homeowner_letter` (L1/L2), `stage_transition`
(L2/L2 — never automatic), `hearing_notice` (L2/L2), `open_motion` (L2/L3), `email_reply`
(L1/L2), `record_concurrence` (L2/L3), `financial_questions` (L1/L2). Per-HOA overrides in
`stewardConfig` table; `stewardConfig.setLevel` clamps to ceilings and logs the change to
the audit trail. Settings UI (`StewardAutonomySection.tsx`) shows the ladder with each
type's approve/edit/reject track record.

### 3.4 Proposals (the approval queue)

`stewardProposals` rows are Reviewer-verified drafts awaiting the board. Created by
`stewardChase.recordProposal` (generalized: actionType, duty, trigger, optional
finding/case/property/email/motion refs, concurrence payload). Statuses:
`pending_approval` → `approved`/`rejected`, or `needs_human` (Reviewer rejected the
Steward twice). **One active proposal per finding + 7-day cooldown after decisions** (no
daily re-drafting). `proposals.approve` executes **per action type**:
- `pm_status_check` / `email_reply` / `financial_questions`: logs the (possibly edited)
  text to the case timeline as an internal `noteAdded` caseEvent and returns it for
  clipboard — the human sends it.
- `record_concurrence`: applies the evidence-linked vote to the motion with quorum math.

### 3.5 The decision log (`convex/motions.ts`)

Motions: open (quorum defaults to majority of admin+board members) → human votes
(`Concur`/`Object`/`Abstain`; latest vote wins while open) → auto-pass at quorum yes /
auto-fail at quorum no / manual expire. `recordConcurrence` enters email/text votes as
evidence-linked entries (viaInboundEmailId). `ratificationList` = passed, non-meeting,
unratified motions → feeds agendas. Votes are human-only; the Steward may open motions
(L2) and record evidence, never vote.

### 3.6 Email intake (`convex/emailIntake.ts`)

Address scheme `cases-<hoaSlug>[+caseId]@<domain>`; idempotent on messageId; unknown
senders quarantined, never dropped. **HARD CEILING: email can only ADD information** —
open a case or append an event; never advance stages/notices/hearings/fines.
Triage (single gpt-4o-mini call) returns summary/title/property-match/**category**
(violation|arc|vendor|financial|complaint|privileged|concurrence|noise|other) +
concurrenceVote. Category effects:
- **privileged** → the case event is REDACTED at write time ("content withheld") with
  `visibility: "internal"`, and the stored aiSummary is redacted. Drafting contexts read
  caseEvents (never raw emails), so leakage is structurally impossible.
- **arc** → files into an open architectural case or opens one (caseType architectural);
  **complaint** → complaint; **vendor/financial** → other; default violation.
- **concurrence** (from an admin/board member, steward flag on): exactly one open motion →
  deterministic L2 `record_concurrence` proposal; multiple → `concurrence_needs_match`
  event finding.
- **noise** (no case route) → processed, nothing touched.
- **financial** → `financial_packet_review` event finding (recurring-checks checklist in
  detail) + L1 `financial_questions` draft via the pipeline.
- Homeowner-of-record emails filed to a case (violation/complaint/other) → L1
  `email_reply` acknowledgment draft (skips silently on pipeline failure — a reply is
  optional, not owed).
- Watch hook: subject/summary keyword overlap (≥2 words >3 chars) with an open deadline's
  title → `deadline_evidence_maybe` event finding.

### 3.7 Crons (`convex/crons.ts`)

Daily: sweep 11:00 UTC → nudges 11:15 → chase 11:30. Weekly digest Monday 12:00 (rolls up
the queue + week's actions; **samples up to 5 unverdicted L3 actions post-hoc** —
invariant checks today, the slot for LLM sampling when L3 LLM-actions exist). Every job
no-ops for HOAs without the `steward` flag (**the kill switch**) and writes an `agentRuns`
row regardless.

### 3.8 Audit trail

`agentRuns` (one per invocation: agent, duty, trigger, model, status, counts) +
`agentActions` (one per effect: toolName, argsSummary — human-readable, never raw
payloads — autonomyLevel, reviewerVerdict approved/rejected/sampled/exempt, outcome
observed/executed/queued/rejected/needs_human, entity refs). This is the cross-entity
audit log; `caseEvents` remains the case-scoped append-only trail (sole writer
`lib/caseEvents.ts:logCaseEvent`; never edit/delete).

### 3.9 Supporting modules

- **Compliance calendar** (`convex/deadlines.ts` + `lib/complianceLibrary.ts`): deadlines
  with evidence-REQUIRED verification; unverified past-due auto-escalate; one-tap seeding
  of the VA-HOA standard set (SCC report, DPOR license, quarterly taxes ×4, audit, data
  call, meeting notices).
- **Meetings** (`convex/meetings.ts`): `assembleAgenda` + `draftMinutesScaffold` —
  fully deterministic markdown from agendaItems + ratifications + open motions + queue
  counts / decided motions with vote records. No LLM by design.
- **Agenda accretion** (`convex/agendaItems.ts`): add/setStatus/list.
- **Work orders** (`convex/workOrders.ts`): quote→approved→scheduled→done (done requires
  a verification note); approval can link a motion.
- **Ask the record** (`convex/askRecord.ts`): grounded Q&A over motions/deadlines/agenda/
  workflow ladders/aiConfig guidelines (prompt-stuffed, 24k char budget), cites what it
  relies on, logged as duty `recall`. No Reviewer (read-only).

### 3.10 UI surfaces

- **The Desk** (`src/pages/admin/Desk.tsx`, route `/admin/desk`, nav gated on `steward`
  flag, roles admin+board): "For your approval" (proposals: draft, "what the Steward saw"
  context, edit/approve-and-copy/reject; needs_human cards show both agents' artifacts) ·
  "Your vote" (motions + new-motion form + ratification list) · "Needs you"
  (awaiting_human findings with per-kind deep links + dismiss) · "Queued for the Steward"
  (awaiting_agent) · rail: Deadlines (add/verify/seed), Agenda, Meeting tools
  (agenda/minutes copy), Vendor work, Ask the record, Steward activity feed.
- **Settings** → "The Steward's autonomy" table (`StewardAutonomySection.tsx`).
- Nav (`AdminShell.tsx`): Desk · Properties · Walkthrough · Cases (flag `cases`) ·
  Settings.

### 3.11 New tables (all in `convex/schema.ts`, heavily commented)

`findings`, `stewardProposals`, `motions`, `deadlines`, `agendaItems`, `workOrders`,
`agentRuns`, `agentActions`, `stewardConfig`; plus `inboundEmails.category` and feature
flag `"steward"` (union in `lib/featureFlags.ts`: cases | emailIntake | steward).

---

## 4. What existed before the Steward (context for the whole app)

- **Inspections** (the original product, LIVE in production; the RTT board ran its June
  2026 cycle in it): streets/properties/photos/notes → AI bullets → letter generation
  (two templates: violation + no-violations via `noViolationsConfirmed`) → PDF export.
  Inspector mobile flow is offline-first (Dexie outbox, Capacitor iOS wrap).
- **Case tracking** (built, beta-only): cases with data-driven stage ladders
  (`caseWorkflows`), append-only caseEvents, hearings, fines, notices, work queue, routed
  case page, homeowner portal + fix photos, board view, company/portfolio roles.
- **ARC applications**: upload/homeowner submission + AI review with verdicts.
- **Copilot** (`convex/copilot.ts`): reactive staff Q&A tools — the Steward is its
  proactive successor; both coexist.

---

## 5. Current deployment state (as of 2026-07-13)

✅ Beta backend `industrious-avocet-551`: all functions + crons deployed (via the beta
branch's Vercel build), env complete (note: user's `OPEN_API_KEY` typo was renamed to
`OPENAI_API_KEY`), snapshot data loaded (RTT + Demo HOA + Cohoon Estates; 190 properties).
✅ `beta`, `product-research`, `steward-foundation`, `ui-redesign` pushed to GitHub.
✅ Clerk: beta domain added to allowed origins (shared prod instance).
⬜ **beta.happierblock.com is behind Vercel SSO** (deployment protection gates branch
domains). Fix: disable Vercel Authentication for the project, or add a Pro-plan protection
exception for the domain. Until then the frontend is unreachable (backend works).
⬜ **No HOA has the `steward` flag yet.** Flip at beta.happierblock.com/`/platform` →
Ridge Top Terrace (platform admin required) — also consider `cases` + `emailIntake`.
⬜ First sweep not yet run. Can be triggered without waiting for cron:
`CONVEX_DEPLOYMENT=prod:industrious-avocet-551 npx convex run steward:dailySweep`
⬜ GitHub `master` branch protection not yet enabled.
⬜ VPS `ALLOWED_ORIGIN` — confirm `https://beta.happierblock.com` was appended and the
upload service restarted (photos won't load/upload on beta otherwise).

---

## 6. What's deliberately NOT built yet (the roadmap remainder)

1. **Hearing scheduler** (PRD §7.2 — the last Phase 1 gap): candidate slots → statutory
   notice-day math from `caseWorkflows` enforced in the mutation → availability polling →
   notice generation. Kills the date-ping-pong loop (OM §2.1).
2. **PM seat**: invite the management company PM (companyMemberships machinery exists) so
   her letter/notice work becomes case events.
3. **Chase playbooks as LLM drafts for more kinds** (arc_aging/motion_stalled currently
   get deterministic nudges only; outward vendor chases for stalled work orders).
4. **Event-driven finding emission** beyond email (detection latency is one sweep today).
5. **L3 execution semantics for outward actions**: today even L3-promoted `pm_status_check`
   proposals land as pending_approval (nothing sends without a human; revisit when email
   rails exist on a real production rollout).
6. **Meetings v2**: meetings table, T-7 auto-assembly, LLM prose polish. **Financial v2**:
   PDF attachment parsing (attachments aren't stored today), cross-month reconciliation.
   **Memory v2**: uploaded governing-docs library + embeddings RAG.
7. **Metrics instrumentation** (PRD §12): follow-up-email count, time-to-hearing, ARC
   turnaround vs the corpus baselines.
8. **Graduation to production** (PRD §13): flag-gated PRs beta→master once beta metrics
   hold. Also: migrate the live product OFF the dev deployment (`glorious-turtle-400`) —
   currently any local `npx convex dev` on master-lineage pushes to the live app.
9. Mobile app: untouched by all Steward work (admin/board web surfaces only).

---

## 7. Working conventions for whoever picks this up

- Branch off `beta`; commit per verified slice; `npx tsc --noEmit` + `npx eslint <touched
  files>` + `npm run build` before every commit. `npx convex codegen` after schema/function
  changes.
- **Never** run `npx convex dev` or bare `npx convex deploy` from beta-lineage branches
  (see §2.1). Deploys to beta happen ONLY by pushing the `beta` branch (Vercel builds it).
- CLI reads/writes against beta: `CONVEX_DEPLOYMENT=prod:industrious-avocet-551 npx convex
  data|env|run ...`.
- Never import beta data back into the live backend. Refresh beta from live:
  `npx convex export --path snap.zip` (default target IS the live backend) then
  `CONVEX_DEPLOYMENT=prod:industrious-avocet-551 npx convex import snap.zip --replace-all`.
- New agent capability = new TOOL (guarded mutation) + action type on the ladder +
  playbook route + audit rows. Never let a prompt enforce a rule code can enforce.
- Real homeowner data lives in beta: never wire an email path that doesn't fail safe
  without `RESEND_API_KEY`; redact privileged content at WRITE time, not display time.
- The permission pattern for Convex access: queries/mutations use
  `requireViewerRole(ctx, ["admin", "board"])` (from `lib/tenantAuth.ts`) + feature flag
  checks (`requireFeature`). Internal functions carry no auth — never expose one that
  writes without a guarded public wrapper.

## 8. Quick verification playbook (once the SSO blocker clears)

1. beta.happierblock.com loads; browser network tab shows the WebSocket to
   `industrious-avocet-551.convex.cloud` (NEVER `glorious-turtle-400`).
2. Sign in with a normal account (shared Clerk) → memberships resolve from the snapshot.
3. `/platform` → RTT → enable `steward` → Desk appears in nav.
4. Trigger the sweep (CLI above) → Desk "Needs you" populates (expect: properties in
   review, any pending fix photos); "Queued for the Steward" gets overdue cases if any
   have `actionDueAt` set.
5. Trigger `stewardChase:run` → a drafted PM follow-up lands in "For your approval";
   check "what the Steward saw", approve, confirm the caseEvent note.
6. Open a motion from the Desk, vote it to quorum, watch it pass and appear in the
   ratification list and minutes scaffold.
7. Seed the compliance calendar; back-date one deadline via the dashboard to watch
   escalation + the Desk finding on the next sweep.
8. Ask the record: "did we approve <the motion you just passed>?" — expect a cited answer.
9. Confirm a letter "send" fails visibly (Resend absent) — that's correct behavior.
