import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const violations = await ctx.db
      .query("violations")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    return violations.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const getById = internalQuery({
  args: { id: v.id("violations") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const create = internalMutation({
  args: {
    propertyId: v.id("properties"),
    photoId: v.id("photos"),
    description: v.string(),
    severity: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("violations", {
      propertyId: args.propertyId,
      photoId: args.photoId,
      description: args.description,
      severity: args.severity,
      aiGenerated: true,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const createPublic = mutation({
  args: {
    propertyId: v.id("properties"),
    photoId: v.optional(v.id("photos")),
    description: v.string(),
    severity: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("violations", {
      propertyId: args.propertyId,
      photoId: args.photoId,
      description: args.description,
      severity: args.severity,
      aiGenerated: false,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("violations"),
    description: v.optional(v.string()),
    severity: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    adminNote: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"), v.literal("needsReview"))),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const patch: Record<string, unknown> = {};
    if (fields.description !== undefined) patch.description = fields.description;
    if (fields.severity !== undefined) patch.severity = fields.severity;
    if (fields.adminNote !== undefined) patch.adminNote = fields.adminNote;
    if (fields.status !== undefined) patch.status = fields.status;
    await ctx.db.patch(id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("violations") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return null;
  },
});
