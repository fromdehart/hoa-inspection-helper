/**
 * Playbook routing for the findings pipeline: for every finding KIND the
 * detectors can emit, who acts on it?
 *
 *   "human" — a human surface already exists or judgment/authority is
 *             human-only; the finding lands on the Desk.
 *   "agent" — the Steward's LLM pass consumes it ("here is everything the
 *             monitors found — decide and draft"), always behind the
 *             Reviewer gate and the autonomy ladder.
 *
 * Unknown kinds default to "agent": if the deterministic side doesn't know
 * what to do, the agent looks. Deterministic side-effects that accompany a
 * detection (e.g. escalating an unverified deadline) live in the detector
 * itself — routing only decides who picks the finding up.
 */

export type FindingRoute = "human" | "agent";

export const FINDING_ROUTES: Record<string, FindingRoute> = {
  /** Chase duty: draft the follow-up the president writes by hand today. */
  case_overdue: "agent",
  /** Chase duty: nudge the ARC reviewers / draft the owner update. */
  arc_aging: "agent",
  /** Verification requires human evidence; escalation already happened deterministically. */
  deadline_unverified: "human",
  /** Chase duty: nudge the members who haven't voted. */
  motion_stalled: "agent",
  /** Filing UI exists (quarantine strip); Phase-2 triage upgrade moves this to "agent". */
  email_quarantined: "human",
  /** Fix-photo review strip exists; approving fixes is human judgment. */
  fix_photo_pending: "human",
  /** Admin review flow exists (Walkthrough → ready to review). */
  inspection_ready_for_review: "human",
  /** A member emailed a concurrence but no single open motion matches — human links it. */
  concurrence_needs_match: "human",
  /** An email plausibly verifies an open compliance deadline — human attaches evidence. */
  deadline_evidence_maybe: "human",
  /** Financial mail arrived — treasurer runs the recurring checks. */
  financial_packet_review: "human",
  /** Vendor work stuck in quote/approved — human decides push vs drop (chase playbook later). */
  work_order_stalled: "human",
};

export function routeForKind(kind: string): FindingRoute {
  return FINDING_ROUTES[kind] ?? "agent";
}
