import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  buildLetterHtmlSync,
  DEFAULT_LETTER_TEMPLATE,
} from "./letterBody";
import { requireViewerRole } from "./lib/tenantAuth";
import {
  buildCombinedInspectorNotes,
  buildInspectorNotesPatch,
  propertyHasInspectorNotesContent,
  resolveSectionInputs,
} from "./lib/inspectorNotes";
import { propertyStatusValidator } from "./lib/propertyStatus";

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

/** Sets workflow status: complete if inspection details are verified, else review (pending peer verification). */
export const completeHouseCapture = mutation({
  args: {
    id: v.id("properties"),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const property = await ctx.db.get(args.id);
    if (!property || !property.hoaId || property.hoaId !== viewer.hoaId) throw new Error("Property not found");
    const verified = !!property.inspectionDetailsVerifiedByClerkUserId;
    await ctx.db.patch(args.id, {
      status: verified ? "complete" : "review",
    });
    return { ok: true as const };
  },
});

/** Peer verification: another user (not the last note editor) confirms inspection details. */
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
      const lastSaver = property.inspectionNotesLastUpdatedByClerkUserId;
      const enteredBy = property.inspectionNotesEnteredByClerkUserId;
      /** Prefer last saver; fallback for legacy rows that have notes but never ran section-note saves. */
      const cannotVerifyIfSameAs = lastSaver ?? enteredBy ?? null;
      if (cannotVerifyIfSameAs && viewer.clerkUserId === cannotVerifyIfSameAs) {
        throw new Error("You cannot verify notes you last edited. Ask another inspector or admin.");
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

/** Admin PDF export: all stored letter bodies. */
export const listGeneratedLetterBodies = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const all = await ctx.db
      .query("properties")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    return all
      .filter((p) => p.generatedLetterHtml && p.generatedLetterHtml.length > 0)
      .map((p) => ({
        _id: p._id,
        address: p.address,
        html: p.generatedLetterHtml as string,
      }));
  },
});
