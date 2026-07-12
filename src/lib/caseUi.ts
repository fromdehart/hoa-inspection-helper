/** Single source of truth for case UI labels/colors/icons (do not duplicate per page). */

export type CaseStatus = "open" | "awaitingHomeowner" | "resolved" | "closed" | "escalated";

export type CaseType =
  | "violation"
  | "architectural"
  | "maintenance"
  | "complaint"
  | "inquiry"
  | "other";

export type StatusChipConfig = {
  label: string;
  className: string;
  emoji?: string;
};

export const CASE_STATUS_CONFIG: Record<CaseStatus, StatusChipConfig> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800", emoji: "📂" },
  awaitingHomeowner: {
    label: "Awaiting homeowner",
    className: "bg-amber-100 text-amber-800",
    emoji: "⏳",
  },
  resolved: { label: "Resolved", className: "bg-green-100 text-green-800", emoji: "✅" },
  closed: { label: "Closed", className: "bg-slate-200 text-slate-700", emoji: "🗂️" },
  escalated: { label: "Escalated", className: "bg-red-100 text-red-800", emoji: "⚠️" },
};

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  violation: "Violation",
  architectural: "Architectural",
  maintenance: "Maintenance",
  complaint: "Complaint",
  inquiry: "Inquiry",
  other: "Other",
};

export type CaseEventType =
  | "opened"
  | "stageChanged"
  | "noteAdded"
  | "noticeGenerated"
  | "noticeSent"
  | "photoAttached"
  | "fixSubmitted"
  | "hearingScheduled"
  | "hearingDecided"
  | "fineAssessed"
  | "fineWaived"
  | "assigned"
  | "reopened"
  | "closed"
  | "emailReceived";

export const CASE_EVENT_CONFIG: Record<CaseEventType, { label: string; emoji: string }> = {
  opened: { label: "Case opened", emoji: "📂" },
  stageChanged: { label: "Stage changed", emoji: "➡️" },
  noteAdded: { label: "Note", emoji: "📝" },
  noticeGenerated: { label: "Notice generated", emoji: "📄" },
  noticeSent: { label: "Notice sent", emoji: "📬" },
  photoAttached: { label: "Photo added", emoji: "📷" },
  fixSubmitted: { label: "Fix submitted", emoji: "🔧" },
  hearingScheduled: { label: "Hearing scheduled", emoji: "🗓️" },
  hearingDecided: { label: "Hearing decided", emoji: "⚖️" },
  fineAssessed: { label: "Fine assessed", emoji: "💵" },
  fineWaived: { label: "Fine waived", emoji: "🤝" },
  assigned: { label: "Assignment", emoji: "👤" },
  reopened: { label: "Reopened", emoji: "🔄" },
  closed: { label: "Closed", emoji: "🗂️" },
  emailReceived: { label: "Email received", emoji: "✉️" },
};

/** Plain-language stage labels (fallback when the workflow doc isn't loaded). */
export const STAGE_LABELS: Record<string, string> = {
  courtesyNotice: "Courtesy notice",
  curePeriod: "Cure period",
  reinspection: "Reinspection",
  formalWarning: "Formal warning",
  hearingNotice: "Hearing notice",
  hearing: "Hearing",
  fineAssessed: "Fine assessed",
  resolved: "Resolved",
  escalatedExternal: "Escalated (external)",
  submitted: "Submitted",
  inReview: "In review",
  awaitingHomeowner: "Awaiting homeowner",
  closed: "Closed",
};

export function stageLabel(stageKey: string): string {
  return STAGE_LABELS[stageKey] ?? stageKey;
}

/* ---- Staff redesign additions (petrol/paper design language). ----
   CASE_STATUS_CONFIG above still feeds the homeowner + board surfaces;
   staff surfaces use these calm-chip mappings instead. */

import type { ChipTone } from "@/components/ui/chip";

export const CASE_STATUS_CHIP: Record<CaseStatus, { label: string; tone: ChipTone }> = {
  open: { label: "Open", tone: "open" },
  awaitingHomeowner: { label: "Waiting", tone: "wait" },
  escalated: { label: "In process", tone: "proc" },
  resolved: { label: "Resolved", tone: "ok" },
  closed: { label: "Closed", tone: "mute" },
};

/** Case statuses that count as "open work" everywhere on staff surfaces. */
export const OPEN_CASE_STATUSES: ReadonlySet<CaseStatus> = new Set([
  "open",
  "awaitingHomeowner",
  "escalated",
]);

/** Staff-friendly step names ("Noticed", "Time to fix"…) over workflow stage keys. */
export const STAGE_DISPLAY: Record<string, string> = {
  courtesyNotice: "Noticed",
  curePeriod: "Time to fix",
  reinspection: "Follow-up",
  formalWarning: "Follow-up",
  hearingNotice: "Hearing notice",
  hearing: "Hearing",
  fineAssessed: "Fine assessed",
  resolved: "Resolved",
  escalatedExternal: "Escalated (external)",
  submitted: "Received",
  inReview: "In review",
  awaitingHomeowner: "Homeowner's turn",
  closed: "Resolved",
};

export function stageDisplay(stageKey: string): string {
  return STAGE_DISPLAY[stageKey] ?? stageLabel(stageKey);
}

export function formatEventTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
