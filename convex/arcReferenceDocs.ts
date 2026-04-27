import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

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

export const create = mutation({
  args: {
    title: v.string(),
    fileName: v.string(),
    fileType: v.union(v.literal("pdf"), v.literal("docx")),
    sourcePublicUrl: v.string(),
    sourceFilePath: v.string(),
    parsedText: v.string(),
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
      createdAt: now,
      updatedAt: now,
    });
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
