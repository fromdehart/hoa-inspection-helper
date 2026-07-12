import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireFeature } from "./lib/featureFlags";

/**
 * The decision log (PRD §8.4). A board decision is either an open motion
 * with visible votes or a closed one with an outcome — never a sentence
 * buried in a reply chain. Voters are admin+board members; votes are
 * human-only (the Steward may open motions at L2 and record concurrence
 * EVIDENCE from intake, never cast votes).
 *
 * Close rule (v1, predictable over clever): a motion passes the moment yes
 * votes reach quorum, fails the moment no votes reach quorum, and otherwise
 * stays open until someone closes it as expired.
 */

const VOTE = v.union(v.literal("yes"), v.literal("no"), v.literal("abstain"));

async function eligibleVoterCount(ctx: MutationCtx, hoaId: Id<"hoas">): Promise<number> {
  const members = await ctx.db
    .query("userHoaMemberships")
    .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
    .collect();
  return members.filter((m) => m.role === "admin" || m.role === "board").length;
}

export const open = mutation({
  args: {
    title: v.string(),
    context: v.optional(v.string()),
    caseId: v.optional(v.id("cases")),
    method: v.union(
      v.literal("in_app"),
      v.literal("email_concurrence"),
      v.literal("text_recorded"),
      v.literal("meeting"),
    ),
    /** Defaults to a majority of admin+board members. */
    quorumRequired: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    await requireFeature(ctx, viewer.hoaId, "steward");
    const eligible = await eligibleVoterCount(ctx, viewer.hoaId);
    const quorum = args.quorumRequired ?? Math.floor(eligible / 2) + 1;
    if (quorum < 1) throw new Error("Quorum must be at least 1.");
    return await ctx.db.insert("motions", {
      hoaId: viewer.hoaId,
      title: args.title.trim(),
      context: args.context?.trim() || undefined,
      caseId: args.caseId,
      proposedByClerkUserId: viewer.clerkUserId,
      method: args.method,
      votes: [],
      quorumRequired: quorum,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const vote = mutation({
  args: {
    motionId: v.id("motions"),
    vote: VOTE,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const motion = await ctx.db.get(args.motionId);
    if (!motion || motion.hoaId !== viewer.hoaId) throw new Error("Motion not found.");
    if (motion.status !== "open") throw new Error("This motion is already closed.");

    const now = Date.now();
    // A member may change their vote while the motion is open; latest wins.
    const votes = motion.votes
      .filter((entry) => entry.clerkUserId !== viewer.clerkUserId)
      .concat([{ clerkUserId: viewer.clerkUserId, vote: args.vote, at: now }]);

    const yes = votes.filter((entry) => entry.vote === "yes").length;
    const no = votes.filter((entry) => entry.vote === "no").length;
    const status =
      yes >= motion.quorumRequired ? "passed" : no >= motion.quorumRequired ? "failed" : "open";

    await ctx.db.patch(args.motionId, {
      votes,
      status,
      ...(status !== "open" ? { closedAt: now } : {}),
    });
    return { status };
  },
});

/**
 * Record a concurrence that happened OUTSIDE the app (an "I concur" email, a
 * text vote) as evidence-linked votes. This is how legacy decision habits
 * enter the durable record without forcing behavior change on day one.
 */
export const recordConcurrence = mutation({
  args: {
    motionId: v.id("motions"),
    clerkUserId: v.string(),
    vote: VOTE,
    inboundEmailId: v.optional(v.id("inboundEmails")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const motion = await ctx.db.get(args.motionId);
    if (!motion || motion.hoaId !== viewer.hoaId) throw new Error("Motion not found.");
    if (motion.status !== "open") throw new Error("This motion is already closed.");

    const membership = await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .filter((q) => q.eq(q.field("hoaId"), motion.hoaId))
      .first();
    if (!membership || membership.role === "inspector") {
      throw new Error("Concurrence must belong to an admin or board member of this HOA.");
    }

    const now = Date.now();
    const votes = motion.votes
      .filter((entry) => entry.clerkUserId !== args.clerkUserId)
      .concat([
        {
          clerkUserId: args.clerkUserId,
          vote: args.vote,
          at: now,
          viaInboundEmailId: args.inboundEmailId,
        },
      ]);
    const yes = votes.filter((entry) => entry.vote === "yes").length;
    const no = votes.filter((entry) => entry.vote === "no").length;
    const status =
      yes >= motion.quorumRequired ? "passed" : no >= motion.quorumRequired ? "failed" : "open";

    await ctx.db.patch(args.motionId, {
      votes,
      status,
      ...(status !== "open" ? { closedAt: now } : {}),
    });
    return { status };
  },
});

/** Close an open motion without an outcome (superseded, withdrawn, went stale). */
export const expire = mutation({
  args: { motionId: v.id("motions") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const motion = await ctx.db.get(args.motionId);
    if (!motion || motion.hoaId !== viewer.hoaId) throw new Error("Motion not found.");
    if (motion.status !== "open") throw new Error("This motion is already closed.");
    await ctx.db.patch(args.motionId, { status: "expired", closedAt: Date.now() });
  },
});

export const listForHoa = query({
  args: {
    status: v.optional(
      v.union(v.literal("open"), v.literal("passed"), v.literal("failed"), v.literal("expired")),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    if (args.status) {
      return await ctx.db
        .query("motions")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", args.status!))
        .order("desc")
        .take(100);
    }
    return await ctx.db
      .query("motions")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .order("desc")
      .take(100);
  },
});

/**
 * Motions decided outside a meeting that still need ratification — the
 * meeting-prep feed (PRD §8.4): "one click exports open-and-passed-since-
 * last-meeting motions to the agenda."
 */
export const ratificationList = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const passed = await ctx.db
      .query("motions")
      .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", "passed"))
      .collect();
    return passed.filter((m) => m.method !== "meeting" && !m.ratifiedNote);
  },
});

/** Mark a motion ratified (called when minutes record it). */
export const markRatified = mutation({
  args: { motionId: v.id("motions"), note: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const motion = await ctx.db.get(args.motionId);
    if (!motion || motion.hoaId !== viewer.hoaId) throw new Error("Motion not found.");
    if (motion.status !== "passed") throw new Error("Only passed motions can be ratified.");
    await ctx.db.patch(args.motionId, { ratifiedNote: args.note.trim() });
  },
});
