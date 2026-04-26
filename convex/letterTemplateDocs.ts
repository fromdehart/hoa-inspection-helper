import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const all = await ctx.db
      .query("letterTemplateDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    return ctx.db
      .query("letterTemplateDocs")
      .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", "active"))
      .first();
  },
});

export const setMapping = mutation({
  args: {
    id: v.id("letterTemplateDocs"),
    mapping: v.object({
      date: v.optional(v.number()),
      recipientName: v.optional(v.number()),
      recipientStreet: v.optional(v.number()),
      recipientCityStateZip: v.optional(v.number()),
      maintenanceStart: v.optional(v.number()),
      maintenanceEnd: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const doc = await ctx.db.get(args.id);
    if (!doc || !doc.hoaId || doc.hoaId !== viewer.hoaId) throw new Error("Template not found.");
    await ctx.db.patch(args.id, { mapping: args.mapping, updatedAt: Date.now() });
    return null;
  },
});

export const updateTemplateText = mutation({
  args: {
    id: v.id("letterTemplateDocs"),
    templateText: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const doc = await ctx.db.get(args.id);
    if (!doc || !doc.hoaId || doc.hoaId !== viewer.hoaId) throw new Error("Template not found.");
    await ctx.db.patch(args.id, { templateText: args.templateText, updatedAt: Date.now() });
    return null;
  },
});

export const createDraft = mutation({
  args: {
    fileName: v.string(),
    fileType: v.union(v.literal("docx"), v.literal("pdf")),
    sourcePublicUrl: v.string(),
    sourceFilePath: v.string(),
    parsedText: v.string(),
    templateText: v.string(),
    blocks: v.array(v.object({
      idx: v.number(),
      text: v.string(),
      kind: v.union(v.literal("paragraph"), v.literal("bullet")),
    })),
    detection: v.object({
      date: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientName: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientStreet: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientCityStateZip: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      maintenanceStart: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      maintenanceEnd: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
    }),
    mapping: v.object({
      date: v.optional(v.number()),
      recipientName: v.optional(v.number()),
      recipientStreet: v.optional(v.number()),
      recipientCityStateZip: v.optional(v.number()),
      maintenanceStart: v.optional(v.number()),
      maintenanceEnd: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const all = await ctx.db
      .query("letterTemplateDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    for (const doc of all) {
      if (doc.status === "active") {
        await ctx.db.patch(doc._id, { status: "draft", updatedAt: Date.now() });
      }
    }
    return await ctx.db.insert("letterTemplateDocs", {
      hoaId: viewer.hoaId,
      ...args,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activatedAt: Date.now(),
    });
  },
});

export const activate = mutation({
  args: { id: v.id("letterTemplateDocs") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const target = await ctx.db.get(args.id);
    if (!target || !target.hoaId || target.hoaId !== viewer.hoaId) throw new Error("Template not found.");
    const all = await ctx.db
      .query("letterTemplateDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    for (const doc of all) {
      if (doc.status === "active" && doc._id !== args.id) {
        await ctx.db.patch(doc._id, { status: "draft", updatedAt: Date.now() });
      }
    }
    await ctx.db.patch(args.id, { status: "active", activatedAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});
