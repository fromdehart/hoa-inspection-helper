import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type CaseEventInput = {
  hoaId: Id<"hoas">;
  caseId: Id<"cases">;
  propertyId: Id<"properties">;
  type: Doc<"caseEvents">["type"];
  actorRole: Doc<"caseEvents">["actorRole"];
  summary: string;
  visibility: Doc<"caseEvents">["visibility"];
  actorClerkUserId?: string;
  fromStageKey?: string;
  toStageKey?: string;
  noticeId?: Id<"notices">;
  hearingId?: Id<"hearings">;
  fineId?: Id<"fines">;
  photoId?: Id<"photos">;
  fixPhotoId?: Id<"fixPhotos">;
  inboundEmailId?: Id<"inboundEmails">;
  /** Historical timestamp — ONLY for backfill migrations; live events must omit it. */
  createdAt?: number;
};

/**
 * The ONLY writer of `caseEvents`. The table is append-only: no update or
 * delete API exists (backfill rollback is the single sanctioned exception).
 * Every mutation that changes case state must call this in the same
 * transaction so the audit trail can never miss a step.
 */
export async function logCaseEvent(
  ctx: MutationCtx,
  input: CaseEventInput,
): Promise<Id<"caseEvents">> {
  const { createdAt, ...rest } = input;
  return ctx.db.insert("caseEvents", {
    ...rest,
    createdAt: createdAt ?? Date.now(),
  });
}
