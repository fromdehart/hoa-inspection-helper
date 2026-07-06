import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { logCaseEvent } from "../lib/caseEvents";

/**
 * One-time migration: create one violation case per inspected property,
 * seeding the timeline from existing timestamps. Insert-only — never touches
 * properties.status or any legacy field. Idempotent (marker check) and
 * cursor-batched. Run per-HOA:
 *
 *   npx convex run migrations/backfillCases:run '{"hoaId":"...","limit":100,"dryRun":true}'
 *
 * Rollback (deletes ONLY marker-tagged cases + their events):
 *
 *   npx convex run migrations/backfillCases:rollback '{"hoaId":"..."}'
 */

const BACKFILL_MARKER = "Backfilled from prior inspection data";
const CURE_DAYS_DEFAULT = 21;

function hasInspectionSubstance(p: Doc<"properties">, photoCount: number): boolean {
  return !!(
    p.inspectorNotes ||
    p.inspectorNotesFront ||
    p.inspectorNotesSide ||
    p.inspectorNotesBack ||
    p.aiLetterBullets ||
    p.generatedLetterHtml ||
    photoCount > 0
  );
}

async function backfillOne(
  ctx: MutationCtx,
  property: Doc<"properties">,
  hoaId: Id<"hoas">,
): Promise<"created" | "skipped"> {
  // Idempotency: skip if a backfilled case already exists for this property.
  const existing = await ctx.db
    .query("cases")
    .withIndex("by_property", (q) => q.eq("propertyId", property._id))
    .collect();
  if (existing.some((c) => c.description === BACKFILL_MARKER)) return "skipped";

  const photos = await ctx.db
    .query("photos")
    .withIndex("by_property", (q) => q.eq("propertyId", property._id))
    .collect();
  if (!hasInspectionSubstance(property, photos.length)) return "skipped";

  const fixPhotos = await ctx.db
    .query("fixPhotos")
    .withIndex("by_property", (q) => q.eq("propertyId", property._id))
    .collect();

  const openedAt = property.inspectionNotesEnteredAt ?? property.createdAt;
  const isComplete = property.status === "complete";
  const resolvedFixPhotos = fixPhotos.filter((f) => f.verificationStatus === "resolved");
  const closedAt = isComplete
    ? (resolvedFixPhotos.length
        ? Math.max(...resolvedFixPhotos.map((f) => f.uploadedAt))
        : Date.now())
    : undefined;

  // Stage/status mapping from legacy fields.
  let stageKey: string;
  let status: Doc<"cases">["status"];
  let actionDueAt: number | undefined;
  if (isComplete) {
    stageKey = "resolved";
    status = "resolved";
  } else if (property.letterSentAt) {
    stageKey = "curePeriod";
    status = "awaitingHomeowner";
    actionDueAt = property.letterSentAt + CURE_DAYS_DEFAULT * 86_400_000;
  } else {
    stageKey = "courtesyNotice";
    status = "open";
  }

  const now = Date.now();
  const caseId = await ctx.db.insert("cases", {
    hoaId,
    propertyId: property._id,
    caseType: "violation",
    title: "Exterior inspection findings",
    description: BACKFILL_MARKER,
    stageKey,
    status,
    source: "inspection",
    actionDueAt,
    openedAt,
    closedAt,
    updatedAt: now,
  });

  // Seed the timeline chronologically with historical timestamps.
  await logCaseEvent(ctx, {
    hoaId,
    caseId,
    propertyId: property._id,
    type: "opened",
    actorRole: "system",
    summary: "Case opened from inspection records",
    visibility: "shared",
    createdAt: openedAt,
  });

  const notesText = [
    property.inspectorNotesFront && `Front: ${property.inspectorNotesFront}`,
    property.inspectorNotesSide && `Side: ${property.inspectorNotesSide}`,
    property.inspectorNotesBack && `Back: ${property.inspectorNotesBack}`,
    property.inspectorNotes,
  ]
    .filter(Boolean)
    .join("\n");
  if (notesText) {
    await logCaseEvent(ctx, {
      hoaId,
      caseId,
      propertyId: property._id,
      type: "noteAdded",
      actorRole: "system",
      summary: notesText,
      visibility: "internal",
      createdAt: property.inspectionNotesLastUpdatedAt ?? openedAt,
    });
  }

  for (const photo of photos) {
    await logCaseEvent(ctx, {
      hoaId,
      caseId,
      propertyId: property._id,
      type: "photoAttached",
      actorRole: "system",
      summary: `Inspection photo (${photo.section})`,
      visibility: "shared",
      photoId: photo._id,
      createdAt: photo.uploadedAt,
    });
  }

  if (property.generatedLetterAt) {
    await logCaseEvent(ctx, {
      hoaId,
      caseId,
      propertyId: property._id,
      type: "noticeGenerated",
      actorRole: "system",
      summary: "Violation letter generated",
      visibility: "shared",
      createdAt: property.generatedLetterAt,
    });
  }

  if (property.letterSentAt) {
    await logCaseEvent(ctx, {
      hoaId,
      caseId,
      propertyId: property._id,
      type: "noticeSent",
      actorRole: "system",
      summary: "Violation letter emailed to homeowner",
      visibility: "shared",
      createdAt: property.letterSentAt,
    });
  }

  for (const fixPhoto of fixPhotos) {
    await logCaseEvent(ctx, {
      hoaId,
      caseId,
      propertyId: property._id,
      type: "fixSubmitted",
      actorRole: "homeowner",
      summary:
        fixPhoto.verificationStatus === "resolved"
          ? "Fix photo submitted (verified resolved)"
          : "Fix photo submitted",
      visibility: "shared",
      fixPhotoId: fixPhoto._id,
      createdAt: fixPhoto.uploadedAt,
    });
  }

  if (isComplete && closedAt) {
    await logCaseEvent(ctx, {
      hoaId,
      caseId,
      propertyId: property._id,
      type: "stageChanged",
      actorRole: "system",
      fromStageKey: property.letterSentAt ? "curePeriod" : "courtesyNotice",
      toStageKey: "resolved",
      summary:
        "Marked resolved from inspection records" +
        (resolvedFixPhotos.length ? " (verified fix photo)" : ""),
      visibility: "shared",
      createdAt: closedAt,
    });
    await logCaseEvent(ctx, {
      hoaId,
      caseId,
      propertyId: property._id,
      type: "closed",
      actorRole: "system",
      summary: "Case closed",
      visibility: "shared",
      createdAt: closedAt,
    });
  }

  return "created";
}

export const run = internalMutation({
  args: {
    hoaId: v.id("hoas"),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const page = await ctx.db
      .query("properties")
      .withIndex("by_hoa", (q) => q.eq("hoaId", args.hoaId))
      .paginate({ numItems: limit, cursor: args.cursor ?? null });

    let created = 0;
    let skipped = 0;
    const wouldCreate: string[] = [];

    for (const property of page.page) {
      if (args.dryRun) {
        const photos = await ctx.db
          .query("photos")
          .withIndex("by_property", (q) => q.eq("propertyId", property._id))
          .collect();
        const existing = await ctx.db
          .query("cases")
          .withIndex("by_property", (q) => q.eq("propertyId", property._id))
          .collect();
        const alreadyDone = existing.some((c) => c.description === BACKFILL_MARKER);
        if (!alreadyDone && hasInspectionSubstance(property, photos.length)) {
          wouldCreate.push(property.address);
          created += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      const result = await backfillOne(ctx, property, args.hoaId);
      if (result === "created") created += 1;
      else skipped += 1;
    }

    return {
      dryRun: !!args.dryRun,
      processed: page.page.length,
      created,
      skipped,
      ...(args.dryRun ? { wouldCreate } : {}),
      isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/** Deletes ONLY backfilled (marker-tagged) cases and their events. Legacy data untouched. */
export const rollback = internalMutation({
  args: {
    hoaId: v.id("hoas"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const cases = await ctx.db
      .query("cases")
      .withIndex("by_hoa", (q) => q.eq("hoaId", args.hoaId))
      .collect();
    const backfilled = cases.filter((c) => c.description === BACKFILL_MARKER).slice(0, limit);

    let eventsDeleted = 0;
    for (const caseDoc of backfilled) {
      const events = await ctx.db
        .query("caseEvents")
        .withIndex("by_case", (q) => q.eq("caseId", caseDoc._id))
        .collect();
      for (const event of events) {
        await ctx.db.delete(event._id);
        eventsDeleted += 1;
      }
      await ctx.db.delete(caseDoc._id);
    }

    const remaining =
      cases.filter((c) => c.description === BACKFILL_MARKER).length - backfilled.length;
    return { casesDeleted: backfilled.length, eventsDeleted, remaining };
  },
});
