import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isFeatureEnabled } from "./lib/featureFlags";
import { requireViewerRole } from "./lib/tenantAuth";
import { routeForKind } from "./lib/stewardPlaybooks";
import { effectiveAutonomy } from "./lib/stewardAutonomy";

/**
 * The Steward's deterministic monitoring loop (PRD §8.1–8.2).
 *
 * Architecture: DETECTORS observe known conditions and emit typed FINDINGS
 * into a deduplicated queue; PLAYBOOKS route each finding to whoever acts
 * ("awaiting_human" → the Desk, "awaiting_agent" → the LLM pass consumes the
 * batch behind the Reviewer gate). Detection re-runs every sweep, so a
 * finding whose condition cleared auto-resolves — the queue self-heals and
 * never nags about fixed problems. The agent NEVER scans the world; it reads
 * this queue.
 *
 * Kill switch: everything no-ops for HOAs without the "steward" flag.
 */

/** ARC applications older than this without a verdict are "aging" (PRD §8.6). */
const ARC_SLA_MS = 7 * 24 * 60 * 60 * 1000;
/** Open motions older than this with quorum not reached are "stalled". */
const MOTION_STALL_MS = 3 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

type CandidateFinding = {
  kind: string;
  dedupeKey: string;
  title: string;
  detail?: string;
  caseId?: Id<"cases">;
  propertyId?: Id<"properties">;
  deadlineId?: Id<"deadlines">;
  motionId?: Id<"motions">;
  inboundEmailId?: Id<"inboundEmails">;
  fixPhotoId?: Id<"fixPhotos">;
  arcSubmissionId?: Id<"arcApplicationSubmissions">;
};

/** Run every detector for one HOA and return the complete current condition set. */
async function detect(
  ctx: MutationCtx,
  hoaId: Id<"hoas">,
  now: number,
): Promise<CandidateFinding[]> {
  const found: CandidateFinding[] = [];

  // Overdue open cases — the loop the president runs by hand today
  // ("Following up again…", OM §2.1).
  const dueCases = await ctx.db
    .query("cases")
    .withIndex("by_hoa_due", (q) => q.eq("hoaId", hoaId).lt("actionDueAt", now))
    .collect();
  for (const c of dueCases) {
    if (c.status === "resolved" || c.status === "closed") continue;
    if (c.actionDueAt == null) continue;
    const daysLate = Math.floor((now - c.actionDueAt) / DAY_MS);
    found.push({
      kind: "case_overdue",
      dedupeKey: `case_overdue:${c._id}`,
      title: `"${c.title}" is ${daysLate}d past its ${c.stageKey} deadline`,
      caseId: c._id,
      propertyId: c.propertyId,
    });
  }

  // ARC applications past the SLA without a decision (PRD §8.6).
  const arcSubs = await ctx.db
    .query("arcApplicationSubmissions")
    .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
    .collect();
  for (const sub of arcSubs) {
    const open = sub.status !== "complete" || sub.verdict == null;
    if (open && now - sub.createdAt > ARC_SLA_MS) {
      const daysOld = Math.floor((now - sub.createdAt) / DAY_MS);
      found.push({
        kind: "arc_aging",
        dedupeKey: `arc_aging:${sub._id}`,
        title: `ARC application is ${daysOld}d old without a decision`,
        propertyId: sub.propertyId,
        arcSubmissionId: sub._id,
      });
    }
  }

  // Compliance deadlines past due without completion evidence — the
  // expired-license class of failure (OM §2.4). Escalation is the
  // deterministic side-effect; the finding routes to the Desk.
  const dueDeadlines = await ctx.db
    .query("deadlines")
    .withIndex("by_hoa_due", (q) => q.eq("hoaId", hoaId).lt("dueAt", now))
    .collect();
  for (const d of dueDeadlines) {
    if (d.verificationState === "verified") continue;
    if (d.verificationState === "unverified") {
      await ctx.db.patch(d._id, { verificationState: "escalated", updatedAt: now });
    }
    found.push({
      kind: "deadline_unverified",
      dedupeKey: `deadline_unverified:${d._id}`,
      title: `"${d.title}" was due ${new Date(d.dueAt).toLocaleDateString()} and has no completion evidence`,
      deadlineId: d._id,
    });
  }

  // Stalled motions: open past the stall window without quorum — the
  // "lost concurrence" failure (OM §2.2).
  const openMotions = await ctx.db
    .query("motions")
    .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoaId).eq("status", "open"))
    .collect();
  for (const m of openMotions) {
    if (now - m.createdAt <= MOTION_STALL_MS) continue;
    const daysOpen = Math.floor((now - m.createdAt) / DAY_MS);
    found.push({
      kind: "motion_stalled",
      dedupeKey: `motion_stalled:${m._id}`,
      title: `Motion "${m.title}" has waited ${daysOpen}d with ${m.votes.length} of ${m.quorumRequired} needed votes`,
      motionId: m._id,
    });
  }

  // Quarantined intake email waiting to be filed.
  const inbound = await ctx.db
    .query("inboundEmails")
    .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
    .collect();
  for (const e of inbound) {
    if (e.status !== "quarantined") continue;
    found.push({
      kind: "email_quarantined",
      dedupeKey: `email_quarantined:${e._id}`,
      title: `Unfiled email: "${e.subject ?? "(no subject)"}"`,
      inboundEmailId: e._id,
    });
  }

  // Homeowner fix photos waiting for review.
  const fixPhotos = await ctx.db
    .query("fixPhotos")
    .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
    .collect();
  for (const p of fixPhotos) {
    if (p.verificationStatus !== "pending" && p.verificationStatus !== "needsReview") continue;
    found.push({
      kind: "fix_photo_pending",
      dedupeKey: `fix_photo_pending:${p._id}`,
      title: "Homeowner fix photo waiting for review",
      propertyId: p.propertyId,
      fixPhotoId: p._id,
    });
  }

  // Inspections landed in "ready to review" — updates coming from the field.
  const properties = await ctx.db
    .query("properties")
    .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
    .collect();
  for (const p of properties) {
    if (p.status !== "review") continue;
    found.push({
      kind: "inspection_ready_for_review",
      dedupeKey: `inspection_ready_for_review:${p._id}`,
      title: `${p.address} is ready for inspection review`,
      propertyId: p._id,
    });
  }

  return found;
}

const OPEN_STATUSES = ["new", "awaiting_agent", "awaiting_human"] as const;

export const dailySweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const hoas = await ctx.db.query("hoas").collect();

    for (const hoa of hoas) {
      if (!(await isFeatureEnabled(ctx, hoa._id, "steward"))) continue;

      const runId = await ctx.db.insert("agentRuns", {
        hoaId: hoa._id,
        agent: "steward",
        duty: "sweep",
        trigger: "cron:daily-sweep",
        status: "ok",
        startedAt: now,
      });

      const candidates = await detect(ctx, hoa._id, now);
      const currentKeys = new Set(candidates.map((c) => c.dedupeKey));

      // Load every non-terminal finding once; index rows by dedupeKey.
      const existing: Doc<"findings">[] = [];
      for (const status of OPEN_STATUSES) {
        const rows = await ctx.db
          .query("findings")
          .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoa._id).eq("status", status))
          .collect();
        existing.push(...rows);
      }
      const dismissed = await ctx.db
        .query("findings")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoa._id).eq("status", "dismissed"))
        .collect();
      const byKey = new Map(existing.concat(dismissed).map((f) => [f.dedupeKey, f]));

      let created = 0;
      let resolved = 0;

      // Upsert: refresh live findings, create + route new ones. A dismissed
      // finding blocks re-creation while its condition persists.
      for (const c of candidates) {
        const prior = byKey.get(c.dedupeKey);
        if (prior) {
          await ctx.db.patch(prior._id, { lastSeenAt: now, title: c.title });
          continue;
        }
        const status = routeForKind(c.kind) === "agent" ? "awaiting_agent" : "awaiting_human";
        await ctx.db.insert("findings", {
          hoaId: hoa._id,
          ...c,
          status,
          source: "sweep",
          detectedAt: now,
          lastSeenAt: now,
        });
        created += 1;
      }

      // Auto-resolve: open (or dismissed) SWEEP findings whose condition
      // cleared. Resolving dismissed rows lets a future recurrence fire
      // fresh. Event-sourced findings are exempt — no detector re-asserts
      // them, so they close only by human action (dismiss / handling).
      for (const f of existing.concat(dismissed)) {
        if (f.source === "event") continue;
        if (currentKeys.has(f.dedupeKey)) continue;
        await ctx.db.patch(f._id, { status: "resolved", resolvedAt: now });
        resolved += 1;
      }

      await ctx.db.insert("agentActions", {
        hoaId: hoa._id,
        runId,
        toolName: "sweep_findings",
        argsSummary: `${candidates.length} conditions observed · ${created} new findings · ${resolved} auto-resolved`,
        autonomyLevel: "L0",
        reviewerVerdict: "exempt",
        outcome: "executed",
        createdAt: now,
      });
      await ctx.db.patch(runId, { endedAt: Date.now(), actionsCount: created + resolved });
    }
  },
});

/**
 * Weekly digest (PRD §6.4) — v1 rolls up the open queue and the week's agent
 * activity into one run record the Desk can render. Prose/email delivery
 * arrives with the LLM digest duty; this deterministic rollup stays the
 * source of truth.
 */
export const weeklyDigest = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - 7 * DAY_MS;
    const hoas = await ctx.db.query("hoas").collect();

    for (const hoa of hoas) {
      if (!(await isFeatureEnabled(ctx, hoa._id, "steward"))) continue;

      let openCount = 0;
      for (const status of OPEN_STATUSES) {
        const rows = await ctx.db
          .query("findings")
          .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoa._id).eq("status", status))
          .collect();
        openCount += rows.length;
      }
      const recentActions = await ctx.db
        .query("agentActions")
        .withIndex("by_hoa_created", (q) => q.eq("hoaId", hoa._id).gt("createdAt", weekAgo))
        .collect();

      // Reviewer post-hoc sampling (PRD §5): L3 auto-actions skip the
      // pre-execution Reviewer, so a weekly sample gets audited after the
      // fact. Today's L3 actions are deterministic (reminders, summaries) —
      // the audit is invariant checks; when LLM-composed L3 actions exist,
      // this is where their Reviewer pass slots in.
      const unsampled = recentActions
        .filter((a) => a.autonomyLevel === "L3" && a.reviewerVerdict == null)
        .slice(0, 5);
      for (const a of unsampled) {
        const intact =
          a.argsSummary.trim().length > 0 && a.outcome === "executed" && a.runId != null;
        await ctx.db.patch(a._id, {
          reviewerVerdict: intact ? "sampled" : "rejected",
          ...(intact ? {} : { verdictReasons: "post-hoc sample failed invariant checks" }),
        });
      }

      const runId = await ctx.db.insert("agentRuns", {
        hoaId: hoa._id,
        agent: "steward",
        duty: "digest",
        trigger: "cron:weekly-digest",
        status: "ok",
        startedAt: now,
      });
      await ctx.db.insert("agentActions", {
        hoaId: hoa._id,
        runId,
        toolName: "compile_weekly_digest",
        argsSummary: `${openCount} findings open · ${recentActions.length} agent actions in the last 7 days`,
        autonomyLevel: "L3",
        reviewerVerdict: "exempt",
        outcome: "executed",
        createdAt: now,
      });
      await ctx.db.patch(runId, { endedAt: Date.now(), actionsCount: 1 });
    }
  },
});

/**
 * Internal nudges (board_reminder duty): arc_aging and motion_stalled
 * findings become short reminders on the Desk activity feed + weekly digest.
 * Deliberately DETERMINISTIC — internal reminders need facts, not prose, so
 * no LLM (and therefore no Reviewer pass) is involved; the text is computed
 * from the finding itself. Runs at board_reminder's autonomy level (default
 * L3 = auto + logged); anything below L3 skips — the finding is already
 * visible in the queue.
 */
const NUDGE_COOLDOWN_MS = 3 * DAY_MS;

export const internalNudges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const hoas = await ctx.db.query("hoas").collect();

    for (const hoa of hoas) {
      if (!(await isFeatureEnabled(ctx, hoa._id, "steward"))) continue;
      const config = await ctx.db
        .query("stewardConfig")
        .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
        .first();
      if (effectiveAutonomy("board_reminder", config?.autonomy) !== "L3") continue;

      const queued = await ctx.db
        .query("findings")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoa._id).eq("status", "awaiting_agent"))
        .collect();
      const targets = queued.filter(
        (f) => f.kind === "arc_aging" || f.kind === "motion_stalled",
      );
      if (targets.length === 0) continue;

      // Cooldown: skip anything nudged in the last 3 days.
      const recent = await ctx.db
        .query("agentActions")
        .withIndex("by_hoa_created", (q) =>
          q.eq("hoaId", hoa._id).gt("createdAt", now - NUDGE_COOLDOWN_MS),
        )
        .collect();
      const nudgedKeys = new Set(
        recent
          .filter((a) => a.toolName === "board_reminder")
          .map((a) => `${a.motionId ?? ""}:${a.propertyId ?? ""}`),
      );

      let runId: Id<"agentRuns"> | null = null;
      let count = 0;
      for (const f of targets) {
        const key = `${f.motionId ?? ""}:${f.propertyId ?? ""}`;
        if (nudgedKeys.has(key)) continue;
        if (!runId) {
          runId = await ctx.db.insert("agentRuns", {
            hoaId: hoa._id,
            agent: "steward",
            duty: "chase",
            trigger: "cron:daily-nudges",
            status: "ok",
            startedAt: now,
          });
        }
        const text =
          f.kind === "motion_stalled"
            ? `Reminder — ${f.title}. Vote from the Desk.`
            : `Reminder — ${f.title}. ARC reviewers, please take a look.`;
        await ctx.db.insert("agentActions", {
          hoaId: hoa._id,
          runId,
          toolName: "board_reminder",
          argsSummary: text,
          autonomyLevel: "L3",
          reviewerVerdict: "exempt",
          outcome: "executed",
          motionId: f.motionId,
          propertyId: f.propertyId,
          createdAt: now,
        });
        count += 1;
      }
      if (runId) await ctx.db.patch(runId, { endedAt: Date.now(), actionsCount: count });
    }
  },
});

/**
 * Event-driven finding entry point (webhook detectors like email intake).
 * Dedupe-aware; routed by the same playbooks as sweep findings, but exempt
 * from sweep auto-resolve (see dailySweep).
 */
export const createEventFinding = internalMutation({
  args: {
    hoaId: v.id("hoas"),
    kind: v.string(),
    dedupeKey: v.string(),
    title: v.string(),
    detail: v.optional(v.string()),
    inboundEmailId: v.optional(v.id("inboundEmails")),
    motionId: v.optional(v.id("motions")),
    caseId: v.optional(v.id("cases")),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const prior = await ctx.db
      .query("findings")
      .withIndex("by_hoa_dedupe", (q) => q.eq("hoaId", args.hoaId).eq("dedupeKey", args.dedupeKey))
      .collect();
    const live = prior.find((f) => f.status !== "resolved");
    if (live) {
      await ctx.db.patch(live._id, { lastSeenAt: now, title: args.title });
      return live._id;
    }
    return await ctx.db.insert("findings", {
      ...args,
      status: routeForKind(args.kind) === "agent" ? "awaiting_agent" : "awaiting_human",
      source: "event",
      detectedAt: now,
      lastSeenAt: now,
    });
  },
});

/** The Steward activity feed (Desk + Settings): recent actions, newest first. */
export const listRecentActions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const rows = await ctx.db
      .query("agentActions")
      .withIndex("by_hoa_created", (q) => q.eq("hoaId", viewer.hoaId))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
    return rows;
  },
});
