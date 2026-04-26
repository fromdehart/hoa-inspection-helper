import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) return [];
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_hoa_property", (q) => q.eq("hoaId", viewer.hoaId).eq("propertyId", args.propertyId))
      .collect();
    return photos.sort((a, b) => a.uploadedAt - b.uploadedAt);
  },
});

/** Admin export helper: all inspector capture photos with street/house metadata. */
export const listForZipExport = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const photos = await ctx.db
      .query("photos")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
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
        publicUrl: photo.publicUrl ?? photo.thumbnailPublicUrl ?? "",
        filePath: photo.filePath ?? photo.thumbnailFilePath ?? "",
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

/** Relative paths on the upload VPS to delete (full + thumbnail when both exist). */
export const getUploadPathsForRemove = internalQuery({
  args: { id: v.id("photos"), propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.id);
    if (!photo) throw new Error("Photo not found.");
    if (photo.propertyId !== args.propertyId) {
      throw new Error("Photo does not belong to this property.");
    }
    const paths: string[] = [];
    if (photo.filePath) paths.push(photo.filePath);
    if (photo.thumbnailFilePath && photo.thumbnailFilePath !== photo.filePath) {
      paths.push(photo.thumbnailFilePath);
    }
    return { paths };
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

    await ctx.db.delete(args.id);
    return null;
  },
});

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    section: v.union(v.literal("front"), v.literal("side"), v.literal("back")),
    filePath: v.optional(v.string()),
    publicUrl: v.optional(v.string()),
    thumbnailFilePath: v.optional(v.string()),
    thumbnailPublicUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const hasFull = !!(args.filePath && args.publicUrl);
    const hasThumb = !!(args.thumbnailFilePath && args.thumbnailPublicUrl);
    if (!hasFull && !hasThumb) {
      throw new Error("Provide full-size and/or thumbnail paths.");
    }

    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) {
      throw new Error("Property not found.");
    }

    const photoId = await ctx.db.insert("photos", {
      hoaId: viewer.hoaId,
      propertyId: args.propertyId,
      section: args.section,
      ...(hasFull ? { filePath: args.filePath, publicUrl: args.publicUrl } : {}),
      ...(hasThumb
        ? { thumbnailFilePath: args.thumbnailFilePath, thumbnailPublicUrl: args.thumbnailPublicUrl }
        : {}),
      uploadedAt: Date.now(),
      analysisStatus: hasFull ? "done" : "pending",
    });
    if (property?.status === "notStarted") {
      await ctx.db.patch(args.propertyId, { status: "inProgress" });
    }
    return photoId;
  },
});

/** After full-size file finishes uploading to the VPS, attach it to an existing thumb-first photo row. */
export const setFullImage = mutation({
  args: {
    id: v.id("photos"),
    propertyId: v.id("properties"),
    filePath: v.string(),
    publicUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const p = await ctx.db.get(args.id);
    if (!p) throw new Error("Photo not found.");
    if (p.propertyId !== args.propertyId) {
      throw new Error("Photo does not belong to this property.");
    }
    if (p.hoaId !== viewer.hoaId) throw new Error("Photo not found.");
    await ctx.db.patch(args.id, {
      filePath: args.filePath,
      publicUrl: args.publicUrl,
      analysisStatus: "done",
    });
    return null;
  },
});

export const updateNote = mutation({
  args: { id: v.id("photos"), note: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const photo = await ctx.db.get(args.id);
    if (!photo || photo.hoaId !== viewer.hoaId) throw new Error("Photo not found.");
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
    const viewer = await ctx.runQuery(api.tenancy.viewerContext, {});
    if (viewer.role !== "admin" && viewer.role !== "inspector") {
      throw new Error("Inspector or admin access required.");
    }
    const property = await ctx.runQuery(internal.properties.getInternal, { id: args.propertyId });
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) {
      throw new Error("Property not found.");
    }
    const { paths } = await ctx.runQuery(internal.photos.getUploadPathsForRemove, args);
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
    for (const filePath of paths) {
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
