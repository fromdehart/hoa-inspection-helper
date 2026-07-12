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

    // Execution is per action type — approval MEANS something different per
    // proposal kind, and each execution path is a guarded deterministic write.
    if (proposal.actionType === "record_concurrence") {
      if (!proposal.motionId || !proposal.concurrenceClerkUserId || !proposal.concurrenceVote) {
        throw new Error("Concurrence proposal is missing its vote payload.");
      }
      const motion = await ctx.db.get(proposal.motionId);
      if (!motion || motion.hoaId !== viewer.hoaId) throw new Error("Motion not found.");
      if (motion.status !== "open") throw new Error("That motion is already closed.");
      const votes = motion.votes
        .filter((entry) => entry.clerkUserId !== proposal.concurrenceClerkUserId)
        .concat([
          {
            clerkUserId: proposal.concurrenceClerkUserId,
            vote: proposal.concurrenceVote,
            at: now,
            viaInboundEmailId: proposal.inboundEmailId,
          },
        ]);
      const yes = votes.filter((entry) => entry.vote === "yes").length;
      const no = votes.filter((entry) => entry.vote === "no").length;
      const status =
        yes >= motion.quorumRequired
          ? ("passed" as const)
          : no >= motion.quorumRequired
            ? ("failed" as const)
            : ("open" as const);
      await ctx.db.patch(proposal.motionId, {
        votes,
        status,
        ...(status !== "open" ? { closedAt: now } : {}),
      });
      return { body: "", subject: proposal.draftSubject ?? "Concurrence recorded" };
    }

    // Draft-style proposals (pm_status_check, email_reply): the record of
    // the approved text lands on the case timeline; the human sends it.
    if (proposal.caseId && proposal.propertyId) {
      await logCaseEvent(ctx, {
        hoaId: proposal.hoaId,
        caseId: proposal.caseId,
        propertyId: proposal.propertyId,
        type: "noteAdded",
        actorRole: "system",
        actorClerkUserId: viewer.clerkUserId,
        visibility: "internal",
        summary: `Steward ${
          proposal.actionType === "email_reply" ? "reply draft" : "follow-up"
        } approved${args.editedBody ? " (edited)" : ""}: "${
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
