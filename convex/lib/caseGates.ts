import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { WorkflowStage } from "./defaultWorkflows";

type StageLike = Pick<
  WorkflowStage,
  "key" | "label" | "requiresNotice" | "requiresHearing" | "requiresPhotoEvidence"
>;

/**
 * Due-process gate checks for entering a target stage. Returns human-readable
 * unmet-gate reasons (empty = allowed). Used by both `cases.transitionStage`
 * (enforcement) and `cases.getStageOptions` (UI hints) so they can never drift.
 */
export async function evaluateStageGates(
  ctx: QueryCtx,
  caseDoc: Doc<"cases">,
  targetStage: StageLike,
): Promise<string[]> {
  const reasons: string[] = [];

  if (targetStage.requiresNotice) {
    // A notice for the stage being exited must have been sent…
    const notices = await ctx.db
      .query("notices")
      .withIndex("by_case", (q) => q.eq("caseId", caseDoc._id))
      .collect();
    const sentForCurrentStage = notices.some(
      (n) =>
        n.stageKey === caseDoc.stageKey &&
        (n.deliveryStatus === "sent" || n.deliveryStatus === "delivered"),
    );
    // …or a legacy/backfilled noticeSent event exists on the timeline.
    let legacySent = false;
    if (!sentForCurrentStage) {
      const events = await ctx.db
        .query("caseEvents")
        .withIndex("by_case", (q) => q.eq("caseId", caseDoc._id))
        .collect();
      legacySent = events.some((e) => e.type === "noticeSent");
    }
    if (!sentForCurrentStage && !legacySent) {
      reasons.push(`Send the ${targetStage.label.toLowerCase()} notice first`);
    }
  }

  if (targetStage.requiresHearing) {
    const hearings = await ctx.db
      .query("hearings")
      .withIndex("by_case", (q) => q.eq("caseId", caseDoc._id))
      .collect();
    const decided = hearings.some((h) => h.decidedAt !== undefined);
    if (!decided) {
      reasons.push("A hearing decision must be recorded first");
    }
  }

  if (targetStage.requiresPhotoEvidence) {
    const events = await ctx.db
      .query("caseEvents")
      .withIndex("by_case", (q) => q.eq("caseId", caseDoc._id))
      .collect();
    const hasEvidence = events.some(
      (e) => e.type === "photoAttached" || e.type === "fixSubmitted",
    );
    if (!hasEvidence) {
      reasons.push("Photo evidence must be attached to the case first");
    }
  }

  return reasons;
}
