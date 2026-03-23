import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { type: v.union(v.literal("report"), v.literal("letter")) },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("templates")
      .withIndex("by_type", (q) => q.eq("type", args.type))
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
    const existing = await ctx.db
      .query("templates")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("templates", {
        type: args.type,
        content: args.content,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
