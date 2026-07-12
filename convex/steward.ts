import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { isFeatureEnabled } from "./lib/featureFlags";
import { requireViewerRole } from "./lib/tenantAuth";

/**
 * The Steward's runtime substrate (PRD §8.1–8.2). This first slice is
 * deliberately deterministic: cron-driven sweeps that OBSERVE (L0) and record
 * what needs attention — stale cases, overdue deadlines, aging ARC
 * applications — into the agentRuns/agentActions audit trail the Desk reads.
 * LLM-composed duties (chase drafts, triage, digest prose) layer on top of
 * these observations behind the Reviewer gate; they never replace them.
 *
 * Kill switch: everything here no-ops for HOAs without the "steward" flag.
 */

/** ARC applications older than this without a verdict are "aging" (PRD §8.6). */
const ARC_SLA_MS = 7 * 24 * 60 * 60 * 1000;

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

      let actions = 0;
      const observe = async (
        toolName: string,
        argsSummary: string,
        refs: {
          caseId?: Id<"cases">;
          propertyId?: Id<"properties">;
          deadlineId?: Id<"deadlines">;
        },
      ) => {
        await ctx.db.insert("agentActions", {
          hoaId: hoa._id,
          runId,
          toolName,
          argsSummary,
          autonomyLevel: "L0",
          reviewerVerdict: "exempt",
          outcome: "observed",
          ...refs,
          createdAt: now,
        });
        actions += 1;
      };

      // Overdue open cases: actionDueAt in the past. This is the loop the
      // president runs by hand today ("Following up again…", OM §2.1).
      const dueCases = await ctx.db
        .query("cases")
        .withIndex("by_hoa_due", (q) => q.eq("hoaId", hoa._id).lt("actionDueAt", now))
        .collect();
      for (const c of dueCases) {
        if (c.status === "resolved" || c.status === "closed") continue;
        if (c.actionDueAt == null) continue;
        const daysLate = Math.floor((now - c.actionDueAt) / (24 * 60 * 60 * 1000));
        await observe(
          "flag_overdue_case",
          `"${c.title}" is ${daysLate}d past its ${c.stageKey} deadline`,
          { caseId: c._id, propertyId: c.propertyId },
        );
      }

      // ARC applications past the SLA without a verdict (PRD §8.6).
      const arcSubs = await ctx.db
        .query("arcApplicationSubmissions")
        .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
        .collect();
      for (const sub of arcSubs) {
        const open = sub.status !== "complete" || sub.verdict == null;
        if (open && now - sub.createdAt > ARC_SLA_MS) {
          const daysOld = Math.floor((now - sub.createdAt) / (24 * 60 * 60 * 1000));
          await observe(
            "flag_aging_arc_application",
            `ARC application is ${daysOld}d old without a decision`,
            { propertyId: sub.propertyId },
          );
        }
      }

      // Compliance deadlines past due and still unverified (PRD §10 — the
      // expired-license class of failure).
      const dueDeadlines = await ctx.db
        .query("deadlines")
        .withIndex("by_hoa_due", (q) => q.eq("hoaId", hoa._id).lt("dueAt", now))
        .collect();
      for (const d of dueDeadlines) {
        if (d.verificationState !== "unverified") continue;
        await observe(
          "flag_unverified_deadline",
          `"${d.title}" was due ${new Date(d.dueAt).toLocaleDateString()} and has no completion evidence`,
          { deadlineId: d._id },
        );
        await ctx.db.patch(d._id, { verificationState: "escalated", updatedAt: now });
      }

      await ctx.db.patch(runId, { endedAt: Date.now(), actionsCount: actions });
    }
  },
});

/**
 * Weekly digest (PRD §6.4) — v1 rolls up the week's observations into one
 * run record the Desk can render. Prose/email delivery arrives with the LLM
 * digest duty; the deterministic rollup stays the source of truth.
 */
export const weeklyDigest = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const hoas = await ctx.db.query("hoas").collect();

    for (const hoa of hoas) {
      if (!(await isFeatureEnabled(ctx, hoa._id, "steward"))) continue;

      const recent = await ctx.db
        .query("agentActions")
        .withIndex("by_hoa_created", (q) => q.eq("hoaId", hoa._id).gt("createdAt", weekAgo))
        .collect();

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
        argsSummary: `${recent.length} agent actions in the last 7 days`,
        autonomyLevel: "L3",
        reviewerVerdict: "exempt",
        outcome: "executed",
        createdAt: now,
      });
      await ctx.db.patch(runId, { endedAt: Date.now(), actionsCount: 1 });
    }
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
