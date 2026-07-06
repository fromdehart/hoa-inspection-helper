import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { caseStatusValidator, caseTypeValidator } from "./lib/caseValidators";
import type { CaseType } from "./lib/caseValidators";
import { DEFAULT_WORKFLOWS } from "./lib/defaultWorkflows";

const stageValidator = v.object({
  key: v.string(),
  label: v.string(),
  statusRollup: caseStatusValidator,
  dueInDays: v.optional(v.number()),
  requiresNotice: v.optional(v.boolean()),
  requiresHearing: v.optional(v.boolean()),
  requiresPhotoEvidence: v.optional(v.boolean()),
  fineAmount: v.optional(v.number()),
  noticeTemplateKey: v.optional(v.string()),
});

/**
 * Load the active workflow for an HOA + caseType, seeding the default ladder
 * on first touch ("ensure" idiom). Safe to call from any case mutation.
 */
export async function getOrSeedWorkflow(
  ctx: MutationCtx,
  hoaId: Id<"hoas">,
  caseType: CaseType,
): Promise<Doc<"caseWorkflows">> {
  const existing = await ctx.db
    .query("caseWorkflows")
    .withIndex("by_hoa_type", (q) => q.eq("hoaId", hoaId).eq("caseType", caseType))
    .first();
  if (existing) return existing;

  const defaults = DEFAULT_WORKFLOWS[caseType];
  const id = await ctx.db.insert("caseWorkflows", {
    hoaId,
    caseType,
    name: defaults.name,
    stages: defaults.stages,
    isActive: true,
    updatedAt: Date.now(),
  });
  const doc = await ctx.db.get(id);
  if (!doc) throw new Error("Failed to seed workflow.");
  return doc;
}

/** Read-only variant for queries (no seeding); falls back to the default constant. */
export function workflowStagesOrDefault(
  workflow: Doc<"caseWorkflows"> | null,
  caseType: CaseType,
): Doc<"caseWorkflows">["stages"] {
  return workflow?.stages ?? DEFAULT_WORKFLOWS[caseType].stages;
}

export const getForType = query({
  args: { caseType: caseTypeValidator },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const workflow = await ctx.db
      .query("caseWorkflows")
      .withIndex("by_hoa_type", (q) => q.eq("hoaId", viewer.hoaId).eq("caseType", args.caseType))
      .first();
    if (workflow) return workflow;
    // Not seeded yet — return the defaults in the same shape (unsaved).
    const defaults = DEFAULT_WORKFLOWS[args.caseType];
    return {
      _id: null,
      hoaId: viewer.hoaId,
      caseType: args.caseType,
      name: defaults.name,
      stages: defaults.stages,
      isActive: true,
      updatedAt: 0,
    };
  },
});

export const update = mutation({
  args: {
    caseType: caseTypeValidator,
    name: v.string(),
    stages: v.array(stageValidator),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    if (args.stages.length === 0) throw new Error("A workflow needs at least one stage.");

    const keys = args.stages.map((s) => s.key);
    if (new Set(keys).size !== keys.length) {
      throw new Error("Stage keys must be unique.");
    }

    // Guard: every stage currently referenced by an open case must still exist.
    const openStatuses = new Set(["open", "awaitingHomeowner", "escalated"]);
    const hoaCases = await ctx.db
      .query("cases")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    const referencedKeys = new Set(
      hoaCases
        .filter((c) => c.caseType === args.caseType && openStatuses.has(c.status))
        .map((c) => c.stageKey),
    );
    const keySet = new Set(keys);
    for (const refKey of referencedKeys) {
      if (!keySet.has(refKey)) {
        throw new Error(
          `Cannot remove stage "${refKey}": open cases are currently in that stage.`,
        );
      }
    }

    const workflow = await getOrSeedWorkflow(ctx, viewer.hoaId, args.caseType);
    await ctx.db.patch(workflow._id, {
      name: args.name.trim() || workflow.name,
      stages: args.stages,
      updatedAt: Date.now(),
    });
    return null;
  },
});
