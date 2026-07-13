/**
 * The autonomy ladder (PRD §4.2): every ACTION TYPE has a level; the board
 * promotes/demotes per type from Settings. Levels:
 *
 *   L0 observe          — read and surface only
 *   L1 draft            — produce the artifact; a human sends/applies it
 *   L2 act-on-approval  — fully prepared action in the Desk queue; one tap executes
 *   L3 auto-act + log   — executes automatically; logged, sampled post-hoc
 *
 * DEFAULTS are the conservative column of the PRD table; CEILINGS are hard
 * caps the config can never exceed (enforced in code, not prompts). Hearings
 * outcomes, fines, and legal escalation are not action types at all — they
 * are human-only, forever.
 */

export type AutonomyLevel = "L0" | "L1" | "L2" | "L3";

export type StewardActionType =
  | "internal_note" // notes, case links, classifications
  | "board_reminder" // reminders/digests to board members
  | "pm_status_check" // status-check email to PM / vendor
  | "file_intake_case" // filing intake into a new case
  | "homeowner_letter" // homeowner-facing letters & notices
  | "stage_transition" // case stage transitions (never automatic)
  | "hearing_notice" // hearing scheduling / notice send
  | "open_motion" // opening a concurrence/vote
  | "email_reply" // drafted reply to a filed homeowner email
  | "record_concurrence" // recording an observed email/text vote as evidence
  | "financial_questions"; // drafted clarification questions about financial mail

export const AUTONOMY_DEFAULTS: Record<StewardActionType, AutonomyLevel> = {
  internal_note: "L3",
  board_reminder: "L3",
  pm_status_check: "L2",
  file_intake_case: "L2",
  homeowner_letter: "L1",
  stage_transition: "L2",
  hearing_notice: "L2",
  open_motion: "L2",
  email_reply: "L1",
  record_concurrence: "L2",
  financial_questions: "L1",
};

export const AUTONOMY_CEILINGS: Record<StewardActionType, AutonomyLevel> = {
  internal_note: "L3",
  board_reminder: "L3",
  pm_status_check: "L3",
  file_intake_case: "L3",
  homeowner_letter: "L2",
  stage_transition: "L2",
  hearing_notice: "L2",
  open_motion: "L3",
  email_reply: "L2",
  record_concurrence: "L3",
  financial_questions: "L2",
};

const LEVEL_ORDER: AutonomyLevel[] = ["L0", "L1", "L2", "L3"];

function minLevel(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return LEVEL_ORDER.indexOf(a) <= LEVEL_ORDER.indexOf(b) ? a : b;
}

/**
 * Resolve the effective level for an action type: configured value clamped to
 * the ceiling, defaulting conservatively. Unknown config strings are ignored.
 */
export function effectiveAutonomy(
  actionType: StewardActionType,
  config: Record<string, string> | undefined,
): AutonomyLevel {
  const raw = config?.[actionType];
  const configured = LEVEL_ORDER.includes(raw as AutonomyLevel)
    ? (raw as AutonomyLevel)
    : AUTONOMY_DEFAULTS[actionType];
  return minLevel(configured, AUTONOMY_CEILINGS[actionType]);
}
