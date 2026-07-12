import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireFeature } from "./lib/featureFlags";

/**
 * The compliance calendar (PRD §10 — the "due dates matrix" the board asked
 * for verbatim). The core rule: "verified" requires EVIDENCE. A deadline
 * nobody confirmed doesn't quietly pass — the daily sweep escalates it
 * (convex/steward.ts) and it lands on the Desk. This is the structural fix
 * for the expired-license failure (OM §2.4).
 */

export const add = mutation({
  args: {
    title: v.string(),
    detail: v.optional(v.string()),
    dueAt: v.number(),
    recurrence: v.optional(v.string()),
    ownerClerkUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    await requireFeature(ctx, viewer.hoaId, "steward");
    const now = Date.now();
    return await ctx.db.insert("deadlines", {
      hoaId: viewer.hoaId,
      title: args.title.trim(),
      detail: args.detail?.trim() || undefined,
      dueAt: args.dueAt,
      recurrence: args.recurrence?.trim() || undefined,
      ownerClerkUserId: args.ownerClerkUserId,
      verificationState: "unverified",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Verification requires evidence — a note at minimum, an intake email link ideally. */
export const verify = mutation({
  args: {
    deadlineId: v.id("deadlines"),
    evidenceNote: v.string(),
    evidenceInboundEmailId: v.optional(v.id("inboundEmails")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const deadline = await ctx.db.get(args.deadlineId);
    if (!deadline || deadline.hoaId !== viewer.hoaId) throw new Error("Deadline not found.");
    const note = args.evidenceNote.trim();
    if (!note) throw new Error("Verification requires evidence — describe what confirms completion.");
    const now = Date.now();
    await ctx.db.patch(args.deadlineId, {
      verificationState: "verified",
      evidenceNote: note,
      evidenceInboundEmailId: args.evidenceInboundEmailId,
      verifiedAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { deadlineId: v.id("deadlines") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const deadline = await ctx.db.get(args.deadlineId);
    if (!deadline || deadline.hoaId !== viewer.hoaId) throw new Error("Deadline not found.");
    await ctx.db.delete(args.deadlineId);
  },
});

export const listForHoa = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    return await ctx.db
      .query("deadlines")
      .withIndex("by_hoa_due", (q) => q.eq("hoaId", viewer.hoaId))
      .order("asc")
      .take(200);
  },
});
