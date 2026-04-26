import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_LETTER_TEMPLATE } from "./letterBody";
import { requireViewerRole } from "./lib/tenantAuth";

export const get = query({
  args: { type: v.union(v.literal("report"), v.literal("letter")) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const doc = await ctx.db
      .query("templates")
      .withIndex("by_hoa_type", (q) => q.eq("hoaId", viewer.hoaId).eq("type", args.type))
      .first();
    if (!doc) return null;
    return { content: doc.content };
  },
});

export const set = mutation({
  args: {
    type: v.union(v.literal("report"), v.literal("letter")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const existing = await ctx.db
      .query("templates")
      .withIndex("by_hoa_type", (q) => q.eq("hoaId", viewer.hoaId).eq("type", args.type))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("templates", {
        hoaId: viewer.hoaId,
        type: args.type,
        content: args.content,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Inserts the default HOA letter HTML if none exists (safe to call multiple times). */
export const seedDefaultLetterIfNeeded = mutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const existing = await ctx.db
      .query("templates")
      .withIndex("by_hoa_type", (q) => q.eq("hoaId", viewer.hoaId).eq("type", "letter"))
      .first();
    if (existing) return { seeded: false as const };
    await ctx.db.insert("templates", {
      hoaId: viewer.hoaId,
      type: "letter",
      content: DEFAULT_LETTER_TEMPLATE,
      updatedAt: Date.now(),
    });
    return { seeded: true as const };
  },
});
