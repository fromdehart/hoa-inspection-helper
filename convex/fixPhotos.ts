import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) return [];
    const fixPhotos = await ctx.db
      .query("fixPhotos")
      .withIndex("by_hoa_property", (q) => q.eq("hoaId", property.hoaId).eq("propertyId", args.propertyId))
      .collect();
    return fixPhotos.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});

export const listByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_token", (q) => q.eq("accessToken", args.token))
      .first();
    if (!property || !property.hoaId) return [];
    const fixPhotos = await ctx.db
      .query("fixPhotos")
      .withIndex("by_hoa_property", (q) => q.eq("hoaId", property.hoaId).eq("propertyId", property._id))
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
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found.");
    const fixPhotoId = await ctx.db.insert("fixPhotos", {
      hoaId: property.hoaId,
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

export const createByToken = mutation({
  args: {
    token: v.string(),
    filePath: v.string(),
    publicUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query("properties")
      .withIndex("by_token", (q) => q.eq("accessToken", args.token))
      .first();
    if (!property || !property.hoaId) throw new Error("Property not found.");
    const fixPhotoId = await ctx.db.insert("fixPhotos", {
      hoaId: property.hoaId,
      propertyId: property._id,
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
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const fixPhoto = await ctx.db.get(args.id);
    if (!fixPhoto || fixPhoto.hoaId !== viewer.hoaId) throw new Error("Fix photo not found.");
    await ctx.db.patch(args.id, {
      verificationStatus: args.status,
      verificationNote: args.note ?? "",
    });
    return null;
  },
});
