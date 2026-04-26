import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

const KEYS = ["violationRules", "approvedColors", "hoaGuidelines"] as const;

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const result = {
      violationRules: "",
      approvedColors: "",
      hoaGuidelines: "",
    };
    for (const key of KEYS) {
      const doc = await ctx.db
        .query("aiConfig")
        .withIndex("by_hoa_key", (q) => q.eq("hoaId", viewer.hoaId).eq("key", key))
        .first();
      if (doc) result[key] = doc.value;
    }
    return result;
  },
});

export const getAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const result = {
      violationRules: "",
      approvedColors: "",
      hoaGuidelines: "",
    };
    for (const key of KEYS) {
      const doc = await ctx.db
        .query("aiConfig")
        .withIndex("by_hoa_key", (q) => q.eq("hoaId", viewer.hoaId).eq("key", key))
        .first();
      if (doc) result[key] = doc.value;
    }
    return result;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const existing = await ctx.db
      .query("aiConfig")
      .withIndex("by_hoa_key", (q) => q.eq("hoaId", viewer.hoaId).eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("aiConfig", {
        hoaId: viewer.hoaId,
        key: args.key,
        value: args.value,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
