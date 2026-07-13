import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireFeature } from "./lib/featureFlags";

/**
 * Vendor work lifecycle (Phase 4b): quote → approved → scheduled → done.
 * Completion requires a verification note (same evidence discipline as
 * deadlines); the sweep flags anything stuck in quote/approved for 14 days.
 */

const STATUS = v.union(
  v.literal("quote"),
  v.literal("approved"),
  v.literal("scheduled"),
  v.literal("done"),
  v.literal("cancelled"),
);

export const add = mutation({
  args: {
    title: v.string(),
    vendor: v.string(),
    detail: v.optional(v.string()),
    amount: v.optional(v.number()),
    caseId: v.optional(v.id("cases")),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    await requireFeature(ctx, viewer.hoaId, "steward");
    const now = Date.now();
    return await ctx.db.insert("workOrders", {
      hoaId: viewer.hoaId,
      title: args.title.trim(),
      vendor: args.vendor.trim(),
      detail: args.detail?.trim() || undefined,
      amount: args.amount,
      status: "quote",
      caseId: args.caseId,
      propertyId: args.propertyId,
      createdByClerkUserId: viewer.clerkUserId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setStatus = mutation({
  args: {
    workOrderId: v.id("workOrders"),
    status: STATUS,
    scheduledFor: v.optional(v.number()),
    /** Required when marking done — what confirms the work actually happened. */
    verificationNote: v.optional(v.string()),
    /** Link the approving motion when advancing to approved. */
    motionId: v.optional(v.id("motions")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const order = await ctx.db.get(args.workOrderId);
    if (!order || order.hoaId !== viewer.hoaId) throw new Error("Work order not found.");
    if (args.status === "done" && !args.verificationNote?.trim()) {
      throw new Error("Marking done requires a verification note — what confirms the work?");
    }
    const now = Date.now();
    await ctx.db.patch(args.workOrderId, {
      status: args.status,
      scheduledFor: args.scheduledFor ?? order.scheduledFor,
      verificationNote: args.verificationNote?.trim() || order.verificationNote,
      motionId: args.motionId ?? order.motionId,
      ...(args.status === "done" ? { completedAt: now } : {}),
      updatedAt: now,
    });
  },
});

export const listForHoa = query({
  args: { includeClosed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const statuses = args.includeClosed
      ? (["quote", "approved", "scheduled", "done", "cancelled"] as const)
      : (["quote", "approved", "scheduled"] as const);
    const rows = [];
    for (const status of statuses) {
      const batch = await ctx.db
        .query("workOrders")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", status))
        .collect();
      rows.push(...batch);
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
