import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    return photos.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});

export const getById = internalQuery({
  args: { id: v.id("photos") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    section: v.union(v.literal("front"), v.literal("side"), v.literal("back")),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const publicUrl = await ctx.storage.getUrl(args.storageId as any) ?? "";
    const photoId = await ctx.db.insert("photos", {
      propertyId: args.propertyId,
      section: args.section,
      filePath: args.storageId,
      publicUrl,
      uploadedAt: Date.now(),
      analysisStatus: "pending",
    });
    const property = await ctx.db.get(args.propertyId);
    if (property?.status === "notStarted") {
      await ctx.db.patch(args.propertyId, { status: "inProgress" });
    }
    await ctx.scheduler.runAfter(0, internal.ai.analyzePhoto, { photoId });
    return photoId;
  },
});

export const updateNote = mutation({
  args: { id: v.id("photos"), note: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { inspectorNote: args.note });
    return null;
  },
});

export const updateAnalysisStatus = internalMutation({
  args: {
    id: v.id("photos"),
    status: v.union(
      v.literal("processing"),
      v.literal("done"),
      v.literal("error"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { analysisStatus: args.status });
    return null;
  },
});
