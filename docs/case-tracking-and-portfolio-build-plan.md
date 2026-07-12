# Build Plan — Household Case Tracking + Management-Company Portfolio

**Status:** design / not yet built · **Author:** planning session, July 2026
**Two pillars:**
- **A. Universal household case tracking** — a first-class "case" per household that can hold *any* infraction/matter (violation, architectural, maintenance, complaint, inquiry), runs a configurable **due-process escalation ladder**, and produces a single **append-only audit trail** visible (in filtered form) to homeowner, board, and manager.
- **B. Management-company portfolio + AI copilot** — model the property-management firm as a real tenant with a cross-association work queue, and give its managers an AI copilot that tells them *what to do next* and *how to perform better*.

B is built on top of A (the portfolio queues and copilot are just cross-HOA views of the case model), so build A first.

---

## 1. Where this fits the existing codebase

**Three auth systems already exist — do not merge them:**
- `userHoaMemberships` (HOA-scoped: `admin` | `inspector`) → `convex/lib/tenantAuth.ts` (`requireViewerRole`)
- `propertyMemberships` (property-scoped homeowner, multi-property) → `convex/lib/homeownerAuth.ts` (`requireHomeownerForProperty`)
- `platformAdmins` + `platformAdminSessions.actingHoaId` → `convex/lib/platformAuth.ts` (`requirePlatformAdmin`, `getActingHoaId`)

**Key gap the case model fills:** today a "violation" has no record of its own. It lives in `properties.status` (`notStarted → inProgress → review → complete`) + `aiLetterBullets` + `generatedLetterHtml` + related `photos`/`fixPhotos`. That means:
- Only one open matter per property at a time.
- No history — fields are overwritten (`inspectionNotesLastUpdatedAt` etc.), not appended.
- No stages between "letter sent" and "complete," so no defensible notice → cure → hearing → fine chain.

**Conventions to follow for all new tables:** every tenant table carries `hoaId` and a `by_hoa` index (plus `by_hoa_<thing>` composites). Reuse the existing `internalAction` OpenAI wrappers (`convex/openai.ts`) and rate limiting (`convex/lib/homeownerRateLimit.ts`) — never re-expose public AI actions.

---

## 2. PILLAR A — Data model

### 2.1 `cases` — the household record (one property → many cases)

```ts
cases: defineTable({
  hoaId: v.id("hoas"),
  propertyId: v.id("properties"),
  // What kind of matter — extensible; drives which workflow ladder applies.
  caseType: v.union(
    v.literal("violation"),
    v.literal("architectural"),   // ARC request lifecycle
    v.literal("maintenance"),     // work-order style
    v.literal("complaint"),       // resident-vs-resident, noise, etc.
    v.literal("inquiry"),         // general request/question that needs tracking
    v.literal("other"),
  ),
  // Optional sub-category, reuses arcReferenceDocs categories (paint, landscaping, parking…)
  category: v.optional(v.string()),
  title: v.string(),
  description: v.optional(v.string()),
  severity: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  // Current stage KEY into the caseWorkflows ladder for this caseType (data-driven, not hardcoded).
  stageKey: v.string(),
  // Rollup status derived from stage, for cheap filtering/indexing.
  status: v.union(v.literal("open"), v.literal("awaitingHomeowner"), v.literal("resolved"), v.literal("closed"), v.literal("escalated")),
  source: v.union(
    v.literal("inspection"),
    v.literal("homeownerReport"),
    v.literal("managerManual"),
    v.literal("boardReferral"),
  ),
  assignedToClerkUserId: v.optional(v.string()), // the manager who owns it
  // Optional deadline currently governing the case (e.g. cure-period end). Drives SLA queues.
  actionDueAt: v.optional(v.number()),
  // Links back to origin artifacts (so we don't fork the existing pipeline).
  originArcSubmissionId: v.optional(v.id("arcApplicationSubmissions")),
  openedAt: v.number(),
  closedAt: v.optional(v.number()),
  createdByClerkUserId: v.optional(v.string()),
  updatedAt: v.number(),
})
  .index("by_hoa", ["hoaId"])
  .index("by_hoa_property", ["hoaId", "propertyId"])
  .index("by_property", ["propertyId"])
  .index("by_hoa_status", ["hoaId", "status"])
  .index("by_assignee_status", ["assignedToClerkUserId", "status"])   // portfolio "my work"
  .index("by_hoa_due", ["hoaId", "actionDueAt"]),                     // SLA / overdue queues
```

### 2.2 `caseEvents` — the append-only audit trail (the transparency spine)

Every state change writes one immutable row. Nothing here is ever edited or deleted. This is what makes the process *defensible* and what every party's timeline view renders.

```ts
caseEvents: defineTable({
  hoaId: v.id("hoas"),
  caseId: v.id("cases"),
  propertyId: v.id("properties"),
  type: v.union(
    v.literal("opened"),
    v.literal("stageChanged"),
    v.literal("noteAdded"),
    v.literal("noticeGenerated"),
    v.literal("noticeSent"),
    v.literal("photoAttached"),      // inspector or homeowner photo
    v.literal("fixSubmitted"),       // homeowner fix photo
    v.literal("hearingScheduled"),
    v.literal("hearingDecided"),
    v.literal("fineAssessed"),
    v.literal("fineWaived"),
    v.literal("assigned"),
    v.literal("reopened"),
    v.literal("closed"),
  ),
  // Who did it, and in what capacity — actor role matters for the audit trail.
  actorClerkUserId: v.optional(v.string()),
  actorRole: v.union(v.literal("admin"), v.literal("inspector"), v.literal("homeowner"), v.literal("board"), v.literal("system")),
  // Structured before/after for stageChanged; free-form summary always present.
  fromStageKey: v.optional(v.string()),
  toStageKey: v.optional(v.string()),
  summary: v.string(),               // human-readable, shown in timeline
  // Internal-only notes are hidden from the homeowner-facing timeline.
  visibility: v.union(v.literal("shared"), v.literal("internal")),
  // Optional references to artifacts created by this event.
  noticeId: v.optional(v.id("notices")),
  hearingId: v.optional(v.id("hearings")),
  fineId: v.optional(v.id("fines")),
  photoId: v.optional(v.id("photos")),
  fixPhotoId: v.optional(v.id("fixPhotos")),
  createdAt: v.number(),
})
  .index("by_case", ["caseId"])
  .index("by_property", ["propertyId"])
  .index("by_hoa", ["hoaId"]),
```

### 2.3 `caseWorkflows` — the configurable escalation ladder (per HOA, per caseType)

Due-process requirements vary by **state law + the community's governing docs** (cure periods, whether a hearing is required, fine schedules). Hardcoding the ladder would make the product unsellable across jurisdictions. Store it as data.

```ts
caseWorkflows: defineTable({
  hoaId: v.id("hoas"),
  caseType: v.string(),              // matches cases.caseType
  name: v.string(),
  // Ordered stages. `key` is stable; `gates` express due-process requirements.
  stages: v.array(v.object({
    key: v.string(),                 // e.g. "courtesyNotice", "curePeriod", "hearing", "fine", "closed"
    label: v.string(),
    // Rollup status this stage maps to on the case.
    statusRollup: v.union(v.literal("open"), v.literal("awaitingHomeowner"), v.literal("resolved"), v.literal("closed"), v.literal("escalated")),
    // Cure/response window in days; if set, entering this stage sets cases.actionDueAt.
    dueInDays: v.optional(v.number()),
    // Gate flags enforced on transition INTO this stage.
    requiresNotice: v.optional(v.boolean()),     // must generate+send a notice first
    requiresHearing: v.optional(v.boolean()),    // must have a recorded hearing decision
    requiresPhotoEvidence: v.optional(v.boolean()),
    // Default fine amount when this stage assesses a fine (assessment only — see §2.6).
    fineAmount: v.optional(v.number()),
    // Which notice template to use for this stage.
    noticeTemplateKey: v.optional(v.string()),
  })),
  isActive: v.boolean(),
  updatedAt: v.number(),
})
  .index("by_hoa", ["hoaId"])
  .index("by_hoa_type", ["hoaId", "caseType"]),
```

**Default violation ladder** (seed for every HOA, editable):
`courtesyNotice → curePeriod(14–30d) → reinspection → formalWarning → hearingNotice → hearing → fineAssessed(graduated) → resolved | escalated`.

### 2.4 `notices` — generated correspondence + delivery tracking

Reuses the existing letter pipeline (`letterTemplateDocs`, `templateRender.ts`, `letters.ts`, `resend.ts`) but tied to a case + stage, with delivery state for the audit trail.

```ts
notices: defineTable({
  hoaId: v.id("hoas"),
  caseId: v.id("cases"),
  propertyId: v.id("properties"),
  stageKey: v.string(),
  templateKey: v.optional(v.string()),
  html: v.string(),                  // rendered notice
  channel: v.union(v.literal("email"), v.literal("portal"), v.literal("mail")),  // mail = future integration
  deliveryStatus: v.union(v.literal("draft"), v.literal("sent"), v.literal("delivered"), v.literal("failed")),
  sentAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  openedAt: v.optional(v.number()),  // portal view / email open
  createdByClerkUserId: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_case", ["caseId"])
  .index("by_hoa", ["hoaId"]),
```

### 2.5 `hearings` — the "opportunity to be heard" record

```ts
hearings: defineTable({
  hoaId: v.id("hoas"),
  caseId: v.id("cases"),
  propertyId: v.id("properties"),
  noticeSentAt: v.optional(v.number()),   // hearing-notice date (due-process clock)
  scheduledFor: v.number(),
  location: v.optional(v.string()),        // room / video link
  homeownerNotified: v.boolean(),
  outcome: v.optional(v.union(v.literal("upheld"), v.literal("dismissed"), v.literal("continued"), v.literal("resolved"))),
  decisionText: v.optional(v.string()),
  decisionLetterNoticeId: v.optional(v.id("notices")),
  decidedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_case", ["caseId"])
  .index("by_hoa", ["hoaId"])
  .index("by_hoa_scheduled", ["hoaId", "scheduledFor"]),  // "hearings this week" queue
```

### 2.6 `fines` — assessment + tracking ONLY (no payment processing)

**Scope note:** the product deliberately does *not* do payments. A fine here is an **assessed amount for the audit trail and enforcement chain** — not collection. It records that a fine was levied, its legal basis, and whether it was waived/satisfied (status the manager sets manually). Actual money movement stays in the firm's accounting system.

```ts
fines: defineTable({
  hoaId: v.id("hoas"),
  caseId: v.id("cases"),
  propertyId: v.id("properties"),
  amount: v.number(),
  reason: v.string(),
  stageKey: v.string(),
  // Basis for defensibility: which rule / governing doc this fine references.
  ruleReference: v.optional(v.string()),
  status: v.union(v.literal("assessed"), v.literal("waived"), v.literal("satisfied")),  // "satisfied" = marked paid externally
  assessedByClerkUserId: v.optional(v.string()),
  assessedAt: v.number(),
  resolvedAt: v.optional(v.number()),
})
  .index("by_case", ["caseId"])
  .index("by_hoa", ["hoaId"]),
```

---

## 3. PILLAR A — Backend functions (`convex/cases.ts`, `convex/caseWorkflows.ts`, `convex/notices.ts`)

All admin/inspector mutations gate on `requireViewerRole`; homeowner reads gate on `requireHomeownerForProperty`. **Every mutation that changes case state must also insert a `caseEvents` row in the same transaction** — this is the invariant that keeps the audit trail complete.

- `cases.create` (admin/inspector/system) — opens a case, picks the workflow by `caseType`, sets `stageKey` to first stage, writes `opened` event.
- `cases.transitionStage` — **the core function.** Validates the target stage's gates (`requiresNotice`/`requiresHearing`/`requiresPhotoEvidence`) against actual child records; sets `actionDueAt` from `dueInDays`; updates `status` rollup; writes `stageChanged` event. Rejects illegal jumps.
- `cases.addNote` — `noteAdded` event with `visibility`.
- `cases.assign` — sets assignee, `assigned` event.
- `cases.listForProperty` (homeowner + admin) / `cases.getTimeline` (returns `caseEvents` filtered by viewer role — homeowners see `shared` only).
- `notices.generateForStage` — renders via existing template engine, stores `notices` row (`draft`), writes `noticeGenerated`.
- `notices.send` — sends via `resend` (internal action), flips to `sent`, writes `noticeSent`, advances stage if the ladder says so.
- `hearings.schedule` / `hearings.recordDecision` — write events, optionally generate decision-letter notice.
- `fines.assess` / `fines.waive` / `fines.markSatisfied`.
- `caseWorkflows.getOrSeedDefault` / `caseWorkflows.update` — per-HOA ladder editor.

**Backfill (`convex/migrations/backfillCases.ts`, internal):** for each property with inspection data, create one `caseType: "violation"` case; seed its timeline from existing timestamps (`inspectionNotesEnteredAt`, `letterSentAt`, fix-photo `verificationStatus`), attach existing `photos`/`fixPhotos` via `photoAttached`/`fixSubmitted` events. Keep `properties.status` as a derived rollup during transition; don't delete it day one.

---

## 4. PILLAR A — Frontend

- **Admin — Household Record** (`/admin/property/:propertyId`, extend existing page): tabbed "Cases" view listing all cases for the household with status chips; a case detail drawer showing the **timeline** (rendered from `caseEvents`), a **"Advance stage"** control that only offers legal next stages and surfaces unmet gates ("Send notice before starting cure period"), and inline notice/hearing/fine actions.
- **Admin — Case queue** (new `/admin/cases`): filter by status/stage/assignee/overdue; the single-community version of the portfolio queue in Pillar B.
- **Inspector** (offline): from `PropertyCapture`, "Open case" / "Add observation to case" that enqueues via the existing outbox (`src/offline/outbox.ts`) — a new outbox `kind: "caseEvent"`. Inspectors work offline, so case creation and photo-attach must sync-through, not call the server directly (see [[mobile-app-architecture]]).
- **Homeowner portal** (`/home`, extend): a "My Cases" view showing each open matter and its **shared timeline** — what was cited, the cure deadline, what they need to do, hearing date, current status. This is the transparency payoff and reuses `requireHomeownerForProperty`.
- **Board read-only view** (new lightweight role or a scoped link): oversight list of open/hearing-stage cases across the community, no edit. (Board access is a new capability — see Decisions §7.)

---

## 5. PILLAR B — Management-company portfolio

### 5.1 Model the firm as a real tenant

Today `platformAdmins` is a *global* app-owner super-admin that can act as any HOA. A real customer is a **property-management company** that manages a *scoped set* of HOAs and has its own staff. Add:

```ts
managementCompanies: defineTable({
  name: v.string(),
  slug: v.string(),
  status: v.union(v.literal("active"), v.literal("inactive")),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_slug", ["slug"]),

companyMemberships: defineTable({
  clerkUserId: v.string(),
  companyId: v.id("managementCompanies"),
  role: v.union(v.literal("owner"), v.literal("manager")),
  fullName: v.optional(v.string()),
  email: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_clerk_user", ["clerkUserId"])
  .index("by_company", ["companyId"]),
```

And link ownership: add `hoas.managementCompanyId: v.optional(v.id("managementCompanies"))` + a `by_company` index on `hoas`.

New auth helper `convex/lib/companyAuth.ts` (`requireCompanyMember`, `listManagedHoaIds`) that resolves a manager → the set of `hoaId`s they can act across. The existing "act as HOA" session (`platformAdminSessions`) generalizes into "act as HOA within my portfolio."

### 5.2 Portfolio dashboard (`/portfolio`, new route + `convex/portfolio.ts`)

Cross-HOA aggregations over the case model (all reuse the indexes in §2):
- **My work queue** — `cases` where `assignedToClerkUserId = me`, grouped by status, across all managed HOAs (`by_assignee_status`).
- **Overdue / SLA breaches** — cases past `actionDueAt` (`by_hoa_due` fanned across portfolio).
- **Hearings this week** — `hearings.by_hoa_scheduled`.
- **Awaiting-me vs awaiting-homeowner** split.
- **Per-community health tiles** — open case count, avg resolution time, overdue rate.

---

## 6. PILLAR B — Manager AI copilot (`convex/copilot.ts`)

Reuse `internalAction` OpenAI wrappers; add a `companyAiUsage` table mirroring `homeownerAiUsage` for rate limiting. All copilot features are grounded in that HOA's `arcReferenceDocs` + `caseWorkflows` (governing docs + the community's own ladder), which is the moat point-solution competitors lack.

1. **"Your day" prioritizer** — ranks the manager's open cases by deadline × severity × legal-risk and returns a short worklist with a one-line reason each. *What to do next.*
2. **Next-stage notice drafting** — given a case, drafts the correct stage notice grounded in the cited rule; manager reviews/sends. Extends the existing letter-bullet generator (`convex/inspectionBullets.ts`, `letterBulletFewShot.ts`).
3. **Hearing packet / decision-letter drafting** — assembles the case timeline into a board-ready packet and drafts the written decision.
4. **Selective-enforcement guard** *(novel, defensible)* — flags when similar violations in the same community are being enforced inconsistently (a real legal exposure). Runs across `cases` of the same `category`. No competitor found does this.
5. **Benchmarking / "how to perform better"** — compares resolution times, overdue rates, and open-case load across communities and managers in the portfolio; surfaces outliers and staffing imbalance. Mirrors what Vantaca markets as "IQ / benchmarking."
6. **Ticket deflection metrics** — reposition the existing homeowner chatbot (`convex/chat.ts`) as manager time-saved: let it answer case-status questions ("was my violation closed?") from the shared timeline, and report deflection counts to the portfolio dashboard. (Chatbot RAG upgrade is the known roadmap item — see [[homeowner-experience-architecture]].)

---

## 7. Decisions to make before building

1. **Terminology** — "Case" vs "Matter" vs "Ticket" in the UI. (Schema can stay `cases`.)
2. **Board access** — new first-class role in `userHoaMemberships` (`board`) vs. a scoped read-only magic link? Affects §4 board view and auth.
3. **Fine scope** — confirm assessment/tracking only, no collection (assumed here). If any payment ever enters, revisit — but current direction is no payments.
4. **`platformAdmins` vs `managementCompanies`** — keep `platformAdmins` as the app-owner god layer and add `managementCompanies` beneath it (recommended), or repurpose the existing platform layer as the firm layer? Recommendation: add the new layer; leave platform admin as-is.
5. **Physical mail** — `notices.channel: "mail"` is stubbed for a future Lob/PostGrid integration; out of scope for v1 but the schema reserves it.
6. **property.status deprecation** — derive it from cases going forward, or keep writing both during a transition window (recommended: dual-write, then cut over).

---

## 8. Suggested build order (each phase independently shippable)

| Phase | Ships | Depends on |
|-------|-------|-----------|
| **1. Case foundation** | `cases` + `caseEvents`, generic CRUD, backfill existing violations, admin household-record timeline | — |
| **2. Escalation ladder** | `caseWorkflows` + `transitionStage` gates + cure timers, `notices` + delivery tracking wired to existing letter engine | 1 |
| **3. Hearings & fines** | `hearings` + `fines` (assess/track), decision-letter generation | 2 |
| **4. Transparency views** | Homeowner "My Cases" timeline, board read-only oversight | 1–3 |
| **5. Portfolio tenant** | `managementCompanies` + `companyMemberships` + `hoas.managementCompanyId`, cross-HOA queues, `/portfolio` | 1–3 |
| **6. Manager AI copilot** | prioritizer, next-notice drafting, selective-enforcement guard, benchmarking, deflection metrics | 5 |

Phases 1–4 deliver Pillar A (universal household record + defensible due process + transparency). Phases 5–6 deliver Pillar B (portfolio + AI copilot). Ship 1–2 first: they replace the implicit-violation model with a real audit trail and are the foundation everything else reads from.

Related architecture: [[homeowner-experience-architecture]], [[mobile-app-architecture]].

---

## 9. Plain-English summary (what we're building and why)

### The problem
Right now the product does one thing well: an inspector walks a neighborhood, photographs a problem at a house, and the homeowner gets a letter and uploads a photo showing they fixed it. But the software only "remembers" one problem per house at a time, and it overwrites the details as things change. There's no lasting record of *what happened, when, and who did what*. If a homeowner disputes a fine, or a board asks "how did we handle this," there's no clean history to point to. And it's built for one neighborhood at a time — not for the property-management companies that run dozens or hundreds of neighborhoods and are the ones who actually pay for software like this.

We're fixing both of those.

### What we're building — Part A: A complete, permanent record for every household

Think of it like giving every house its own **file folder** that never gets erased. Instead of tracking just "the current violation," each house can have many **cases** open over time — and a case can be *anything*: a rules violation, a request to paint or remodel, a maintenance issue, a neighbor complaint, or a general question that needs follow-up. One place to see everything that's ever happened at a household.

Every case runs through a clear, step-by-step process — the kind HOAs are legally required to follow: a friendly first notice, a grace period to fix it, a warning, a hearing where the homeowner gets to be heard, and only then a fine. The software **guides the manager through these steps in order and won't let them skip a required one** (for example, it won't let you jump to a fine before a notice was actually sent). Because the legally-required steps differ from state to state and community to community, each community can configure its own version of these steps rather than being forced into ours.

Underneath all of this is the most important piece: an **unchangeable timeline**. Every action — a photo taken, a notice sent, a deadline set, a hearing held, a decision made — is written down permanently and can never be edited or deleted. That timeline becomes the single source of truth, and each person sees the part meant for them:
- **The homeowner** sees, in plain language, what was flagged, what they need to do, their deadline, and where things stand.
- **The board** gets a clean oversight view for making fair, consistent decisions.
- **The manager** sees the full history and drives the process.

This turns the product from "a violation tool" into a **transparent, defensible system of record for everything that happens at a home** — which is exactly what protects a community if a decision is ever challenged.

### What we're building — Part B: A command center for the management company, with an AI assistant

The real customer is usually the **property-management company** a neighborhood hires — and their managers are drowning. Industry research says the same routine questions and paperwork eat 8–12 hours per manager every week, and burnout and turnover are high. So we're building for *them*.

First, we let a management company sign in and see **all their neighborhoods in one place** instead of logging into each one separately. One combined to-do list: what needs my attention today, what's overdue, which hearings are coming up, what's waiting on me versus waiting on a homeowner, and which communities are healthy or falling behind.

Then we add an **AI assistant that helps the manager do the job and do it better**, not just answer questions:
- It **prioritizes their day** — "here are the five things that need you now, and why."
- It **drafts the right letter for the right step**, using that community's actual rules, so the manager reviews instead of writes from scratch.
- It **assembles hearing packets and decision letters** automatically from the timeline.
- It acts as a **fairness check** — flagging when similar problems are being handled inconsistently across a neighborhood, which is a genuine legal risk and something no competitor we found offers.
- It **benchmarks performance** across neighborhoods and managers, so the company can see where they're slow or overloaded.
- And the existing homeowner chatbot gets repositioned to **deflect routine questions** and answer "what's the status of my issue?" — directly saving manager time, with the time-saved counted and shown.

### Why this is the right bet
We're deliberately **not** trying to become an all-in-one platform that also does accounting and dues — that's a crowded, capital-intensive fight, and payments are explicitly out of scope. Instead we go deep on the two things we already do better than anyone and that competitors *can't easily copy* because they don't have our data: real in-the-field inspections, and an AI layer that already understands each community's own rulebook. We own **"the enforcement-and-resolution loop, done with AI, and legally defensible"** — inspect, notify, help the homeowner resolve it (or answer their questions automatically), and run the whole escalation and hearing process with a permanent, transparent audit trail — while giving the management company a portfolio-wide command center and an AI copilot that makes their overworked managers faster.

### The order we'll build it
Start with the file-folder and the permanent timeline (Part A, steps 1–2) — everything else reads from it. Then add hearings and fines, then the see-your-own-history views for homeowners and boards, then the management-company command center, and finally the AI copilot on top. Each step is useful on its own, so we can ship and get value along the way rather than waiting for the whole thing.
