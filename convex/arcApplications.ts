import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

const arcFileValidator = v.object({
  fileName: v.string(),
  fileType: v.union(v.literal("pdf"), v.literal("docx")),
  sourcePublicUrl: v.string(),
  sourceFilePath: v.string(),
  parsedText: v.string(),
});

const verdictValidator = v.union(
  v.literal("likelyApproved"),
  v.literal("needsMoreInformation"),
  v.literal("likelyDenied"),
  v.literal("uncertain"),
);

export const get = query({
  args: { id: v.id("arcApplicationSubmissions") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const row = await ctx.db.get(args.id);
    if (!row || row.hoaId !== viewer.hoaId) return null;
    return row;
  },
});

export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) return [];
    const rows = await ctx.db
      .query("arcApplicationSubmissions")
      .withIndex("by_hoa_property", (q) =>
        q.eq("hoaId", viewer.hoaId).eq("propertyId", args.propertyId),
      )
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const createSubmission = mutation({
  args: {
    propertyId: v.id("properties"),
    files: v.array(arcFileValidator),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) {
      throw new Error("Property not found.");
    }
    if (args.files.length === 0) throw new Error("Add at least one file.");
    const hasText = args.files.some((f) => f.parsedText.trim().length > 0);
    const now = Date.now();
    return await ctx.db.insert("arcApplicationSubmissions", {
      hoaId: viewer.hoaId,
      propertyId: args.propertyId,
      createdAt: now,
      createdByClerkUserId: viewer.clerkUserId,
      status: hasText ? "ready" : "draft",
      files: args.files,
    });
  },
});

export const removeSubmission = mutation({
  args: { id: v.id("arcApplicationSubmissions") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const row = await ctx.db.get(args.id);
    if (!row || row.hoaId !== viewer.hoaId) throw new Error("Submission not found.");
    await ctx.db.delete(args.id);
    return null;
  },
});

export const internalSetReviewing = internalMutation({
  args: { submissionId: v.id("arcApplicationSubmissions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.submissionId, { status: "reviewing" });
    return null;
  },
});

export const internalCompleteReview = internalMutation({
  args: {
    submissionId: v.id("arcApplicationSubmissions"),
    verdict: verdictValidator,
    aiFeedbackJson: v.string(),
    aiModel: v.string(),
    promptHadTruncation: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.submissionId, {
      status: "complete",
      verdict: args.verdict,
      aiFeedbackJson: args.aiFeedbackJson,
      aiModel: args.aiModel,
      aiReviewAt: Date.now(),
      promptHadTruncation: args.promptHadTruncation,
    });
    return null;
  },
});

export const internalFailReview = internalMutation({
  args: { submissionId: v.id("arcApplicationSubmissions"), aiError: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.submissionId, {
      status: "error",
      aiError: args.aiError,
    });
    return null;
  },
});
