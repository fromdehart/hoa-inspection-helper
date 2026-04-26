import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const fixPhotos = await ctx.db
      .query("fixPhotos")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    return fixPhotos.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});

export const getById = internalQuery({
  args: { id: v.id("fixPhotos") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    filePath: v.string(),
    publicUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const fixPhotoId = await ctx.db.insert("fixPhotos", {
      propertyId: args.propertyId,
      filePath: args.filePath,
      publicUrl: args.publicUrl,
      uploadedAt: Date.now(),
      verificationStatus: "needsReview",
      verificationNote: "Awaiting manual review (automated image verification disabled).",
    });
    return fixPhotoId;
  },
});

export const updateVerification = internalMutation({
  args: {
    id: v.id("fixPhotos"),
    status: v.union(
      v.literal("resolved"),
      v.literal("notResolved"),
      v.literal("needsReview"),
    ),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      verificationStatus: args.status,
      verificationNote: args.note,
    });
    return null;
  },
});

/** Admin / manual review of homeowner fix photos (image AI disabled). */
export const setVerification = mutation({
  args: {
    id: v.id("fixPhotos"),
    status: v.union(
      v.literal("pending"),
      v.literal("resolved"),
      v.literal("notResolved"),
      v.literal("needsReview"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      verificationStatus: args.status,
      verificationNote: args.note ?? "",
    });
    return null;
  },
});
