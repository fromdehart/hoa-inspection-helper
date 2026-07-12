import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isFeatureEnabled } from "./lib/featureFlags";
import { effectiveAutonomy } from "./lib/stewardAutonomy";
import { draftWithReview } from "./lib/stewardPipeline";

/**
 * The Chase duty (PRD §8.5): drain `awaiting_agent` findings into drafted
 * follow-ups — the status-check emails the board president writes by hand
 * today. Two-pass pipeline per finding:
 *
 *   Steward pass  → composes the draft from a deterministic context bundle
 *   code prechecks → address present, length bounds (cheap, before any 2nd model call)
 *   Reviewer pass → independent verification; reject-with-reasons retries
 *                   the Steward once; still failing → needs_human on the Desk
 *
 * v1 scope: case_overdue findings → "pm_status_check" proposals. Other
 * queued kinds (arc_aging, motion_stalled) stay visible in the queue until
 * their chase playbooks land. Nothing is ever sent automatically: the
 * proposal carries the draft to the Desk, where approval logs it to the
 * case record (and the board sends it — email rails stay human/disabled on
 * beta by design).
 */

const CHASE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Work gathering (queries) and persistence (mutations) — plain runtime, no LLM.
// ---------------------------------------------------------------------------

export const listChaseWork = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const hoas = await ctx.db.query("hoas").collect();
    const work: Array<{
      hoaId: Id<"hoas">;
      hoaName: string;
      autonomy: Record<string, string> | undefined;
      findings: Array<{
        findingId: Id<"findings">;
        caseId: Id<"cases">;
        propertyId: Id<"properties">;
        title: string;
        address: string;
        caseTitle: string;
        stageKey: string;
        daysOverdue: number;
        recentEvents: string[];
      }>;
    }> = [];

    for (const hoa of hoas) {
      if (!(await isFeatureEnabled(ctx, hoa._id, "steward"))) continue;
      const config = await ctx.db
        .query("stewardConfig")
        .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
        .first();

      const queued = await ctx.db
        .query("findings")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoa._id).eq("status", "awaiting_agent"))
        .collect();

      const items = [];
      for (const f of queued) {
        if (f.kind !== "case_overdue" || !f.caseId || !f.propertyId) continue;

        // One active proposal per finding; decided ones start a cooldown.
        const priors = await ctx.db
          .query("stewardProposals")
          .withIndex("by_finding", (q) => q.eq("findingId", f._id))
          .collect();
        const blocked = priors.some(
          (p) =>
            p.status === "pending_approval" ||
            p.status === "needs_human" ||
            now - (p.decidedAt ?? p.createdAt) < CHASE_COOLDOWN_MS,
        );
        if (blocked) continue;

        const caseDoc = await ctx.db.get(f.caseId);
        const property = await ctx.db.get(f.propertyId);
        if (!caseDoc || !property) continue;
        if (caseDoc.status === "resolved" || caseDoc.status === "closed") continue;

        const events = await ctx.db
          .query("caseEvents")
          .withIndex("by_case", (q) => q.eq("caseId", f.caseId!))
          .order("desc")
          .take(3);

        items.push({
          findingId: f._id,
          caseId: f.caseId,
          propertyId: f.propertyId,
          title: f.title,
          address: property.address,
          caseTitle: caseDoc.title,
          stageKey: caseDoc.stageKey,
          daysOverdue:
            caseDoc.actionDueAt != null
              ? Math.max(1, Math.floor((now - caseDoc.actionDueAt) / (24 * 60 * 60 * 1000)))
              : 1,
          recentEvents: events.map(
            (e) => `${new Date(e.createdAt).toLocaleDateString()}: ${e.summary}`,
          ),
        });
      }
      if (items.length > 0) {
        work.push({
          hoaId: hoa._id,
          hoaName: hoa.name,
          autonomy: config?.autonomy,
          findings: items,
        });
      }
    }
    return work;
  },
});

export const recordProposal = internalMutation({
  args: {
    hoaId: v.id("hoas"),
    findingId: v.id("findings"),
    caseId: v.id("cases"),
    propertyId: v.id("properties"),
    autonomyLevel: v.union(v.literal("L1"), v.literal("L2"), v.literal("L3")),
    draftSubject: v.string(),
    draftBody: v.string(),
    contextSummary: v.string(),
    reviewerVerdict: v.union(v.literal("approved"), v.literal("rejected")),
    verdictReasons: v.optional(v.string()),
    attempts: v.number(),
    needsHuman: v.boolean(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const runId = await ctx.db.insert("agentRuns", {
      hoaId: args.hoaId,
      agent: "steward",
      duty: "chase",
      trigger: "cron:daily-chase",
      model: args.model,
      status: "ok",
      startedAt: now,
      endedAt: now,
      actionsCount: 1,
    });
    const status = args.needsHuman ? "needs_human" : "pending_approval";
    const proposalId = await ctx.db.insert("stewardProposals", {
      hoaId: args.hoaId,
      findingId: args.findingId,
      caseId: args.caseId,
      propertyId: args.propertyId,
      actionType: "pm_status_check",
      autonomyLevel: args.autonomyLevel,
      draftSubject: args.draftSubject,
      draftBody: args.draftBody,
      contextSummary: args.contextSummary,
      reviewerVerdict: args.reviewerVerdict,
      verdictReasons: args.verdictReasons,
      attempts: args.attempts,
      status,
      runId,
      createdAt: now,
    });
    await ctx.db.insert("agentActions", {
      hoaId: args.hoaId,
      runId,
      toolName: "draft_pm_status_check",
      argsSummary: args.needsHuman
        ? `Draft failed review ${args.attempts}x — escalated to the Desk`
        : `Drafted follow-up: "${args.draftSubject}"`,
      autonomyLevel: args.autonomyLevel,
      reviewerVerdict: args.reviewerVerdict,
      verdictReasons: args.verdictReasons,
      outcome: args.needsHuman ? "needs_human" : "queued",
      caseId: args.caseId,
      propertyId: args.propertyId,
      createdAt: now,
    });
    return proposalId;
  },
});

// ---------------------------------------------------------------------------
// Context, prompts, and prechecks — the pipeline loop lives in lib/stewardPipeline.
// ---------------------------------------------------------------------------

type ChaseItem = {
  address: string;
  caseTitle: string;
  stageKey: string;
  daysOverdue: number;
  recentEvents: string[];
};

function contextBlock(hoaName: string, item: ChaseItem): string {
  return [
    `HOA: ${hoaName}`,
    `Property: ${item.address}`,
    `Case: ${item.caseTitle}`,
    `Current stage: ${item.stageKey}`,
    `Days past the stage deadline: ${item.daysOverdue}`,
    `Recent case history:`,
    ...(item.recentEvents.length > 0 ? item.recentEvents.map((e) => `- ${e}`) : ["- (none)"]),
  ].join("\n");
}

const STEWARD_SYSTEM = `You are the Steward, the operations agent for a volunteer HOA board.
Draft a short, courteous status-check email to the property manager about an overdue case.
Rules:
- Use ONLY facts from the provided context. Never invent dates, names, letters, or events.
- Ask for: current status, what happens next, and by when. Nothing else.
- No threats, no new deadlines, no legal language, no commitments on the board's behalf.
- Plain text. Greeting "Hi," and sign-off "Thank you,\\nThe {HOA name} Board".
- 60–120 words.
Return STRICT JSON: {"subject": "...", "body": "..."}`;

const REVIEWER_SYSTEM = `You are the Reviewer. You independently verify a draft the Steward wrote
before it may proceed. You see the same context the Steward saw, and the draft. Reject unless ALL hold:
1. Every factual claim in the draft (dates, events, stage, address) appears in the context.
2. It is a status inquiry only — no threats, new deadlines, legal claims, or commitments.
3. It references the correct property address.
4. Professional, courteous tone; 40–160 words; plain text.
5. No personal data beyond the property address and case facts.
Return STRICT JSON: {"verdict": "approve"|"reject", "reasons": ["..."]}`;

/** Deterministic prechecks — run in code before spending a Reviewer call (PRD §11.2). */
function precheck(draft: { subject: string; body: string }, item: ChaseItem): string | null {
  if (!draft.subject.trim() || !draft.body.trim()) return "empty subject or body";
  const words = draft.body.trim().split(/\s+/).length;
  if (words < 30 || words > 200) return `body is ${words} words (expected 40-160)`;
  const houseNumber = item.address.trim().split(/\s+/)[0];
  if (houseNumber && !draft.body.includes(houseNumber) && !draft.subject.includes(houseNumber)) {
    return "draft does not reference the property address";
  }
  return null;
}

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const work = await ctx.runQuery(internal.stewardChase.listChaseWork, {});

    for (const hoa of work) {
      const level = effectiveAutonomy("pm_status_check", hoa.autonomy);
      if (level === "L0") continue; // observe-only: the finding stays on the Desk
      const autonomyLevel = level;

      for (const item of hoa.findings) {
        try {
          await chaseOne(ctx, hoa, item, autonomyLevel);
        } catch (e) {
          // Leave the finding awaiting_agent; tomorrow's run retries it
          // (no proposal recorded = no cooldown). The cron failure surface
          // catches systemic errors.
          console.error("chase failed for finding", item.findingId, e);
        }
      }
    }
  },
});

type ChaseWorkItem = ChaseItem & {
  findingId: Id<"findings">;
  caseId: Id<"cases">;
  propertyId: Id<"properties">;
};

async function chaseOne(
  ctx: Pick<ActionCtx, "runAction" | "runMutation">,
  hoa: { hoaId: Id<"hoas">; hoaName: string },
  item: ChaseWorkItem,
  autonomyLevel: "L1" | "L2" | "L3",
): Promise<void> {
  const context = contextBlock(hoa.hoaName, item);
  const result = await draftWithReview(ctx, {
    stewardSystem: STEWARD_SYSTEM.replace("{HOA name}", hoa.hoaName),
    reviewerSystem: REVIEWER_SYSTEM,
    context,
    precheck: (draft) => precheck(draft, item),
  });

  await ctx.runMutation(internal.stewardChase.recordProposal, {
    hoaId: hoa.hoaId,
    findingId: item.findingId,
    caseId: item.caseId,
    propertyId: item.propertyId,
    autonomyLevel,
    draftSubject: result.draft?.subject ?? "(no draft survived review)",
    draftBody: result.draft?.body ?? "",
    contextSummary: context,
    reviewerVerdict: result.draft ? "approved" : "rejected",
    verdictReasons: result.reasons || undefined,
    attempts: result.attempts,
    needsHuman: !result.draft,
    model: result.model,
  });
}
