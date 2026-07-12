import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireFeature } from "./lib/featureFlags";

/**
 * Agenda accretion (PRD §10 meetings assistant, substrate landed with §8):
 * "add this to the agenda topics you've been gathering" becomes a record
 * instead of an email to the treasurer. Items accrete all cycle; meeting
 * prep drains them.
 */

export const add = mutation({
  args: {
    title: v.string(),
    detail: v.optional(v.string()),
    sourceCaseId: v.optional(v.id("cases")),
    sourceMotionId: v.optional(v.id("motions")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    await requireFeature(ctx, viewer.hoaId, "steward");
    return await ctx.db.insert("agendaItems", {
      hoaId: viewer.hoaId,
      title: args.title.trim(),
      detail: args.detail?.trim() || undefined,
      sourceCaseId: args.sourceCaseId,
      sourceMotionId: args.sourceMotionId,
      addedByClerkUserId: viewer.clerkUserId,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const setStatus = mutation({
  args: {
    itemId: v.id("agendaItems"),
    status: v.union(v.literal("open"), v.literal("scheduled"), v.literal("done")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.hoaId !== viewer.hoaId) throw new Error("Agenda item not found.");
    await ctx.db.patch(args.itemId, { status: args.status });
  },
});

export const listForHoa = query({
  args: {
    status: v.optional(
      v.union(v.literal("open"), v.literal("scheduled"), v.literal("done")),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const status = args.status ?? "open";
    return await ctx.db
      .query("agendaItems")
      .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", status))
      .order("desc")
      .take(200);
  },
});
