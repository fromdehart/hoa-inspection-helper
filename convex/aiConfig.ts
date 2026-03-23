import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

const KEYS = ["violationRules", "approvedColors", "hoaGuidelines"] as const;

async function fetchAll(ctx: { db: { query: Function } }) {
  const result: Record<string, string> = {
    violationRules: "",
    approvedColors: "",
    hoaGuidelines: "",
  };
  for (const key of KEYS) {
    const doc = await ctx.db
      .query("aiConfig")
      .withIndex("by_key", (q: any) => q.eq("key", key))
      .first();
    if (doc) result[key] = doc.value;
  }
  return result as { violationRules: string; approvedColors: string; hoaGuidelines: string };
}

export const getAll = query({
  args: {},
  handler: async (ctx) => fetchAll(ctx),
});

export const getAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => fetchAll(ctx),
});

export const set = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiConfig")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("aiConfig", { key: args.key, value: args.value, updatedAt: Date.now() });
    }
    return null;
  },
});
