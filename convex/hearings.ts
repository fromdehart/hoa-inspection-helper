import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { logCaseEvent } from "./lib/caseEvents";

/** The "opportunity to be heard" record — the due-process core of enforcement. */

export const schedule = mutation({
  args: {
    caseId: v.id("cases"),
    scheduledFor: v.number(),
    location: v.optional(v.string()),
    homeownerNotified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) throw new Error("Case not found.");
    if (args.scheduledFor < Date.now()) {
      throw new Error("Hearing date must be in the future.");
    }

    const hearingId = await ctx.db.insert("hearings", {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      scheduledFor: args.scheduledFor,
      location: args.location?.trim() || undefined,
      homeownerNotified: args.homeownerNotified ?? false,
      createdAt: Date.now(),
    });

    await logCaseEvent(ctx, {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      type: "hearingScheduled",
      actorRole: "admin",
      actorClerkUserId: viewer.clerkUserId,
      summary: `Hearing scheduled for ${new Date(args.scheduledFor).toLocaleDateString()}${
        args.location ? ` at ${args.location.trim()}` : ""
      }`,
      visibility: "shared",
      hearingId,
    });
    await ctx.db.patch(caseDoc._id, { updatedAt: Date.now() });
    return hearingId;
  },
});

export const recordDecision = mutation({
  args: {
    hearingId: v.id("hearings"),
    outcome: v.union(
      v.literal("upheld"),
      v.literal("dismissed"),
      v.literal("continued"),
      v.literal("resolved"),
    ),
    decisionText: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing || hearing.hoaId !== viewer.hoaId) throw new Error("Hearing not found.");
    if (hearing.decidedAt) throw new Error("This hearing already has a recorded decision.");
    const decisionText = args.decisionText.trim();
    if (!decisionText) throw new Error("A written decision is required.");

    await ctx.db.patch(args.hearingId, {
      outcome: args.outcome,
      decisionText,
      decidedAt: Date.now(),
    });

    const OUTCOME_LABEL: Record<typeof args.outcome, string> = {
      upheld: "Violation upheld",
      dismissed: "Dismissed",
      continued: "Continued to a later date",
      resolved: "Resolved",
    };
    await logCaseEvent(ctx, {
      hoaId: hearing.hoaId,
      caseId: hearing.caseId,
      propertyId: hearing.propertyId,
      type: "hearingDecided",
      actorRole: "admin",
      actorClerkUserId: viewer.clerkUserId,
      summary: `Hearing decision: ${OUTCOME_LABEL[args.outcome]} — ${decisionText}`,
      visibility: "shared",
      hearingId: hearing._id,
    });
    const caseDoc = await ctx.db.get(hearing.caseId);
    if (caseDoc) await ctx.db.patch(caseDoc._id, { updatedAt: Date.now() });
    return null;
  },
});

export const listForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    // Board: read-only oversight.
    const viewer = await requireViewerRole(ctx, ["admin", "inspector", "board"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) return [];
    const hearings = await ctx.db
      .query("hearings")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
    return hearings.sort((a, b) => b.scheduledFor - a.scheduledFor);
  },
});

/** Upcoming hearings across the HOA (queue strip: "hearings this week"). */
export const listUpcoming = query({
  args: { withinDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // Board: read-only oversight.
    const viewer = await requireViewerRole(ctx, ["admin", "inspector", "board"]);
    const now = Date.now();
    const horizon = now + (args.withinDays ?? 14) * 86_400_000;
    const hearings = await ctx.db
      .query("hearings")
      .withIndex("by_hoa_scheduled", (q) =>
        q.eq("hoaId", viewer.hoaId).gte("scheduledFor", now).lte("scheduledFor", horizon),
      )
      .collect();
    return Promise.all(
      hearings
        .filter((h) => !h.decidedAt)
        .sort((a, b) => a.scheduledFor - b.scheduledFor)
        .map(async (h) => {
          const [caseDoc, property] = await Promise.all([
            ctx.db.get(h.caseId),
            ctx.db.get(h.propertyId),
          ]);
          return {
            ...h,
            caseTitle: caseDoc?.title ?? "",
            address: property?.address ?? "",
          };
        }),
    );
  },
});
