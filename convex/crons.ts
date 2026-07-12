import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * The Steward's heartbeat (PRD §8.1). Time-based proactivity is what email
 * can never give a volunteer board: these sweeps run whether or not anyone
 * is paying attention. Every job is a no-op for HOAs without the "steward"
 * feature flag (the kill switch), and every invocation writes an agentRuns
 * row so silence is distinguishable from failure.
 */
const crons = cronJobs();

// Daily staleness sweep: overdue cases, aging ARC applications, unverified
// compliance deadlines. UTC 11:00 ≈ morning US East, before the board's day.
crons.daily(
  "steward daily sweep",
  { hourUTC: 11, minuteUTC: 0 },
  internal.steward.dailySweep,
);

// Deterministic internal nudges (ARC reviewers, stalled votes) — facts, not
// prose, so no LLM/Reviewer involved.
crons.daily(
  "steward daily nudges",
  { hourUTC: 11, minuteUTC: 15 },
  internal.steward.internalNudges,
);

// Chase duty: drain awaiting_agent findings into Reviewer-verified drafts.
// Runs after the sweep so it always works from a fresh queue.
crons.daily(
  "steward daily chase",
  { hourUTC: 11, minuteUTC: 30 },
  internal.stewardChase.run,
);

// Weekly digest rollup, Monday mornings.
crons.weekly(
  "steward weekly digest",
  { dayOfWeek: "monday", hourUTC: 12, minuteUTC: 0 },
  internal.steward.weeklyDigest,
);

export default crons;
