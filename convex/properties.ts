import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  buildLetterHtmlSync,
  DEFAULT_LETTER_TEMPLATE,
} from "./letterBody";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireHomeownerForProperty } from "./lib/homeownerAuth";
import {
  buildCombinedInspectorNotes,
  buildInspectorNotesPatch,
  propertyHasInspectorNotesContent,
  resolveSectionInputs,
} from "./lib/inspectorNotes";
import { propertyStatusValidator } from "./lib/propertyStatus";
import { findOpenViolationCase, openCaseInternal } from "./cases";
import { logCaseEvent } from "./lib/caseEvents";
import { isFeatureEnabled } from "./lib/featureFlags";

/**
 * Legacy→case mirror: when an inspection is completed and the "cases" flag is
 * on, ensure the property has an open violation case so the new timeline is
 * populated from day one. No-op when the flag is off or a case already exists.
 */
async function ensureViolationCaseForInspection(
  ctx: MutationCtx,
  property: {
    _id: Id<"properties">;
    hoaId?: Id<"hoas">;
  },
  actorRole: "admin" | "inspector",
  actorClerkUserId: string,
): Promise<void> {
  if (!property.hoaId) return;
  if (!(await isFeatureEnabled(ctx, property.hoaId, "cases"))) return;
  const existing = await findOpenViolationCase(ctx, property._id);
  if (existing) return;
  await openCaseInternal(ctx, {
    hoaId: property.hoaId,
    propertyId: property._id,
    caseType: "violation",
    title: "Exterior inspection findings",
    source: "inspection",
    actorRole,
    actorClerkUserId,
  });
}

export const list = query({
  args: {
    streetId: v.optional(v.id("streets")),
    status: v.optional(propertyStatusValidator),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    let properties;
    if (args.streetId) {
      const street = await ctx.db.get(args.streetId);
      if (!street || street.hoaId !== viewer.hoaId) return [];
      properties = await ctx.db
        .query("properties")
        .withIndex("by_hoa_street", (q) => q.eq("hoaId", viewer.hoaId).eq("streetId", args.streetId!))
        .collect();
    } else {
      properties = await ctx.db
        .query("properties")
        .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
        .collect();
    }
    if (args.status) {
      properties = properties.filter((p) => p.status === args.status);
    }
    return properties.sort((a, b) => a.address.localeCompare(b.address));
  },
});

export const get = query({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) return null;
    return property;
  },
});

/**
 * Homeowner-facing view of their property. Deliberately returns ONLY
 * homeowner-safe fields (address/status + the friendly AI violation bullets +
 * the sent letter), never raw inspector notes or internal metadata. Gated by
 * property-scoped homeowner ownership.
 */
export const getHomeownerView = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requireHomeownerForProperty(ctx, args.propertyId);
    const doc = await ctx.db.get(args.propertyId);
    if (!doc) return null;
    return {
      _id: doc._id,
      address: doc.address,
      homeownerNames: doc.homeownerNames ?? "",
      status: doc.status,
      letterSentAt: doc.letterSentAt ?? null,
      /** Cleaned, homeowner-friendly list of items to address (markdown bullets). */
      violationBullets: doc.aiLetterBullets ?? "",
      /** The letter the HOA sent, if any (already homeowner-facing content). */
      generatedLetterHtml: doc.generatedLetterHtml ?? "",
      generatedLetterAt: doc.generatedLetterAt ?? null,
    };
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("properties")
      .withIndex("by_token", (q) => q.eq("accessToken", args.token))
      .first();
    if (!doc) return null;
    const {
      accessToken: _accessToken,
      priorOwnerLetterNotes2024: _prior2024,
      aiLetterBullets: _aiBullets,
      aiLetterBulletsAt: _aiBulletsAt,
      inspectionNotesEnteredAt: _inEnteredAt,
      inspectionNotesEnteredByClerkUserId: _inEnteredBy,
      inspectionNotesLastUpdatedByClerkUserId: _inLastBy,
      inspectionNotesLastUpdatedAt: _inLastAt,
      inspectionDetailsVerifiedAt: _inVerAt,
      inspectionDetailsVerifiedByClerkUserId: _inVerBy,
      ...safe
    } = doc;
    return safe;
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const importFromCSV = mutation({
  args: {
    rows: v.array(
      v.object({
        address: v.string(),
        streetName: v.string(),
        houseNumber: v.number(),
        email: v.optional(v.string()),
        homeownerNames: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    let created = 0;
    let skipped = 0;
    for (const row of args.rows) {
      // Find or create street
      let streetDoc = await ctx.db
        .query("streets")
        .withIndex("by_hoa_name", (q) => q.eq("hoaId", viewer.hoaId).eq("name", row.streetName))
        .first();
      if (!streetDoc) {
        const streetId = await ctx.db.insert("streets", {
          hoaId: viewer.hoaId,
          name: row.streetName,
          createdAt: Date.now(),
        });
        streetDoc = await ctx.db.get(streetId);
      }
      if (!streetDoc) continue;

      // Check for duplicate
      const existing = await ctx.db
        .query("properties")
        .withIndex("by_street", (q) => q.eq("streetId", streetDoc!._id))
        .collect();
      if (existing.some((p) => p.address === row.address)) {
        skipped++;
        continue;
      }

      await ctx.db.insert("properties", {
        hoaId: viewer.hoaId,
        streetId: streetDoc._id,
        address: row.address,
        houseNumber: row.houseNumber,
        email: row.email,
        homeownerNames: row.homeownerNames?.trim() || undefined,
        status: "notStarted",
        accessToken: crypto.randomUUID(),
        createdAt: Date.now(),
      });
      created++;
    }
    return { created, skipped };
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("properties"),
    status: propertyStatusValidator,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    await ctx.db.patch(args.id, { status: args.status });
    return null;
  },
});

export const updateEmail = mutation({
  args: { id: v.id("properties"), email: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    await ctx.db.patch(args.id, { email: args.email });
    return null;
  },
});

export const updateHomeownerNames = mutation({
  args: { id: v.id("properties"), homeownerNames: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    await ctx.db.patch(args.id, { homeownerNames: args.homeownerNames });
    return null;
  },
});

export const updateAdminPropertyFields = mutation({
  args: {
    id: v.id("properties"),
    priorCompletedWorkResponse: v.optional(v.string()),
    previousCitations2024: v.optional(v.string()),
    previousFrontObs: v.optional(v.string()),
    previousBackObs: v.optional(v.string()),
    previousInspectorComments: v.optional(v.string()),
    previousInspectionSummary: v.optional(v.string()),
    priorOwnerLetterNotes2024: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
    return null;
  },
});

export const markLetterSent = internalMutation({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { letterSentAt: Date.now() });

    // Mirror the legacy letter-send into the case timeline, if a case is open.
    const openCase = await findOpenViolationCase(ctx, args.id);
    if (openCase) {
      await logCaseEvent(ctx, {
        hoaId: openCase.hoaId,
        caseId: openCase._id,
        propertyId: args.id,
        type: "noticeSent",
        actorRole: "system",
        summary: "Violation letter emailed to homeowner",
        visibility: "shared",
      });
    }
    return null;
  },
});

const summerRowValidator = v.object({
  streetName: v.string(),
  sourceRow: v.number(),
  address: v.string(),
  houseNumber: v.number(),
  email: v.optional(v.string()),
  priorCompletedWorkResponse: v.optional(v.string()),
  previousCitations2024: v.optional(v.string()),
  previousFrontObs: v.optional(v.string()),
  previousBackObs: v.optional(v.string()),
  previousInspectorComments: v.optional(v.string()),
  previousInspectionSummary: v.optional(v.string()),
});

/** One-time Summer 2025 workbook import: upsert by street + house number (re-run safe). */
export const bulkUpsertSummer2025 = mutation({
  args: { rows: v.array(summerRowValidator) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    let created = 0;
    let updated = 0;
    for (const row of args.rows) {
      let streetDoc = await ctx.db
        .query("streets")
        .withIndex("by_hoa_name", (q) => q.eq("hoaId", viewer.hoaId).eq("name", row.streetName))
        .first();
      if (!streetDoc) {
        const streetId = await ctx.db.insert("streets", {
          hoaId: viewer.hoaId,
          name: row.streetName,
          createdAt: Date.now(),
        });
        streetDoc = await ctx.db.get(streetId);
      }
      if (!streetDoc) continue;

      const onStreet = await ctx.db
        .query("properties")
        .withIndex("by_hoa_street", (q) => q.eq("hoaId", viewer.hoaId).eq("streetId", streetDoc._id))
        .collect();
      const existing = onStreet.find((p) => p.houseNumber === row.houseNumber);

      const patch: Record<string, unknown> = {
        streetId: streetDoc._id,
        address: row.address,
        houseNumber: row.houseNumber,
        importSheetName: row.streetName,
        importSourceRow: row.sourceRow,
      };
      const optionalKeys = [
        "email",
        "priorCompletedWorkResponse",
        "previousCitations2024",
        "previousFrontObs",
        "previousBackObs",
        "previousInspectorComments",
        "previousInspectionSummary",
      ] as const;
      for (const k of optionalKeys) {
        const val = row[k];
        if (val !== undefined) patch[k] = val;
      }

      if (existing) {
        await ctx.db.patch(existing._id, patch);
        updated++;
      } else {
        await ctx.db.insert("properties", {
          hoaId: viewer.hoaId,
          streetId: streetDoc._id,
          address: row.address,
          houseNumber: row.houseNumber,
          email: row.email,
          priorCompletedWorkResponse: row.priorCompletedWorkResponse,
          previousCitations2024: row.previousCitations2024,
          previousFrontObs: row.previousFrontObs,
          previousBackObs: row.previousBackObs,
          previousInspectorComments: row.previousInspectorComments,
          previousInspectionSummary: row.previousInspectionSummary,
          importSheetName: row.streetName,
          importSourceRow: row.sourceRow,
          status: "notStarted",
          accessToken: crypto.randomUUID(),
          createdAt: Date.now(),
        });
        created++;
      }
    }
    return { created, updated, total: args.rows.length };
  },
});

const priorLetterRowValidator = v.object({
  streetName: v.string(),
  houseNumber: v.number(),
  priorOwnerLetterNotes2024: v.string(),
});

const homeownerNamesRowValidator = v.object({
  streetName: v.string(),
  houseNumber: v.number(),
  homeownerNames: v.string(),
});

function requireDemoSeedSecret(provided: string) {
  const expected = process.env.DEMO_SEED_SECRET;
  if (!expected || expected.length < 6) {
    throw new Error("DEMO_SEED_SECRET is not configured on Convex.");
  }
  if (provided !== expected) {
    throw new Error("Invalid import secret.");
  }
}

async function bulkPatchHomeownerNamesForHoa(
  ctx: MutationCtx,
  hoaId: Id<"hoas">,
  rows: Array<{ streetName: string; houseNumber: number; homeownerNames: string }>,
) {
  let patched = 0;
  let skippedNoStreet = 0;
  let skippedNoProperty = 0;
  for (const row of rows) {
    const streetDoc = await ctx.db
      .query("streets")
      .withIndex("by_hoa_name", (q) => q.eq("hoaId", hoaId).eq("name", row.streetName))
      .first();
    if (!streetDoc) {
      skippedNoStreet++;
      continue;
    }
    const onStreet = await ctx.db
      .query("properties")
      .withIndex("by_hoa_street", (q) => q.eq("hoaId", hoaId).eq("streetId", streetDoc._id))
      .collect();
    const existing = onStreet.find((p) => p.houseNumber === row.houseNumber);
    if (!existing) {
      skippedNoProperty++;
      continue;
    }
    await ctx.db.patch(existing._id, {
      homeownerNames: row.homeownerNames.trim(),
    });
    patched++;
  }
  return {
    patched,
    skippedNoStreet,
    skippedNoProperty,
    total: rows.length,
  };
}

/** Patch owner names from contact list CSV (existing properties only). */
export const bulkPatchHomeownerNames = mutation({
  args: { rows: v.array(homeownerNamesRowValidator) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    return bulkPatchHomeownerNamesForHoa(ctx, viewer.hoaId, args.rows);
  },
});

/** Script import for owner contact CSV (protected by Convex DEMO_SEED_SECRET). */
export const bulkPatchHomeownerNamesWithSecret = mutation({
  args: {
    secret: v.string(),
    hoaSlug: v.optional(v.string()),
    rows: v.array(homeownerNamesRowValidator),
  },
  handler: async (ctx, args) => {
    requireDemoSeedSecret(args.secret);
    const slug = args.hoaSlug ?? "ridge-top-terrace";
    const hoa = await ctx.db
      .query("hoas")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!hoa) {
      throw new Error(`HOA not found for slug: ${slug}`);
    }
    return bulkPatchHomeownerNamesForHoa(ctx, hoa._id, args.rows);
  },
});

/** Patch archival 2024 letter notes from Word import (existing properties only). */
export const bulkPatchPriorOwnerLetterNotes2024 = mutation({
  args: { rows: v.array(priorLetterRowValidator) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    let patched = 0;
    let skippedNoStreet = 0;
    let skippedNoProperty = 0;
    for (const row of args.rows) {
      const streetDoc = await ctx.db
        .query("streets")
        .withIndex("by_hoa_name", (q) => q.eq("hoaId", viewer.hoaId).eq("name", row.streetName))
        .first();
      if (!streetDoc) {
        skippedNoStreet++;
        continue;
      }
      const onStreet = await ctx.db
        .query("properties")
        .withIndex("by_hoa_street", (q) => q.eq("hoaId", viewer.hoaId).eq("streetId", streetDoc._id))
        .collect();
      const existing = onStreet.find((p) => p.houseNumber === row.houseNumber);
      if (!existing) {
        skippedNoProperty++;
        continue;
      }
      await ctx.db.patch(existing._id, {
        priorOwnerLetterNotes2024: row.priorOwnerLetterNotes2024,
      });
      patched++;
    }
    return {
      patched,
      skippedNoStreet,
      skippedNoProperty,
      total: args.rows.length,
    };
  },
});

export const patchAiLetterBullets = internalMutation({
  args: { id: v.id("properties"), aiLetterBullets: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      aiLetterBullets: args.aiLetterBullets,
      aiLetterBulletsAt: Date.now(),
    });
    return null;
  },
});

export const updateInspectorNotes = mutation({
  args: {
    id: v.id("properties"),
    inspectorNotesFront: v.string(),
    inspectorNotesSide: v.string(),
    inspectorNotesBack: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    const resolved = resolveSectionInputs(property, args.inspectorNotesFront, args.inspectorNotesSide, args.inspectorNotesBack);
    const patch = buildInspectorNotesPatch(property, viewer.clerkUserId, resolved);
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const updateAiLetterBullets = mutation({
  args: { id: v.id("properties"), aiLetterBullets: v.string() },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    await ctx.db.patch(args.id, {
      aiLetterBullets: args.aiLetterBullets,
      aiLetterBulletsAt: Date.now(),
    });
    return null;
  },
});

/** Sets workflow status: complete if inspection details are verified, else review. */
export const completeHouseCapture = mutation({
  args: {
    id: v.id("properties"),
    // "All clear" in the field must not open a case even when benign notes exist.
    openCase: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    const verified = !!property.inspectionDetailsVerifiedByClerkUserId;
    await ctx.db.patch(args.id, {
      status: verified ? "complete" : "review",
    });
    if ((args.openCase ?? true) && propertyHasInspectorNotesContent(property)) {
      await ensureViolationCaseForInspection(
        ctx,
        property,
        viewer.role === "inspector" ? "inspector" : "admin",
        viewer.clerkUserId,
      );
    }
    return { ok: true as const };
  },
});

/** Records who verified inspection details and updates status when appropriate. */
export const setInspectionVerification = mutation({
  args: {
    propertyId: v.id("properties"),
    verified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.propertyId);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");

    if (args.verified) {
      if (!propertyHasInspectorNotesContent(property)) {
        throw new Error("No inspection notes to verify yet.");
      }
      const now = Date.now();
      const patch: Record<string, unknown> = {
        inspectionDetailsVerifiedByClerkUserId: viewer.clerkUserId,
        inspectionDetailsVerifiedAt: now,
      };
      if (property.status === "review") {
        patch.status = "complete";
      }
      await ctx.db.patch(args.propertyId, patch);
      return null;
    }

    const patch: Record<string, unknown> = {
      inspectionDetailsVerifiedByClerkUserId: undefined,
      inspectionDetailsVerifiedAt: undefined,
    };
    if (property.status === "complete") {
      patch.status = "review";
    }
    await ctx.db.patch(args.propertyId, patch);
    return null;
  },
});

/** Persist generated letter HTML from explicit admin generation step. */
export const saveGeneratedLetterHtml = mutation({
  args: {
    id: v.id("properties"),
    html: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    await ctx.db.patch(args.id, {
      generatedLetterHtml: args.html,
      generatedLetterAt: Date.now(),
    });
    return null;
  },
});

/** Save notes from DB, persist generated letter HTML (sync merge, no image AI). Status: complete if verified, else review. */
export const completeHouseAndSaveLetter = mutation({
  args: {
    id: v.id("properties"),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");

    const inspectorFindingsPlain =
      property.inspectorNotes?.trim() ??
      buildCombinedInspectorNotes(
        property.inspectorNotesFront ?? "",
        property.inspectorNotesSide ?? "",
        property.inspectorNotesBack ?? "",
      );

    const templateDoc = await ctx.db
      .query("templates")
      .withIndex("by_hoa_type", (q) => q.eq("hoaId", viewer.hoaId).eq("type", "letter"))
      .first();
    const templateContent = templateDoc?.content ?? DEFAULT_LETTER_TEMPLATE;

    const merged = {
      address: property.address,
      accessToken: property.accessToken,
      recipientName: property.homeownerNames?.trim() || "Homeowner",
      recipientStreet: property.address,
      recipientCityStateZip: "Fairfax, VA 22030",
      inspectorNotes: inspectorFindingsPlain,
      previousFrontObs: property.previousFrontObs,
      previousBackObs: property.previousBackObs,
      previousInspectorComments: property.previousInspectorComments,
      previousInspectionSummary: property.previousInspectionSummary,
      previousCitations2024: property.previousCitations2024,
    };

    const maintenanceItemsPlain = property.aiLetterBullets?.trim() || "";
    const publicBase = process.env.PUBLIC_BASE_URL ?? "http://localhost:5173";
    const html = buildLetterHtmlSync({
      templateContent,
      property: merged,
      publicBaseUrl: publicBase,
      inspectorFindingsPlain,
      maintenanceItemsPlain,
    });

    const verified = !!property.inspectionDetailsVerifiedByClerkUserId;
    await ctx.db.patch(args.id, {
      status: verified ? "complete" : "review",
      generatedLetterHtml: html,
      generatedLetterAt: Date.now(),
    });
    if (propertyHasInspectorNotesContent(property)) {
      await ensureViolationCaseForInspection(
        ctx,
        property,
        viewer.role === "inspector" ? "inspector" : "admin",
        viewer.clerkUserId,
      );
    }
    const openCase = await findOpenViolationCase(ctx, args.id);
    if (openCase) {
      await logCaseEvent(ctx, {
        hoaId: openCase.hoaId,
        caseId: openCase._id,
        propertyId: args.id,
        type: "noticeGenerated",
        actorRole: viewer.role === "inspector" ? "inspector" : "admin",
        actorClerkUserId: viewer.clerkUserId,
        summary: "Violation letter generated",
        visibility: "shared",
      });
    }
    return { ok: true as const };
  },
});

export const getLetterHtml = query({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const p = await ctx.db.get(args.id);
    if (!p || p.hoaId !== viewer.hoaId) return null;
    return { html: p.generatedLetterHtml ?? null, generatedLetterAt: p.generatedLetterAt };
  },
});

/** Admin letter review: all review/complete properties with bullets, letter status, notes, and photos. */
export const listLetterReviewRows = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const all = await ctx.db
      .query("properties")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    const streets = await ctx.db
      .query("streets")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    const streetNameById = new Map(streets.map((s) => [s._id, s.name]));

    const eligible = all.filter((p) => p.status === "review" || p.status === "complete");
    const rows = await Promise.all(
      eligible.map(async (p) => {
        const photos = await ctx.db
          .query("photos")
          .withIndex("by_hoa_property", (q) => q.eq("hoaId", viewer.hoaId).eq("propertyId", p._id))
          .collect();
        const sortedPhotos = photos
          .sort((a, b) => a.uploadedAt - b.uploadedAt)
          .map((photo) => ({
            _id: photo._id,
            section: photo.section,
            uploadedAt: photo.uploadedAt,
            url: photo.publicUrl ?? photo.thumbnailPublicUrl ?? "",
          }))
          .filter((photo) => photo.url.length > 0);
        const originalInspectorNotes =
          p.inspectorNotes?.trim() ??
          buildCombinedInspectorNotes(
            p.inspectorNotesFront ?? "",
            p.inspectorNotesSide ?? "",
            p.inspectorNotesBack ?? "",
          );
        return {
          _id: p._id,
          address: p.address,
          streetId: p.streetId,
          streetName: streetNameById.get(p.streetId) ?? "Unknown Street",
          houseNumber: p.houseNumber,
          aiLetterBullets: p.aiLetterBullets ?? "",
          generatedLetterHtml: p.generatedLetterHtml ?? null,
          generatedLetterAt: p.generatedLetterAt ?? null,
          originalInspectorNotes,
          photos: sortedPhotos,
        };
      }),
    );
    return rows.sort((a, b) => {
      if (a.streetName !== b.streetName) return a.streetName.localeCompare(b.streetName);
      if (a.houseNumber !== b.houseNumber) return a.houseNumber - b.houseNumber;
      return a.address.localeCompare(b.address);
    });
  },
});

function formatExportDate(ms: number | undefined): string {
  if (ms === undefined) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

const csvExportRowValidator = v.object({
  propertyId: v.id("properties"),
  street: v.string(),
  houseNumber: v.number(),
  address: v.string(),
  homeownerNames: v.string(),
  email: v.string(),
  status: propertyStatusValidator,
  letterSentAt: v.string(),
  generatedLetterAt: v.string(),
  inspectionDetailsVerifiedAt: v.string(),
  inspectionNotesEnteredAt: v.string(),
  inspectionNotesLastUpdatedAt: v.string(),
  inspectorNotesFront: v.string(),
  inspectorNotesSide: v.string(),
  inspectorNotesBack: v.string(),
  inspectorNotes: v.string(),
  aiLetterBullets: v.string(),
  previousCitations2024: v.string(),
  previousFrontObs: v.string(),
  previousBackObs: v.string(),
  previousInspectorComments: v.string(),
  previousInspectionSummary: v.string(),
  priorOwnerLetterNotes2024: v.string(),
  priorCompletedWorkResponse: v.string(),
  photoCountFront: v.number(),
  photoCountSide: v.number(),
  photoCountBack: v.number(),
  photoCountTotal: v.number(),
  fixPhotoCount: v.number(),
  fixPhotoPendingCount: v.number(),
});

/** Admin CSV export: one flat row per property with inspection workflow and photo counts. */
export const listForCsvExport = query({
  args: {},
  returns: v.array(csvExportRowValidator),
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const all = await ctx.db
      .query("properties")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    const streets = await ctx.db
      .query("streets")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    const streetNameById = new Map(streets.map((s) => [s._id, s.name]));

    const rows = await Promise.all(
      all.map(async (p) => {
        const photos = await ctx.db
          .query("photos")
          .withIndex("by_hoa_property", (q) => q.eq("hoaId", viewer.hoaId).eq("propertyId", p._id))
          .collect();
        const fixPhotos = await ctx.db
          .query("fixPhotos")
          .withIndex("by_hoa_property", (q) => q.eq("hoaId", viewer.hoaId).eq("propertyId", p._id))
          .collect();

        const photoCountFront = photos.filter((photo) => photo.section === "front").length;
        const photoCountSide = photos.filter((photo) => photo.section === "side").length;
        const photoCountBack = photos.filter((photo) => photo.section === "back").length;
        const fixPhotoPendingCount = fixPhotos.filter((photo) => photo.verificationStatus === "pending").length;

        const inspectorNotes =
          p.inspectorNotes?.trim() ??
          buildCombinedInspectorNotes(
            p.inspectorNotesFront ?? "",
            p.inspectorNotesSide ?? "",
            p.inspectorNotesBack ?? "",
          );

        return {
          propertyId: p._id,
          street: streetNameById.get(p.streetId) ?? "Unknown Street",
          houseNumber: p.houseNumber,
          address: p.address,
          homeownerNames: p.homeownerNames ?? "",
          email: p.email ?? "",
          status: p.status,
          letterSentAt: formatExportDate(p.letterSentAt),
          generatedLetterAt: formatExportDate(p.generatedLetterAt),
          inspectionDetailsVerifiedAt: formatExportDate(p.inspectionDetailsVerifiedAt),
          inspectionNotesEnteredAt: formatExportDate(p.inspectionNotesEnteredAt),
          inspectionNotesLastUpdatedAt: formatExportDate(p.inspectionNotesLastUpdatedAt),
          inspectorNotesFront: p.inspectorNotesFront ?? "",
          inspectorNotesSide: p.inspectorNotesSide ?? "",
          inspectorNotesBack: p.inspectorNotesBack ?? "",
          inspectorNotes,
          aiLetterBullets: p.aiLetterBullets ?? "",
          previousCitations2024: p.previousCitations2024 ?? "",
          previousFrontObs: p.previousFrontObs ?? "",
          previousBackObs: p.previousBackObs ?? "",
          previousInspectorComments: p.previousInspectorComments ?? "",
          previousInspectionSummary: p.previousInspectionSummary ?? "",
          priorOwnerLetterNotes2024: p.priorOwnerLetterNotes2024 ?? "",
          priorCompletedWorkResponse: p.priorCompletedWorkResponse ?? "",
          photoCountFront,
          photoCountSide,
          photoCountBack,
          photoCountTotal: photos.length,
          fixPhotoCount: fixPhotos.length,
          fixPhotoPendingCount,
        };
      }),
    );

    return rows.sort((a, b) => {
      if (a.street !== b.street) return a.street.localeCompare(b.street);
      if (a.houseNumber !== b.houseNumber) return a.houseNumber - b.houseNumber;
      return a.address.localeCompare(b.address);
    });
  },
});

/** Admin PDF export: all stored letter bodies. */
export const listGeneratedLetterBodies = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const all = await ctx.db
      .query("properties")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    const rows = await Promise.all(
      all
        .filter((p) => p.generatedLetterHtml && p.generatedLetterHtml.length > 0)
        .map(async (p) => {
        const photos = await ctx.db
          .query("photos")
          .withIndex("by_hoa_property", (q) => q.eq("hoaId", viewer.hoaId).eq("propertyId", p._id))
          .collect();
        const sortedPhotos = photos
          .sort((a, b) => a.uploadedAt - b.uploadedAt)
          .map((photo) => ({
            _id: photo._id,
            section: photo.section,
            uploadedAt: photo.uploadedAt,
            url: photo.publicUrl ?? photo.thumbnailPublicUrl ?? "",
          }))
          .filter((photo) => photo.url.length > 0);
        return {
          _id: p._id,
          address: p.address,
          html: p.generatedLetterHtml as string,
          photos: sortedPhotos,
        };
      }),
    );
    return rows;
  },
});
