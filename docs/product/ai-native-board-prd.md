# PRD: The AI-Native HOA Board

**Status:** Draft v1 · July 2026 · lives on the `product-research` branch, built on the `beta` track
**Evidence base:** [`board-opportunity-map.md`](./board-opportunity-map.md) — 8 months of a real board's email (Dec 2025–Jul 2026, ~165 threads). Sections there are cited as *OM §n*; this doc does not restate the evidence.

---

## 1. Summary & thesis

An HOA board today is three volunteers state-tracking dozens of open loops through personal
inboxes (OM §1). The product turns that board into an **AI-native entity** with three parts:

1. **Board members** — provide judgment, votes, and oversight. That is *all* they should
   have to provide.
2. **Deterministic tools** — the system of record (cases, hearings, decisions, deadlines,
   letters) and the *only* way state changes. Every state change is a typed, guarded
   operation that leaves an append-only event.
3. **The Steward** — one named, proactive agent that does the operational labor: files what
   comes in, chases what's stale, drafts what's due, watches what's dated, and preps what's
   next — always through the tools, always within a board-set autonomy budget, and always
   behind an internal verification agent (**the Reviewer**) that checks its work before
   anything consequential lands.

The thesis: volunteer boards don't fail for lack of diligence — RTT's board caught eight
financial errors by hand-diffing PDFs (OM §2.3) — they fail because diligence doesn't scale
and doesn't survive vacations. Deterministic tools make the state legible; the agent makes
the diligence continuous; the oversight model keeps the board sovereign.

**Success looks like:** the president stops writing "following up again" emails, decisions
stop evaporating, deadlines stop expiring silently, and the board's monthly time drops from
"a part-time job" to "read the digest, tap approve, vote."

## 2. Personas

### 2.1 Primary: the volunteer board member

One persona, three lived archetypes observed in the corpus (OM §1):

| Archetype | Corpus example | Jobs to be done | What breaks today |
|---|---|---|---|
| **The Load-Carrier** (president) | Initiates ~70% of threads; tracks open items by hand; chases everyone | Keep every loop moving; be the institutional memory; stay compliant | Their memory *is* the system. Every open loop is mental weight. Burnout is the failure mode. |
| **The Reviewer** (treasurer) | Reviews financials line-by-line; drafts sit in Drafts for weeks; gathers agenda items across threads | Verify the money; keep the record (minutes, motions); assemble meetings | Bursty volunteer time; no queue to return to — work lost in inbox/drafts. |
| **The Part-Timer** (member) | Missed ARC reviews for weeks ("Sorry I missed this"); votes when asked | Show up for votes, hearings, assigned reviews | Nothing tells them what needs *them*; silence looks like absence, not a queue. |

**Shared context:** volunteer time is bursty and asynchronous; vacations break quorum
(a fact the system must know, OM §2.2); they speak board vocabulary — *concurrence,
ratification, FYSA, data call* — and the product must too.

**Persona promise:** a board member opens one surface (the Desk, §6) and sees exactly what
needs their judgment, with everything else already done, drafted, or watched — and an audit
trail that proves it.

### 2.2 Secondary: the management-company PM

Krystal-shaped (OM §1): executes letters, notices, mailings, records requests for many
associations at once. Not an adversary to route around — the most active participant in
every loop. Gets a member seat (company role exists: `companyMemberships`), her work becomes
case events, and the Steward's chase duty replaces the president's nagging with structured,
polite, logged follow-ups. Long-term she is the beachhead for a portfolio product (parked).

### 2.3 Tertiary: the homeowner

Already served by the property-scoped portal. Their interactions (fix photos, ARC
applications, complaints, chat) are inputs and outputs of the same case machinery; the
portal is the paper trail that email never was (OM §2.7, the "phantom promise" tenant).

### 2.4 Anti-personas / what we are not

- **Not an accounting system.** Enumerate/Capitol own ledgers and money movement. We review,
  reconcile expectations, and ask questions (OM §3 #7) — we never post entries or move funds.
- **Not the management company.** We coordinate and verify their work; we don't replace it.
- **Not an autonomous enforcer.** Fines, hearings, and legal escalation are human decisions,
  permanently.

## 3. Product principles

1. **Deterministic tools only.** The agent cannot free-write state. Every effect is a typed
   tool call mapped to a guarded Convex mutation, and every mutation leaves an append-only
   event (`caseEvents` today; `agentActions` for everything else, §8.5). If a capability
   isn't a tool, the agent doesn't have it. This is the hallucination-containment boundary.
2. **Autonomy is earned, per action type.** The ladder (§4.2) starts conservative; the board
   promotes an action type only after a track record of clean approvals (§13). One tap
   demotes anything back to draft-only. A `steward` feature flag is the kill switch.
3. **Verified before consequential.** The Steward's outward-facing and state-changing work
   passes the Reviewer (§5) before it executes or reaches the board. The board sees one
   agent; the system runs two.
4. **Email-native adoption.** The board's behavior doesn't change on day one: they forward
   mail exactly as they forward FYSA today, and the system files it (OM §5 Stage 2). The
   product absorbs email; it doesn't demand migration from it.
5. **Auditable and reversible.** Every agent thought that became an action is inspectable:
   who (which agent), what (tool + args), why (trigger + cited sources), verdict (Reviewer),
   outcome. Nothing the agent does is silent, and errors surface on the Desk — never in a log
   nobody reads.
6. **Board vocabulary, board sovereignty.** UI speaks concurrence/ratification/motion, and
   the deterministic record is designed to *be* the board's legal record (minutes evidence,
   ratification lists, notice proof).
7. **Provider-swappable intelligence.** Models are configuration, not architecture (§11.1).

## 4. The Steward — agent specification

### 4.1 Identity & duties

One user-facing agent identity per HOA. It acts as `actorRole: "system"` (already in the
`caseEvents` union) with a distinct agent id, has a visible activity feed, and writes in a
consistent, plain voice. Duties arrive by phase:

| Duty | What it does | Trigger | Phase |
|---|---|---|---|
| **Triage** | Classify + file inbound email: case / ARC / vendor / financial / **privileged** / noise; link to property; draft the reply or filing | Inbound email webhook (exists) | 2 |
| **Chase** | Detect stale work (case `actionDueAt` passed, stage `dueInDays` exceeded, ARC unanswered, availability unanswered, deadline unverified) and send the follow-up the president sends today | Daily cron sweep | 2 |
| **Draft** | Produce notices, letters, replies, hearing notices with statutory notice-day math recomputed from workflow data | Case reaching a stage that `requiresNotice`; board request | 2 |
| **Watch** | Track compliance deadlines; hunt intake/records for evidence of completion; escalate the unverified | Daily cron + intake events | 3 |
| **Prep** | Accrete agenda items all cycle; assemble agenda (incl. pending ratifications); draft minutes with motions/seconds prefilled; weekly digest | Weekly cron + meeting T-7 | 3 |
| **Review** | Ingest monthly financial packet; reconcile recurring expectations; draft clarification questions (never judgments) | Monthly packet arrival | 4 |

### 4.2 The autonomy ladder

Every **action type** (not every action) has a level, configurable per HOA on the Desk:

- **L0 Observe** — read and surface only.
- **L1 Draft** — produce the artifact; a human sends/applies it.
- **L2 Act-on-approval** — fully prepared action in the Desk approval queue; one tap executes.
- **L3 Auto-act + log** — executes automatically; logged, visible in the feed, sampled by
  the Reviewer post-hoc; weekly digest summarizes.

**Defaults (conservative):**

| Action type | Default | Ceiling | Notes |
|---|---|---|---|
| Internal notes, case links, classifications | L3 | L3 | Reversible, internal |
| Reminders/digests to board members | L3 | L3 | The system talking to its own principals |
| Status-check email to PM / vendor | L2 | L3 | The "chase" that eats the president today |
| Filing intake into a new case | L2 | L3 | Creation is additive; never advances stages |
| Homeowner-facing letters & notices | L1 | L2 | Outward + legal weight |
| Stage transitions | L2 | **L2** | Never automatic; workflow gates still apply |
| Hearing scheduling (notice send) | L2 | L2 | Notice math Reviewer-verified |
| Opening a concurrence/vote | L2 | L3 | Proposing is safe; voting is human-only |
| Hearings outcomes, fines, legal escalation | — | — | Not agent actions. Human only, forever. |

## 5. The Reviewer — verification agent

A second, internal agent whose sole mission is to check the Steward's work before tasks
finish. Never user-facing; the board experiences it only as quality and as verdicts in the
audit trail.

- **Independence:** separate prompt and context. It receives the task inputs (source
  records, the triggering event, the governing workflow/policy data) and the Steward's
  *output* — not the Steward's reasoning — so it re-derives rather than rubber-stamps. It
  may run a different (often cheaper) model per tier (§11.2).
- **Gate rules by tier:**
  - **L2 proposals and every outward-facing draft (L1 included):** must carry a Reviewer
    approval verdict before appearing on the Desk or executing. No verdict → no action.
  - **L3 auto-actions:** cheap pre-execution checks (addressee/property match, tool-call ↔
    intent match) plus post-hoc audit sampling.
  - **L0/L1 internal notes:** exempt.
- **Checklist, per duty** (deterministic where possible — math is recomputed in code, not
  judged by the model): facts cited to source records; statutory/notice-day math recomputed
  from `caseWorkflows` data; addressee + property + case correctness; tone/policy compliance
  against HOA config (`aiConfig`); privilege/PII leak check (nothing from privileged-tagged
  sources in outward drafts); tool call matches stated intent.
- **Outcomes:** *approve* → proceed; *reject-with-reasons* → Steward retries (max 2);
  exhausted → the item lands on the Desk as **"needs human"** with both agents' artifacts
  attached. Every verdict is a row in `agentActions`, so the board can audit both agents —
  including the Reviewer's misses.

## 6. Board oversight surfaces

**The Desk** (evolution of the Cases work-queue's three lanes) — the one place a board
member starts:

1. **Approvals** — L2 proposals, Reviewer-verified, one-tap execute / edit / reject
   (rejection reason feeds the Steward's record).
2. **Your vote** — open concurrences/motions with quorum state ("Jugnu is away until
   7/17 — 2 of 2 available votes recorded").
3. **Needs human** — Reviewer-rejected items, agent errors, unclassifiable intake
   (absorbs today's quarantine strip).
4. **The digest** — weekly summary of everything the Steward did at L3, watched deadlines,
   aging cases.

Plus: a **Decision Log** page (§8.4), the **Steward activity feed** (every `agentActions`
row, filterable by agent/duty/verdict), and **Autonomy settings** in Settings (the ladder
table, per action type, with each type's track record shown next to its lever).

## 7. Phase 1 — "The loops are tracked" (build-ready)

Everything here is deterministic; most exists on `ui-redesign` and ships via the beta track
(§13). Net-new is scheduling machinery.

**7.1 Promote case tracking + hearings** (built: cases, configurable ladders, hearings,
fines, notices, timelines, fix-photo review, routed case page).
- *Acceptance:* the three live sagas (11403 Abner, 11493 Abner, towing repeat-violator —
  OM §2.1) are seeded as cases with true history; any board member answers "what's the
  status?" from the case page in <10 seconds; every stage change is a caseEvent.

**7.2 Hearing scheduler.** Today: 5-email date ping-pong + hand-computed 15-day notice
(OM §2.1). New: from a case whose stage `requiresHearing`, board picks candidate slots →
system computes the earliest legal date from workflow notice-days → availability requests go
to members → responses recorded in-app (email reply capture arrives with Phase 2 intake) →
quorum met ⇒ notice generated for approval, `hearings` row created, calendar entry offered.
- *Data delta:* `availabilityPolls` (or fields on `hearings`): candidateSlots[],
  responses[{memberId, slotKeys[]}], status.
- *Acceptance:* scheduling 11403's hearing takes one board action (pick slots) + one tap per
  member; the notice date can never violate the workflow's notice-day requirement (enforced
  in the mutation, not the prompt).

**7.3 PM seat.** Invite the PM via existing company/member machinery; letters, notices,
mailings she executes are logged as case events attributed to her.
- *Acceptance:* "did the letter go out?" is a case-page fact, not an email to Krystal
  (OM §2.7's "URGENT status check" thread becomes impossible to need).

## 8. Phase 2 — "The Steward wakes up" (build-ready)

### 8.1 Scheduling substrate
`convex/crons.ts` (net-new; Convex supports cron natively): daily sweep (stale cases,
overdue `actionDueAt`, ARC SLAs, unanswered polls, unverified deadlines), weekly digest,
monthly packet check. Every sweep writes an `agentRuns` row whether or not it acted.

### 8.2 Agent runtime
A Convex action implementing the two-pass pipeline: trigger → Steward pass (provider
abstraction §11.1, tool registry §9) → Reviewer pass (§5) → execute / queue-to-Desk /
retry / needs-human. Tables:
- `agentRuns`: hoaId, agent (steward|reviewer), trigger, duty, model, status, tokens,
  startedAt/endedAt, error?
- `agentActions`: hoaId, runId, toolName, argsSummary, targetRefs (caseId? propertyId?
  motionId? deadlineId? inboundEmailId?), autonomyLevel, reviewerVerdict
  (approved|rejected|sampled|exempt), verdictReasons?, outcome (executed|queued|rejected|
  needs_human), createdAt. **This is the cross-entity audit log the system lacks today.**
- Autonomy config: per-HOA map actionType → level (on `hoas` or a `stewardConfig` table),
  editable only by admin/board; every change itself logged to `agentActions`.
- *Acceptance:* no gated action executes without a logged Reviewer verdict; killing the
  `steward` flag halts all crons/runs within one sweep interval; an agent error is visible
  on the Desk within the same sweep.

### 8.3 Intake upgrade (Triage duty)
Extend `emailIntake.ts` beyond property-matching: classify {violation-related, ARC,
vendor/work, financial, complaint, **privileged**, noise}; privileged → restricted
visibility, excluded from all Steward drafting contexts, flagged to board only; ARC →
ARC queue; vendor/financial → filed for Phase 3/4 consumers; drafts a suggested reply where
warranted (L1). Existing guarantees keep: idempotent, add-info-only (never advances stages),
quarantine → Desk "needs human".
- *Acceptance:* the FYSA forward workflow requires zero new behavior from the board; an
  attorney-client thread never appears in any outward draft's context (Reviewer checklist +
  hard exclusion in retrieval).

### 8.4 Decision log (motions) v1
The corpus's #2 loss (OM §2.2). Table `motions`: hoaId, title, context/linkRefs, proposedBy
(member or steward), method (in_app|email_concurrence|meeting|text_recorded), options,
votes[{memberId, vote, at, viaRef?}], quorumRequired, status (open|passed|failed|expired),
ratifiedInMinutesRef?, createdAt/closedAt.
- Board members vote in-app (one tap from the Desk); the Steward can *open* motions (L2) and
  *record* email/text concurrences it observes in intake as vote evidence (L2, linked to the
  source email) — it never casts votes.
- Quorum awareness: member availability windows (Jugnu's vacation) factor into "can this
  pass now?" surfacing.
- Ratification list: one click exports open-and-passed-since-last-meeting motions → agenda
  (Phase 3 consumes this).
- *Acceptance:* the May 7 "lost concurrence" scenario is impossible — a proposal either has
  a motion row with votes or it visibly awaits them; nothing lives only in a reply chain.

### 8.5 Chase duty
Rules-driven detection (deterministic: `actionDueAt`, stage `dueInDays`, ARC age, poll age,
deadline state) + agent-composed follow-ups. Internal nudges at L3; outward status checks to
the PM at L2 initially (each one Reviewer-verified, one tap to send from the Desk; promotable
to L3 after track record).
- *Acceptance:* zero "Following up again" emails authored by a human for tracked items;
  every chase is logged with what it referenced and what came back.

### 8.6 ARC SLA
ARC applications (module exists) get `dueAt` on submission; Chase covers reminders; owner
sees status via portal.
- *Acceptance:* no application ages past its SLA without a Desk item; the two 2026 stall
  cases (OM §2.6) can't recur silently.

## 9. Deterministic tool layer (the agent's action space)

Exists today: cases + append-only caseEvents, workflows-as-data, hearings, fines, notices,
letters generation, ARC + AI review, email intake, homeowner portal, per-HOA `aiConfig`.
Net-new: motions, deadlines, agendaItems, availability polls, agent runtime + audit.

Tool catalog (each maps 1:1 to a guarded Convex mutation that enforces role, flag, autonomy
level, and workflow legality — the prompt never enforces anything):

| Tool | Guarded by | Phase |
|---|---|---|
| `create_case`, `add_case_note`, `link_email_to_case` | additive-only (intake invariants) | 2 |
| `propose_stage_transition` | queues to Desk; legality from `caseWorkflows`; never auto | 2 |
| `draft_notice` / `draft_reply` / `draft_letter` | outputs artifacts, sends nothing | 2 |
| `request_availability`, `schedule_hearing` | notice-day math enforced in mutation | 1–2 |
| `open_motion`, `record_concurrence_evidence` | votes are human-only | 2 |
| `send_status_check` (PM/vendor) | autonomy level + Reviewer verdict | 2 |
| `add_agenda_item` | additive | 2 |
| `set_deadline`, `mark_deadline_verified` | verification requires evidenceRef | 3 |
| `send_digest` | board-internal | 2 |

## 10. Phases 3–4 (objectives, not yet specced)

- **Meetings assistant (P3):** agenda accretes from cases/motions/threads all cycle
  (`agendaItems` + `meetings` table); T-7 the Steward assembles agenda incl. ratification
  list; post-meeting minutes draft with motions/seconds prefilled. Unlocked by: motions +
  agendaItems data. Risk: minutes are a legal record — stays L1 (draft) indefinitely.
- **Compliance calendar (P3):** `deadlines` table seeded with the VA-HOA set (SCC annual,
  DPOR license, quarterly estimated taxes, audit, insurance/demographics data call, meeting
  notices); Watch duty hunts intake for completion evidence and escalates unverified items.
  This makes OM §2.4's silent license expiry structurally impossible. Risk: false
  reassurance — verification must require evidence, not absence of alarm.
- **Financial packet reviewer (P4):** ingest Enumerate PDF + bank statement; reconcile
  recurring expectations (reserve transfer present? taxes on schedule? novel entries?);
  output *questions*, drafted for the treasurer to send. Reviewer-not-ledger stance
  (§2.4 anti-persona). Unlocked by: intake filing of financial mail (8.3).
- **Vendor & work orders (P4):** quote → approval (motion) → scheduled → verified-done
  (photo); performance history feeds renewals/RFPs. Unlocked by: motions + intake vendor
  classification.
- **Governing-docs memory (P4):** RAG over declarations, resolutions, policies, minutes,
  letters; answers cite sources; new-member onboarding becomes self-serve. Seeded by the
  ARC reference-docs pattern that already exists.

## 11. Technical architecture

### 11.1 Provider abstraction
Evolve `convex/openai.ts` into a provider-keyed module (e.g. `convex/llm/`): one internal
interface — `generateText(req)` and `runTools(req)` (messages, tools, model *role*, temp,
json) — with adapters per provider (OpenAI now; Anthropic/OpenRouter drop-in later). Callers
reference **model roles** (`steward`, `reviewer`, `triage`, `bullets`, …) resolved from env/
config (`LLM_PROVIDER`, `LLM_MODEL_<ROLE>`), not hardcoded model strings. Existing callers
(inspectionBullets, chat, copilot, ARC review, intake) migrate to the interface mechanically
with unchanged behavior (still OpenAI, same models). *Acceptance:* switching the Steward to
a different provider is an env change + adapter, zero caller edits.

### 11.2 Two-pass pipeline
Steward pass and Reviewer pass are separate `runTools`/`generateText` calls with separate
prompts; the Reviewer may resolve to a cheaper model for L3 pre-checks and a stronger one
for outward drafts. Deterministic checks (notice math, addressee match, privilege-source
exclusion) run in code before the Reviewer model is even consulted — the model reviews what
code cannot.

### 11.3 Runtime facts
Convex crons (`crons.ts`) + actions; `agentRuns`/`agentActions` per §8.2; metering extends
the existing usage-table pattern with per-agent attribution; failure semantics: any thrown
agent error or exhausted retry becomes a Desk "needs human" item — the system never fails
silently (principle 5).

## 12. Success metrics

Baselines from the corpus (OM §2, §9), measured per month on the beta HOA:

| Metric | Baseline (corpus) | Phase-2 target |
|---|---|---|
| Human-authored follow-up/status-poll emails | ~6+/mo (president) | 0 for tracked items |
| Time from violation report → hearing scheduled | ~3 months worst case (11403) | < 3 weeks, notice-legal |
| ARC application turnaround | 3–6 weeks | < 7 days or escalated |
| Decisions without a durable record | 15+ concurrence chains / 8 mo | 0 |
| Compliance deadlines missed silently | 1 catastrophic (license) | 0 unverified past due |
| Board hours/month (self-reported) | "part-time job" | trending down, surveyed monthly |
| Steward proposal acceptance rate (per action type) | — | >90% before any L3 promotion |

## 13. Rollout & trust

**The beta track is the rollout vehicle.** Same repo, long-lived `beta` branch, deployed as
a separate Vercel project at **beta.happierblock.com** against a **separate Convex project**
seeded from a production snapshot — full runtime isolation from the product people use today
(see `docs/beta-environment-runbook.md`). Hard safety on beta: `RESEND_API_KEY` unset (all
email sends fail visibly — non-negotiable while real homeowner emails exist in snapshot
data); shared prod Clerk instance (snapshot user IDs require it); prod fixes flow in via
`git merge master`.

1. **Beta Phase 1** — RTT board (the design partners who already ran their June inspection
   cycle in the app, OM §2.8) uses cases/hearings on beta with snapshot data.
2. **Beta Phase 2** — Steward + Reviewer live on beta; every action type starts at its
   conservative default; the Desk shows per-type track records.
3. **Ladder promotions** — an action type moves up (e.g., PM status checks L2→L3) only after
   N clean approvals (start: N=20, zero Reviewer-overridden misses) *and* an explicit board
   toggle. Demotion is always one tap. `steward` flag is the global kill switch.
4. **Graduation** — a feature moves beta→master when: metrics targets hit on beta, no
   needs-human backlog growth, and the board would revolt if it were taken away. Merged as a
   PR to master per feature-flag-gated slice; prod HOAs opt in by flag.

## 14. Open questions

- **PM multi-tenancy:** when Krystal works cases for several client HOAs, does she get a
  cross-HOA desk (portfolio product, parked) or per-HOA seats first?
- **Privilege depth:** is restricted visibility + retrieval exclusion enough for
  attorney-client material, or does it need storage-level separation?
- **Calendar integration:** availability polls vs. reading the board's shared Google
  calendar (they already keep one) — integrate or stay in-app?
- **Beta data lifecycle:** re-snapshot cadence from prod; what happens to beta-created
  cases/motions the board wants to keep when features graduate?
- **Reviewer economics:** one Reviewer pass per action is the safe default — where do we
  batch (digest-level review) as volume grows?
- **Naming:** "the Steward" is a working name; test with the board.
