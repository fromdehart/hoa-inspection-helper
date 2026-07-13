/**
 * The standard Virginia-HOA compliance calendar — the "due dates matrix" the
 * RTT board asked for verbatim (OM §2.4). Every entry here corresponds to a
 * deadline that was missed, chased, or hand-tracked in the observed corpus.
 * Anchors are month/day; seeding computes the next occurrence.
 */

export type ComplianceTemplate = {
  title: string;
  detail: string;
  /** 1-12 */
  month: number;
  /** 1-28 to stay valid in every month */
  day: number;
  recurrence: string;
};

export const COMPLIANCE_LIBRARY: ComplianceTemplate[] = [
  {
    title: "SCC annual report filing",
    detail:
      "Virginia State Corporation Commission annual corporate filing. Verify the officer list is current — stale officer data caused rejected filings in the past.",
    month: 3,
    day: 1,
    recurrence: "annual",
  },
  {
    title: "DPOR CIC association license renewal",
    detail:
      "Common Interest Community license via DPOR. This lapsed silently once — verification requires the renewal confirmation, not the absence of a notice.",
    month: 1,
    day: 15,
    recurrence: "annual",
  },
  {
    title: "Estimated taxes — Q1 (federal + state)",
    detail: "Quarterly estimated tax payment; confirm the CPA's recommendation letter and the actual payment date.",
    month: 4,
    day: 15,
    recurrence: "quarterly",
  },
  {
    title: "Estimated taxes — Q2 (federal + state)",
    detail: "Quarterly estimated tax payment; confirm payment cleared before the due date.",
    month: 6,
    day: 15,
    recurrence: "quarterly",
  },
  {
    title: "Estimated taxes — Q3 (federal + state)",
    detail: "Quarterly estimated tax payment; confirm payment cleared before the due date.",
    month: 9,
    day: 15,
    recurrence: "quarterly",
  },
  {
    title: "Estimated taxes — Q4 (federal + state)",
    detail: "Quarterly estimated tax payment; confirm payment cleared before the due date.",
    month: 1,
    day: 15,
    recurrence: "quarterly",
  },
  {
    title: "Annual audit engagement",
    detail: "Engage the CPA firm for the annual audit; last year's audit surfaced unresolved findings months late.",
    month: 2,
    day: 1,
    recurrence: "annual",
  },
  {
    title: "Insurance & demographics data call",
    detail:
      "Annual homeowner insurance-verification / demographics / lease collection. 'Late and dragged out' three years running — start the notice cycle on time.",
    month: 7,
    day: 1,
    recurrence: "annual",
  },
  {
    title: "Annual meeting + advance notice",
    detail: "Schedule the annual meeting and issue the statutory advance notice to all owners.",
    month: 11,
    day: 1,
    recurrence: "annual",
  },
  {
    title: "Distribute the annual meeting schedule",
    detail: "Send the board-meeting schedule for the year to all owners (email + postal, per standard process).",
    month: 2,
    day: 15,
    recurrence: "annual",
  },
];

/** Next occurrence of a month/day anchor strictly after `from`. */
export function nextOccurrence(t: ComplianceTemplate, from: number): number {
  const d = new Date(from);
  const candidate = new Date(d.getFullYear(), t.month - 1, t.day, 12, 0, 0);
  if (candidate.getTime() <= from) {
    return new Date(d.getFullYear() + 1, t.month - 1, t.day, 12, 0, 0).getTime();
  }
  return candidate.getTime();
}
