import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { logCaseEvent } from "./lib/caseEvents";

/**
 * Board surface over stewardProposals: the approval queue (PRD §6.1). A
 * proposal is a Reviewer-verified draft; approving records it on the case's
 * append-only timeline (the durable trail), and the board sends it — nothing
 * outward ever leaves automatically at L2, and email rails stay disabled on
 * beta regardless.
 */

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const pending = await ctx.db
      .query("stewardProposals")
      .withIndex("by_hoa_status", (q) =>
        q.eq("hoaId", viewer.hoaId).eq("status", "pending_approval"),
      )
      .collect();
    const needsHuman = await ctx.db
      .query("stewardProposals")
      .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", "needs_human"))
      .collect();
    return [...pending, ...needsHuman].sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const approve = mutation({
  args: {
    proposalId: v.id("stewardProposals"),
    /** The board may edit the draft before approving; omitted = as drafted. */
    editedBody: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.hoaId !== viewer.hoaId) throw new Error("Proposal not found.");
    if (proposal.status !== "pending_approval") {
      throw new Error("Only pending proposals can be approved.");
    }
    const body = (args.editedBody ?? proposal.draftBody).trim();
    if (!body) throw new Error("The follow-up text is empty.");

    const now = Date.now();
    await ctx.db.patch(args.proposalId, {
      status: "approved",
      finalBody: body,
      decidedByClerkUserId: viewer.clerkUserId,
      decidedAt: now,
    });
    if (proposal.caseId && proposal.propertyId) {
      await logCaseEvent(ctx, {
        hoaId: proposal.hoaId,
        caseId: proposal.caseId,
        propertyId: proposal.propertyId,
        type: "noteAdded",
        actorRole: "system",
        actorClerkUserId: viewer.clerkUserId,
        visibility: "internal",
        summary: `Steward follow-up approved${args.editedBody ? " (edited)" : ""}: "${
          proposal.draftSubject ?? "status check"
        }" — ${body}`,
      });
    }
    return { body, subject: proposal.draftSubject ?? "" };
  },
});

export const reject = mutation({
  args: {
    proposalId: v.id("stewardProposals"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.hoaId !== viewer.hoaId) throw new Error("Proposal not found.");
    if (proposal.status !== "pending_approval" && proposal.status !== "needs_human") {
      throw new Error("This proposal is already decided.");
    }
    await ctx.db.patch(args.proposalId, {
      status: "rejected",
      verdictReasons: args.reason?.trim() || proposal.verdictReasons,
      decidedByClerkUserId: viewer.clerkUserId,
      decidedAt: Date.now(),
    });
  },
});
