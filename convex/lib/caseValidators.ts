import { v } from "convex/values";

/** Shared validators for the case-tracking system (Convex schema + mutations). */

/** What kind of matter a case tracks; drives which workflow ladder applies. */
export const caseTypeValidator = v.union(
  v.literal("violation"),
  v.literal("architectural"),
  v.literal("maintenance"),
  v.literal("complaint"),
  v.literal("inquiry"),
  v.literal("other"),
);

/** Rollup status derived from the current stage, for cheap filtering/indexing. */
export const caseStatusValidator = v.union(
  v.literal("open"),
  v.literal("awaitingHomeowner"),
  v.literal("resolved"),
  v.literal("closed"),
  v.literal("escalated"),
);

/** How the case entered the system. */
export const caseSourceValidator = v.union(
  v.literal("inspection"),
  v.literal("homeownerReport"),
  v.literal("managerManual"),
  v.literal("boardReferral"),
  v.literal("email"),
);

export const severityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

/** Append-only audit-trail event types. */
export const caseEventTypeValidator = v.union(
  v.literal("opened"),
  v.literal("stageChanged"),
  v.literal("noteAdded"),
  v.literal("noticeGenerated"),
  v.literal("noticeSent"),
  v.literal("photoAttached"),
  v.literal("fixSubmitted"),
  v.literal("hearingScheduled"),
  v.literal("hearingDecided"),
  v.literal("fineAssessed"),
  v.literal("fineWaived"),
  v.literal("assigned"),
  v.literal("reopened"),
  v.literal("closed"),
  v.literal("emailReceived"),
);

/** In what capacity the actor performed the event. */
export const caseActorRoleValidator = v.union(
  v.literal("admin"),
  v.literal("inspector"),
  v.literal("homeowner"),
  v.literal("board"),
  v.literal("system"),
);

/** Timeline rows marked "internal" are hidden from homeowner- and board-facing views. */
export const caseEventVisibilityValidator = v.union(
  v.literal("shared"),
  v.literal("internal"),
);

export type CaseType =
  | "violation"
  | "architectural"
  | "maintenance"
  | "complaint"
  | "inquiry"
  | "other";

export type CaseStatus =
  | "open"
  | "awaitingHomeowner"
  | "resolved"
  | "closed"
  | "escalated";
