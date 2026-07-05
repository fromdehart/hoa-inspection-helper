import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireHomeownerForProperty } from "./lib/homeownerAuth";

/** Internal: all reference docs for an HOA (used by scheduled ARC review). */
export const listByHoaInternal = internalQuery({
  args: { hoaId: v.id("hoas") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("arcReferenceDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", args.hoaId))
      .collect();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const docs = await ctx.db
      .query("arcReferenceDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    return docs.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** Homeowner-visible rules library for the property's HOA. */
export const listForHomeowner = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requireHomeownerForProperty(ctx, args.propertyId);
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId) return [];
    const docs = await ctx.db
      .query("arcReferenceDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", property.hoaId))
      .collect();
    return docs
      .filter((d) => d.visibleToHomeowners !== false)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((d) => ({
        _id: d._id,
        title: d.title,
        fileName: d.fileName,
        fileType: d.fileType,
        sourcePublicUrl: d.sourcePublicUrl,
        category: d.category ?? "general",
        // A short preview only — full parsed text stays server-side.
        preview: d.parsedText.slice(0, 600),
      }));
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    fileName: v.string(),
    fileType: v.union(v.literal("pdf"), v.literal("docx")),
    sourcePublicUrl: v.string(),
    sourceFilePath: v.string(),
    parsedText: v.string(),
    category: v.optional(v.string()),
    visibleToHomeowners: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const now = Date.now();
    return await ctx.db.insert("arcReferenceDocs", {
      hoaId: viewer.hoaId,
      title: args.title.trim() || args.fileName,
      fileName: args.fileName,
      fileType: args.fileType,
      sourcePublicUrl: args.sourcePublicUrl,
      sourceFilePath: args.sourceFilePath,
      parsedText: args.parsedText,
      category: args.category ?? "general",
      visibleToHomeowners: args.visibleToHomeowners ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Admin: update the homeowner-library metadata (category / visibility). */
export const update = mutation({
  args: {
    id: v.id("arcReferenceDocs"),
    category: v.optional(v.string()),
    visibleToHomeowners: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.hoaId !== viewer.hoaId) throw new Error("Reference document not found.");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.category !== undefined) patch.category = args.category;
    if (args.visibleToHomeowners !== undefined) patch.visibleToHomeowners = args.visibleToHomeowners;
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("arcReferenceDocs") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.hoaId !== viewer.hoaId) throw new Error("Reference document not found.");
    await ctx.db.delete(args.id);
    return null;
  },
});
