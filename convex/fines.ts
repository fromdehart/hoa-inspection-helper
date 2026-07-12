import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { logCaseEvent } from "./lib/caseEvents";
import { getOrSeedWorkflow } from "./caseWorkflows";

/**
 * Fine ASSESSMENT + TRACKING only — no payment processing, by design. A fine
 * here records that it was levied, its rule basis, and whether it was waived
 * or satisfied externally. Money movement stays in the firm's accounting
 * system; "satisfied" is set manually by the admin.
 */

export const assess = mutation({
  args: {
    caseId: v.id("cases"),
    amount: v.optional(v.number()),
    reason: v.string(),
    ruleReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) throw new Error("Case not found.");
    const reason = args.reason.trim();
    if (!reason) throw new Error("A reason is required to assess a fine.");

    // Due process: a fine requires a recorded hearing decision on the case.
    const hearings = await ctx.db
      .query("hearings")
      .withIndex("by_case", (q) => q.eq("caseId", caseDoc._id))
      .collect();
    if (!hearings.some((h) => h.decidedAt !== undefined)) {
      throw new Error("A hearing decision must be recorded before assessing a fine.");
    }

    // Default amount from the current workflow stage's fine schedule.
    const workflow = await getOrSeedWorkflow(ctx, caseDoc.hoaId, caseDoc.caseType);
    const stage = workflow.stages.find((s) => s.key === caseDoc.stageKey);
    const amount = args.amount ?? stage?.fineAmount;
    if (amount === undefined || amount <= 0) {
      throw new Error("Provide a fine amount (the current stage has no default).");
    }

    const fineId = await ctx.db.insert("fines", {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      amount,
      reason,
      stageKey: caseDoc.stageKey,
      ruleReference: args.ruleReference?.trim() || undefined,
      status: "assessed",
      assessedByClerkUserId: viewer.clerkUserId,
      assessedAt: Date.now(),
    });

    await logCaseEvent(ctx, {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      type: "fineAssessed",
      actorRole: "admin",
      actorClerkUserId: viewer.clerkUserId,
      summary:
        `Fine assessed: $${amount.toFixed(2)} — ${reason}` +
        (args.ruleReference?.trim() ? ` (per ${args.ruleReference.trim()})` : ""),
      visibility: "shared",
      fineId,
    });
    await ctx.db.patch(caseDoc._id, { updatedAt: Date.now() });
    return fineId;
  },
});

export const waive = mutation({
  args: { fineId: v.id("fines"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const fine = await ctx.db.get(args.fineId);
    if (!fine || fine.hoaId !== viewer.hoaId) throw new Error("Fine not found.");
    if (fine.status !== "assessed") throw new Error("Only an assessed fine can be waived.");

    await ctx.db.patch(args.fineId, { status: "waived", resolvedAt: Date.now() });
    await logCaseEvent(ctx, {
      hoaId: fine.hoaId,
      caseId: fine.caseId,
      propertyId: fine.propertyId,
      type: "fineWaived",
      actorRole: "admin",
      actorClerkUserId: viewer.clerkUserId,
      summary:
        `Fine of $${fine.amount.toFixed(2)} waived` +
        (args.note?.trim() ? ` — ${args.note.trim()}` : ""),
      visibility: "shared",
      fineId: fine._id,
    });
    return null;
  },
});

/** Mark a fine paid/settled outside the system (no payments are processed here). */
export const markSatisfied = mutation({
  args: { fineId: v.id("fines") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const fine = await ctx.db.get(args.fineId);
    if (!fine || fine.hoaId !== viewer.hoaId) throw new Error("Fine not found.");
    if (fine.status !== "assessed") throw new Error("Only an assessed fine can be marked satisfied.");

    await ctx.db.patch(args.fineId, { status: "satisfied", resolvedAt: Date.now() });
    await logCaseEvent(ctx, {
      hoaId: fine.hoaId,
      caseId: fine.caseId,
      propertyId: fine.propertyId,
      type: "noteAdded",
      actorRole: "admin",
      actorClerkUserId: viewer.clerkUserId,
      summary: `Fine of $${fine.amount.toFixed(2)} marked satisfied (settled externally)`,
      visibility: "shared",
      fineId: fine._id,
    });
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
    const fines = await ctx.db
      .query("fines")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
    return fines.sort((a, b) => b.assessedAt - a.assessedAt);
  },
});
