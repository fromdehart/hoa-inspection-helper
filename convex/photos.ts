import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
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

/** Used by `removeForInspector` action before DB delete (to get `filePath` for the upload VPS). */
export const getFilePathForRemove = internalQuery({
  args: { id: v.id("photos"), propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.id);
    if (!photo) throw new Error("Photo not found.");
    if (photo.propertyId !== args.propertyId) {
      throw new Error("Photo does not belong to this property.");
    }
    return { filePath: photo.filePath };
  },
});

export const removeRecord = internalMutation({
  args: { id: v.id("photos"), propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.id);
    if (!photo) throw new Error("Photo not found.");
    if (photo.propertyId !== args.propertyId) {
      throw new Error("Photo does not belong to this property.");
    }

    const violations = await ctx.db
      .query("violations")
      .withIndex("by_photo", (q) => q.eq("photoId", args.id))
      .collect();
    for (const v of violations) {
      await ctx.db.patch(v._id, { photoId: undefined });
    }

    await ctx.db.delete(args.id);
    return null;
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

/**
 * Inspector: remove photo from Convex, then delete the blob on the upload VPS.
 * Set Convex env `UPLOAD_SERVER_URL` (e.g. https://hoauploads.example.com) and `UPLOAD_DELETE_TOKEN` (same as VPS).
 */
export const removeForInspector = action({
  args: {
    id: v.id("photos"),
    propertyId: v.id("properties"),
  },
  handler: async (ctx, args) => {
    const { filePath } = await ctx.runQuery(internal.photos.getFilePathForRemove, args);
    await ctx.runMutation(internal.photos.removeRecord, args);

    const base = process.env.UPLOAD_SERVER_URL;
    const token = process.env.UPLOAD_DELETE_TOKEN;
    if (!base || !token) {
      console.warn(
        "[photos.removeForInspector] UPLOAD_SERVER_URL or UPLOAD_DELETE_TOKEN unset; skipping VPS file delete.",
      );
      return;
    }

    const url = `${base.replace(/\/$/, "")}/api/delete-file`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Upload-Delete-Token": token,
      },
      body: JSON.stringify({ filePath }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Could not delete file on upload server (${res.status}): ${msg}`.trim());
    }
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
