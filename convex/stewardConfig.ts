import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireFeature } from "./lib/featureFlags";
import {
  AUTONOMY_CEILINGS,
  AUTONOMY_DEFAULTS,
  effectiveAutonomy,
  type StewardActionType,
} from "./lib/stewardAutonomy";

/**
 * The autonomy ladder's control surface (PRD §4.2, §6). The board promotes
 * or demotes each ACTION TYPE; ceilings are enforced here in code — no
 * config state can push an action past its hard cap. Every change is itself
 * logged to the agent audit trail, because who-may-do-what is exactly the
 * kind of decision the record must keep.
 */

const ACTION_TYPES = Object.keys(AUTONOMY_DEFAULTS) as StewardActionType[];
const LEVELS = ["L0", "L1", "L2", "L3"] as const;

export const get = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const config = await ctx.db
      .query("stewardConfig")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .first();

    // Track record per action type from decided proposals: the evidence a
    // board looks at before promoting anything (PRD §13).
    const decided = [];
    for (const status of ["approved", "rejected"] as const) {
      const rows = await ctx.db
        .query("stewardProposals")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", status))
        .collect();
      decided.push(...rows);
    }
    const stats: Record<string, { approved: number; edited: number; rejected: number }> = {};
    for (const p of decided) {
      const s = (stats[p.actionType] ??= { approved: 0, edited: 0, rejected: 0 });
      if (p.status === "rejected") s.rejected += 1;
      else if (p.finalBody && p.finalBody !== p.draftBody) s.edited += 1;
      else s.approved += 1;
    }

    return ACTION_TYPES.map((actionType) => ({
      actionType,
      effective: effectiveAutonomy(actionType, config?.autonomy),
      default: AUTONOMY_DEFAULTS[actionType],
      ceiling: AUTONOMY_CEILINGS[actionType],
      stats: stats[actionType] ?? { approved: 0, edited: 0, rejected: 0 },
    }));
  },
});

export const setLevel = mutation({
  args: {
    actionType: v.string(),
    level: v.union(v.literal("L0"), v.literal("L1"), v.literal("L2"), v.literal("L3")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    await requireFeature(ctx, viewer.hoaId, "steward");
    if (!ACTION_TYPES.includes(args.actionType as StewardActionType)) {
      throw new Error("Unknown action type.");
    }
    const actionType = args.actionType as StewardActionType;
    const ceiling = AUTONOMY_CEILINGS[actionType];
    if (LEVELS.indexOf(args.level) > LEVELS.indexOf(ceiling)) {
      throw new Error(`"${actionType}" is capped at ${ceiling}.`);
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("stewardConfig")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        autonomy: { ...existing.autonomy, [actionType]: args.level },
        updatedByClerkUserId: viewer.clerkUserId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("stewardConfig", {
        hoaId: viewer.hoaId,
        autonomy: { [actionType]: args.level },
        updatedByClerkUserId: viewer.clerkUserId,
        updatedAt: now,
      });
    }

    // Autonomy changes are audit-trail events in their own right.
    const runId = await ctx.db.insert("agentRuns", {
      hoaId: viewer.hoaId,
      agent: "steward",
      duty: "config",
      trigger: "user:settings",
      status: "ok",
      startedAt: now,
      endedAt: now,
      actionsCount: 1,
    });
    await ctx.db.insert("agentActions", {
      hoaId: viewer.hoaId,
      runId,
      toolName: "set_autonomy_level",
      argsSummary: `"${actionType}" set to ${args.level}`,
      autonomyLevel: args.level,
      reviewerVerdict: "exempt",
      outcome: "executed",
      createdAt: now,
    });
  },
});
