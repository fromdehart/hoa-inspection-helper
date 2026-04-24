import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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

/** Admin export helper: all inspector capture photos with street/house metadata. */
export const listForZipExport = query({
  args: {},
  handler: async (ctx) => {
    const photos = await ctx.db.query("photos").collect();
    const out: Array<{
      photoId: string;
      publicUrl: string;
      filePath: string;
      section: "front" | "side" | "back";
      uploadedAt: number;
      houseNumber: number;
      streetName: string;
      propertyId: string;
      address: string;
    }> = [];

    for (const photo of photos) {
      const property = await ctx.db.get(photo.propertyId);
      if (!property) continue;
      const street = await ctx.db.get(property.streetId);
      if (!street) continue;
      out.push({
        photoId: photo._id,
        publicUrl: photo.publicUrl,
        filePath: photo.filePath,
        section: photo.section,
        uploadedAt: photo.uploadedAt,
        houseNumber: property.houseNumber,
        streetName: street.name,
        propertyId: property._id,
        address: property.address,
      });
    }

    return out.sort((a, b) => {
      if (a.streetName !== b.streetName) return a.streetName.localeCompare(b.streetName);
      if (a.houseNumber !== b.houseNumber) return a.houseNumber - b.houseNumber;
      return a.uploadedAt - b.uploadedAt;
    });
  },
});

export const getById = internalQuery({
  args: { id: v.id("photos") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    section: v.union(v.literal("front"), v.literal("side"), v.literal("back")),
    filePath: v.string(),
    publicUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const photoId = await ctx.db.insert("photos", {
      propertyId: args.propertyId,
      section: args.section,
      filePath: args.filePath,
      publicUrl: args.publicUrl,
      uploadedAt: Date.now(),
      analysisStatus: "done",
    });
    const property = await ctx.db.get(args.propertyId);
    if (property?.status === "notStarted") {
      await ctx.db.patch(args.propertyId, { status: "inProgress" });
    }
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
