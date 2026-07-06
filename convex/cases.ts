import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireHomeownerForProperty } from "./lib/homeownerAuth";
import {
  caseSourceValidator,
  caseStatusValidator,
  caseTypeValidator,
  severityValidator,
} from "./lib/caseValidators";
import { firstStageFor } from "./lib/defaultWorkflows";
import { logCaseEvent } from "./lib/caseEvents";
import { syncPropertyStatusFromCases } from "./lib/propertyStatusRollup";
import { requireFeature } from "./lib/featureFlags";
import { evaluateStageGates } from "./lib/caseGates";
import { getOrSeedWorkflow, workflowStagesOrDefault } from "./caseWorkflows";

/**
 * Find the open violation case for a property, if any (used by the legacy
 * mirror hooks in photos/fixPhotos/properties).
 */
export async function findOpenViolationCase(
  ctx: MutationCtx,
  propertyId: Id<"properties">,
): Promise<Doc<"cases"> | null> {
  const cases = await ctx.db
    .query("cases")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  return (
    cases.find(
      (c) =>
        c.caseType === "violation" &&
        (c.status === "open" || c.status === "awaitingHomeowner" || c.status === "escalated"),
    ) ?? null
  );
}

/** Shared case-opening path used by the `create` mutation, legacy hooks, and email intake. */
export async function openCaseInternal(
  ctx: MutationCtx,
  args: {
    hoaId: Id<"hoas">;
    propertyId: Id<"properties">;
    caseType: Doc<"cases">["caseType"];
    title: string;
    source: Doc<"cases">["source"];
    description?: string;
    category?: string;
    severity?: Doc<"cases">["severity"];
    actorRole: Doc<"caseEvents">["actorRole"];
    actorClerkUserId?: string;
    /** Historical timestamp — backfill only. */
    openedAt?: number;
  },
): Promise<Id<"cases">> {
  const now = Date.now();
  const openedAt = args.openedAt ?? now;
  const workflow = await getOrSeedWorkflow(ctx, args.hoaId, args.caseType);
  const firstStage = workflow.stages[0] ?? firstStageFor(args.caseType);
  const caseId = await ctx.db.insert("cases", {
    hoaId: args.hoaId,
    propertyId: args.propertyId,
    caseType: args.caseType,
    category: args.category,
    title: args.title,
    description: args.description,
    severity: args.severity,
    stageKey: firstStage.key,
    status: firstStage.statusRollup,
    source: args.source,
    createdByClerkUserId: args.actorClerkUserId,
    openedAt,
    updatedAt: now,
  });
  await logCaseEvent(ctx, {
    hoaId: args.hoaId,
    caseId,
    propertyId: args.propertyId,
    type: "opened",
    actorRole: args.actorRole,
    actorClerkUserId: args.actorClerkUserId,
    summary: `Case opened: ${args.title}`,
    visibility: "shared",
    createdAt: args.openedAt,
  });
  return caseId;
}

export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    caseType: caseTypeValidator,
    title: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    severity: v.optional(severityValidator),
    source: v.optional(caseSourceValidator),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    await requireFeature(ctx, viewer.hoaId, "cases");
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) {
      throw new Error("Property not found.");
    }
    const title = args.title.trim();
    if (!title) throw new Error("Case title is required.");

    const caseId = await openCaseInternal(ctx, {
      hoaId: viewer.hoaId,
      propertyId: args.propertyId,
      caseType: args.caseType,
      title,
      description: args.description?.trim() || undefined,
      category: args.category,
      severity: args.severity,
      source: args.source ?? (viewer.role === "inspector" ? "inspection" : "managerManual"),
      actorRole: viewer.role === "inspector" ? "inspector" : "admin",
      actorClerkUserId: viewer.clerkUserId,
    });
    await syncPropertyStatusFromCases(ctx, args.propertyId);
    return caseId;
  },
});

export const addNote = mutation({
  args: {
    caseId: v.id("cases"),
    text: v.string(),
    visibility: v.union(v.literal("shared"), v.literal("internal")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) throw new Error("Case not found.");
    const text = args.text.trim();
    if (!text) throw new Error("Note text is required.");

    await logCaseEvent(ctx, {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      type: "noteAdded",
      actorRole: viewer.role === "inspector" ? "inspector" : "admin",
      actorClerkUserId: viewer.clerkUserId,
      summary: text,
      visibility: args.visibility,
    });
    await ctx.db.patch(caseDoc._id, { updatedAt: Date.now() });
    return null;
  },
});

export const assign = mutation({
  args: {
    caseId: v.id("cases"),
    assignedToClerkUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) throw new Error("Case not found.");

    await ctx.db.patch(caseDoc._id, {
      assignedToClerkUserId: args.assignedToClerkUserId,
      updatedAt: Date.now(),
    });
    await logCaseEvent(ctx, {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      type: "assigned",
      actorRole: "admin",
      actorClerkUserId: viewer.clerkUserId,
      summary: args.assignedToClerkUserId ? "Case assigned" : "Case unassigned",
      visibility: "internal",
    });
    return null;
  },
});

export const get = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    // Board: read-only oversight (all mutations remain admin/inspector-only).
    const viewer = await requireViewerRole(ctx, ["admin", "inspector", "board"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) return null;
    return caseDoc;
  },
});

export const listForProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) return [];
    const cases = await ctx.db
      .query("cases")
      .withIndex("by_hoa_property", (q) =>
        q.eq("hoaId", viewer.hoaId).eq("propertyId", args.propertyId),
      )
      .collect();
    return cases.sort((a, b) => b.openedAt - a.openedAt);
  },
});

export const listForHoa = query({
  args: {
    status: v.optional(caseStatusValidator),
    caseType: v.optional(caseTypeValidator),
  },
  handler: async (ctx, args) => {
    // Board: read-only oversight of the case queue (server-side address join,
    // no broad property access).
    const viewer = await requireViewerRole(ctx, ["admin", "inspector", "board"]);
    const rows = args.status
      ? await ctx.db
          .query("cases")
          .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", args.status!))
          .collect()
      : await ctx.db
          .query("cases")
          .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
          .collect();
    const filtered = args.caseType ? rows.filter((c) => c.caseType === args.caseType) : rows;
    const withAddress = await Promise.all(
      filtered.map(async (c) => {
        const property = await ctx.db.get(c.propertyId);
        return { ...c, address: property?.address ?? "" };
      }),
    );
    return withAddress.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/**
 * Advance/regress a case along its workflow ladder. Legality: forward by
 * exactly one stage, any backward move (logged), or a jump to a
 * resolved/closed-rollup stage from anywhere (closing early must always be
 * possible; it bypasses gates by design). Forward skips are rejected; gates on
 * the target stage are enforced server-side.
 */
export const transitionStage = mutation({
  args: {
    caseId: v.id("cases"),
    toStageKey: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) throw new Error("Case not found.");

    const workflow = await getOrSeedWorkflow(ctx, caseDoc.hoaId, caseDoc.caseType);
    const stages = workflow.stages;
    const fromIdx = stages.findIndex((s) => s.key === caseDoc.stageKey);
    const toIdx = stages.findIndex((s) => s.key === args.toStageKey);
    if (toIdx === -1) throw new Error("Unknown target stage.");
    if (fromIdx === -1) {
      throw new Error(
        "This case's current stage is no longer in the workflow. Edit the workflow to restore it.",
      );
    }
    if (toIdx === fromIdx) throw new Error("Case is already in that stage.");

    const target = stages[toIdx];
    const isCloseJump = target.statusRollup === "resolved" || target.statusRollup === "closed";
    const isBackward = toIdx < fromIdx;
    const isNext = toIdx === fromIdx + 1;
    if (!isNext && !isBackward && !isCloseJump) {
      throw new Error(`Cannot skip stages: the next stage is "${stages[fromIdx + 1].label}".`);
    }

    // Gates apply to forward moves; early-close jumps and regressions bypass them.
    if (isNext && !isCloseJump) {
      const unmet = await evaluateStageGates(ctx, caseDoc, target);
      if (unmet.length > 0) {
        throw new Error(`Cannot enter ${target.label}: ${unmet.join("; ")}.`);
      }
    }

    const now = Date.now();
    await ctx.db.patch(caseDoc._id, {
      stageKey: target.key,
      status: target.statusRollup,
      actionDueAt: target.dueInDays ? now + target.dueInDays * 86_400_000 : undefined,
      closedAt: isCloseJump ? now : undefined,
      updatedAt: now,
    });

    await logCaseEvent(ctx, {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      type: "stageChanged",
      actorRole: "admin",
      actorClerkUserId: viewer.clerkUserId,
      fromStageKey: caseDoc.stageKey,
      toStageKey: target.key,
      summary:
        `Moved from ${stages[fromIdx].label} to ${target.label}` +
        (args.note?.trim() ? ` — ${args.note.trim()}` : ""),
      visibility: "shared",
    });
    if (isCloseJump) {
      await logCaseEvent(ctx, {
        hoaId: caseDoc.hoaId,
        caseId: caseDoc._id,
        propertyId: caseDoc.propertyId,
        type: "closed",
        actorRole: "admin",
        actorClerkUserId: viewer.clerkUserId,
        summary: target.statusRollup === "resolved" ? "Case resolved" : "Case closed",
        visibility: "shared",
      });
    } else if (isBackward && (caseDoc.status === "resolved" || caseDoc.status === "closed")) {
      await logCaseEvent(ctx, {
        hoaId: caseDoc.hoaId,
        caseId: caseDoc._id,
        propertyId: caseDoc.propertyId,
        type: "reopened",
        actorRole: "admin",
        actorClerkUserId: viewer.clerkUserId,
        summary: "Case reopened",
        visibility: "shared",
      });
    }

    await syncPropertyStatusFromCases(ctx, caseDoc.propertyId);
    return null;
  },
});

/**
 * Stage options for the "Advance stage" UI: every stage with whether moving
 * there is currently allowed and, if not, why. Uses the same legality + gate
 * helpers as `transitionStage`, so UI hints and enforcement can't drift.
 */
export const getStageOptions = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) return [];

    const workflow = await ctx.db
      .query("caseWorkflows")
      .withIndex("by_hoa_type", (q) =>
        q.eq("hoaId", caseDoc.hoaId).eq("caseType", caseDoc.caseType),
      )
      .first();
    const stages = workflowStagesOrDefault(workflow, caseDoc.caseType);
    const fromIdx = stages.findIndex((s) => s.key === caseDoc.stageKey);

    return Promise.all(
      stages.map(async (stage, idx) => {
        const isCurrent = idx === fromIdx;
        const isCloseJump = stage.statusRollup === "resolved" || stage.statusRollup === "closed";
        const isBackward = idx < fromIdx;
        const isNext = idx === fromIdx + 1;

        let allowed = !isCurrent && (isNext || isBackward || isCloseJump);
        let unmetGates: string[] = [];
        if (allowed && isNext && !isCloseJump) {
          unmetGates = await evaluateStageGates(ctx, caseDoc, stage);
          allowed = unmetGates.length === 0;
        }
        if (!isCurrent && !isNext && !isBackward && !isCloseJump) {
          unmetGates = ["Stages cannot be skipped"];
        }

        return {
          key: stage.key,
          label: stage.label,
          statusRollup: stage.statusRollup,
          dueInDays: stage.dueInDays,
          fineAmount: stage.fineAmount,
          isCurrent,
          allowed,
          unmetGates,
        };
      }),
    );
  },
});

/**
 * Paginated case timeline, newest first. Admin/inspector see everything;
 * board members see shared-visibility events only (internal notes are staff-only).
 */
export const getTimeline = query({
  args: {
    caseId: v.id("cases"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector", "board"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const result = await ctx.db
      .query("caseEvents")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .paginate(args.paginationOpts);
    if (viewer.role === "board") {
      return { ...result, page: result.page.filter((e) => e.visibility === "shared") };
    }
    return result;
  },
});

/**
 * Homeowner: cases on a property they own. Separate from the staff queries by
 * design — never widen those; this one gates on requireHomeownerForProperty.
 */
export const listForHomeowner = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requireHomeownerForProperty(ctx, args.propertyId);
    const cases = await ctx.db
      .query("cases")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    return cases
      .sort((a, b) => b.openedAt - a.openedAt)
      .map((c) => ({
        _id: c._id,
        caseType: c.caseType,
        title: c.title,
        stageKey: c.stageKey,
        status: c.status,
        actionDueAt: c.actionDueAt,
        openedAt: c.openedAt,
        closedAt: c.closedAt,
      }));
  },
});

/**
 * Homeowner: shared-visibility timeline for their own case. Internal notes and
 * actor identities are never included.
 */
export const getTimelineForHomeowner = query({
  args: {
    caseId: v.id("cases"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) return { page: [], isDone: true, continueCursor: "" };
    await requireHomeownerForProperty(ctx, caseDoc.propertyId);

    const result = await ctx.db
      .query("caseEvents")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page
        .filter((e) => e.visibility === "shared")
        .map((e) => ({
          _id: e._id,
          type: e.type,
          summary: e.summary,
          fromStageKey: e.fromStageKey,
          toStageKey: e.toStageKey,
          createdAt: e.createdAt,
        })),
    };
  },
});
