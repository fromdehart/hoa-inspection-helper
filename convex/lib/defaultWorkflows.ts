import type { CaseStatus, CaseType } from "./caseValidators";

/**
 * Default escalation ladders per case type. Phase 1 reads these constants
 * directly; Phase 2 seeds them into the per-HOA `caseWorkflows` table (which
 * then becomes authoritative and admin-editable). Due-process requirements
 * vary by state and governing docs, so ladders are data, not code.
 */

export type WorkflowStage = {
  /** Stable key; cases reference stages by key, never by index. */
  key: string;
  label: string;
  /** Rollup status a case takes while in this stage. */
  statusRollup: CaseStatus;
  /** Cure/response window in days; entering the stage sets cases.actionDueAt. */
  dueInDays?: number;
  /** Gates enforced on transition INTO this stage (checked against child records). */
  requiresNotice?: boolean;
  requiresHearing?: boolean;
  requiresPhotoEvidence?: boolean;
  /** Default fine amount when this stage assesses a fine (assessment/tracking only). */
  fineAmount?: number;
  /** Which notice template to use for this stage. */
  noticeTemplateKey?: string;
};

export const DEFAULT_VIOLATION_STAGES: WorkflowStage[] = [
  {
    key: "courtesyNotice",
    label: "Courtesy notice",
    statusRollup: "open",
    noticeTemplateKey: "courtesyNotice",
  },
  {
    key: "curePeriod",
    label: "Cure period",
    statusRollup: "awaitingHomeowner",
    dueInDays: 21,
    requiresNotice: true,
  },
  {
    key: "reinspection",
    label: "Reinspection",
    statusRollup: "open",
  },
  {
    key: "formalWarning",
    label: "Formal warning",
    statusRollup: "awaitingHomeowner",
    dueInDays: 14,
    requiresPhotoEvidence: true,
    noticeTemplateKey: "formalWarning",
  },
  {
    key: "hearingNotice",
    label: "Hearing notice",
    statusRollup: "escalated",
    dueInDays: 14,
    requiresNotice: true,
    noticeTemplateKey: "hearingNotice",
  },
  {
    key: "hearing",
    label: "Hearing",
    statusRollup: "escalated",
    requiresNotice: true,
  },
  {
    key: "fineAssessed",
    label: "Fine assessed",
    statusRollup: "escalated",
    requiresHearing: true,
    fineAmount: 50,
    noticeTemplateKey: "fineNotice",
  },
  {
    key: "resolved",
    label: "Resolved",
    statusRollup: "resolved",
  },
  {
    key: "escalatedExternal",
    label: "Escalated (external)",
    statusRollup: "escalated",
    requiresHearing: true,
  },
];

/** Simple open → in review → decision → closed ladder for non-violation types. */
const SIMPLE_STAGES = (reviewLabel: string): WorkflowStage[] => [
  { key: "submitted", label: "Submitted", statusRollup: "open" },
  { key: "inReview", label: reviewLabel, statusRollup: "open" },
  {
    key: "awaitingHomeowner",
    label: "Awaiting homeowner",
    statusRollup: "awaitingHomeowner",
    dueInDays: 14,
  },
  { key: "resolved", label: "Resolved", statusRollup: "resolved" },
  { key: "closed", label: "Closed", statusRollup: "closed" },
];

export const DEFAULT_WORKFLOWS: Record<CaseType, { name: string; stages: WorkflowStage[] }> = {
  violation: { name: "Violation enforcement", stages: DEFAULT_VIOLATION_STAGES },
  architectural: { name: "Architectural request", stages: SIMPLE_STAGES("Committee review") },
  maintenance: { name: "Maintenance", stages: SIMPLE_STAGES("Scheduling & work") },
  complaint: { name: "Complaint", stages: SIMPLE_STAGES("Under review") },
  inquiry: { name: "Inquiry", stages: SIMPLE_STAGES("Under review") },
  other: { name: "General", stages: SIMPLE_STAGES("Under review") },
};

export function firstStageFor(caseType: CaseType): WorkflowStage {
  return DEFAULT_WORKFLOWS[caseType].stages[0];
}
