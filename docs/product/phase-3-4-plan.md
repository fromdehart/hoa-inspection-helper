# Phases 3 & 4 — Build Plan

**Status:** v1 · July 2026 · companion to [`ai-native-board-prd.md`](./ai-native-board-prd.md) §10.
Turns the PRD's Phase 3–4 objectives into buildable v1 slices. Design rule carried through:
**deterministic wherever facts suffice; the LLM pipeline (Steward→Reviewer) only where prose
matters; every effect through guarded tools into the audit trail.**

## Phase 3a — Compliance calendar, seeded (the "due dates matrix")

*Objective:* the expired-license failure class (OM §2.4) becomes structurally impossible.
The `deadlines` table, evidence-required verification, escalation, and Desk card already
exist — what's missing is the actual calendar.

- `convex/lib/complianceLibrary.ts`: the Virginia-HOA deadline set observed in the corpus —
  SCC annual report, DPOR CIC license renewal, quarterly estimated taxes (×4), annual audit
  engagement, insurance/demographics data call, annual meeting + notice, meeting-schedule
  distribution. Each entry: title, detail (what it is + where it's filed), month/day
  anchor, recurrence label.
- `deadlines.seedFromLibrary` (mutation, admin): inserts any library entry not already
  present by title, due date = next occurrence from the anchor. Idempotent.
- Desk deadlines card: "Seed the standard calendar" affordance when the calendar is empty.
- **Watch duty (light):** when intake files/quarantines an email whose subject/summary
  shares keywords with an open deadline's title, emit an event finding
  `deadline_evidence_maybe` (awaiting_human) linking the email — "this may verify X."
  Deterministic keyword match; no LLM.
- *Acceptance:* a fresh HOA seeds a full calendar in one tap; an overdue unverified item
  escalates (existing) and a plausibly-relevant email surfaces as verification evidence.

## Phase 3b — Meetings assistant v1 (deterministic)

*Objective:* the agenda assembles itself; minutes start from the record, not memory
(OM §2.2). An agenda is a **list assembly**, not prose — no LLM in v1.

- `meetings.assembleAgenda` (query): markdown agenda from deterministic inputs — open
  `agendaItems`, the ratification list (passed, unratified motions), open-findings counts
  by kind, open motions awaiting votes. Sections: call to order · ratifications · old/new
  business (agenda items) · the Steward's report (queue counts) · adjourn.
- `meetings.draftMinutesScaffold` (query, date-range): markdown scaffold — motions decided
  in range with movers/votes/outcomes prefilled, ratifications recorded, agenda items
  marked done. The humans write the prose; the record supplies the facts.
- Desk agenda card: "Assemble agenda" and "Minutes scaffold" copy actions.
- *Acceptance:* July-meeting agenda for RTT assembles from the cycle's accreted items +
  pending ratifications in one tap; a minutes scaffold lists every decided motion with its
  vote record. Deferred to v2: meetings table, T-7 auto-assembly, LLM prose polish.

## Phase 4a — Financial packet reviewer v1

*Objective:* the monthly human-diff (OM §2.3) starts from a checklist and drafted
questions instead of a blank stare. Reviewer-not-ledger stance is absolute.

- **Event hook (deterministic):** when intake classifies an email `financial` (filed OR
  quarantined — vendor/financial mail rarely matches a property), emit event finding
  `financial_packet_review` (awaiting_human) whose detail is the recurring-checks
  checklist mined from the corpus: reserve auto-transfer recorded? · estimated taxes on
  schedule? · unexplained fees (returned-check class)? · substitute/replacement reports? ·
  new payees?
- **Questions draft (LLM, L1):** same trigger runs the Steward pipeline over the email
  text to draft "questions to ask the bookkeeper" as an `email_reply`-class proposal
  (actionType `financial_questions`, default L1/ceiling L2). Reviewer checklist: questions
  only, no accusations, no numbers not present in the source.
- *Acceptance:* Kathy's monthly statement email produces a Desk checklist finding + a
  drafted clarification email for the treasurer to send or discard. Deferred: PDF
  attachment parsing (attachments aren't stored today), cross-month reconciliation.

## Phase 4b — Vendor & work orders v1

*Objective:* quote → approval → scheduled → verified-done stops living in Fw: chains
(OM §2.7); performance history accrues for renewals/RFPs.

- Schema `workOrders`: hoaId, title, vendor, detail?, amount?, status
  (quote|approved|scheduled|done|cancelled), motionId? (approval = a motion), caseId?/
  propertyId?, scheduledFor?, completedAt?, verificationNote?, createdBy, timestamps.
  Index by_hoa_status.
- `convex/workOrders.ts`: CRUD + status advance (admin/board); "approve" can open a
  motion (links the decision log); completion asks for a verification note.
- Desk rail card: open work orders, add form, one-tap status advance.
- Sweep detector: `work_order_stalled` — quote/approved older than 14d (awaiting_human
  v1; a chase playbook can draft the vendor nudge later).
- *Acceptance:* the sign-repair saga (quote → signed → change order → done, OM §2.7) fits
  in one record; a stalled quote surfaces on the Desk by itself.

## Phase 4c — Institutional memory v1: "Ask the record"

*Objective:* "what's our cost schedule and when was it adopted?" answered in seconds
(OM §2.5). Full RAG (embeddings over governing docs) is deferred; the v1 insight is that
the **decision log + deadlines + workflows are already structured memory** — and the
highest-value lost knowledge at RTT was *decisions*, not documents.

- `convex/askRecord.ts` (action, admin/board, copilot pattern): grounds an answer on —
  motions (all, incl. closed, with votes/dates), deadlines + verification history, agenda
  items, ARC reference docs + `aiConfig` guideline text (the existing chat corpus), case
  workflow ladders. Prompt-stuffed with budget caps, same as chat.ts. Answers cite the
  record ("Motion 'Tree remediation', passed 2026-07-14, 2–0").
- Desk: "Ask the record" input in the rail (answer rendered inline; logged to
  `agentRuns` duty "recall" — read-only, no Reviewer gate needed).
- *Acceptance:* "did we approve the mosquito treatment?" returns the motion, its date,
  and the vote. Deferred to v2: uploaded governing-document library with embeddings,
  citation deep-links.

## Sequencing & shared constraints

Build order: 3a → 3b → 4b → 4a → 4c (deterministic substrate first; the two LLM surfaces
last). Everything lands on `steward-foundation` → `beta`, flag-gated by `steward`; no new
env vars; no email sends anywhere (beta guard holds). Each slice: tsc + eslint + build +
commit; runtime verification happens on beta once the deploy key lands (same constraint as
Phase 2 — never against the live dev deployment).
