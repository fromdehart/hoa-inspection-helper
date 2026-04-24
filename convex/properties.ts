import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  buildLetterHtmlSync,
  DEFAULT_LETTER_TEMPLATE,
  paragraphsFromPlainText,
} from "./letterBody";

export const list = query({
  args: {
    streetId: v.optional(v.id("streets")),
    status: v.optional(v.union(
      v.literal("notStarted"),
      v.literal("inProgress"),
      v.literal("complete"),
    )),
  },
  handler: async (ctx, args) => {
    let properties;
    if (args.streetId) {
      properties = await ctx.db
        .query("properties")
        .withIndex("by_street", (q) => q.eq("streetId", args.streetId!))
        .collect();
    } else {
      properties = await ctx.db.query("properties").collect();
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
    return ctx.db.get(args.id);
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
    const { accessToken: _accessToken, ...safe } = doc;
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
    let created = 0;
    let skipped = 0;
    for (const row of args.rows) {
      // Find or create street
      let streetDoc = await ctx.db
        .query("streets")
        .withIndex("by_name", (q) => q.eq("name", row.streetName))
        .first();
      if (!streetDoc) {
        const streetId = await ctx.db.insert("streets", {
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
    status: v.union(
      v.literal("notStarted"),
      v.literal("inProgress"),
      v.literal("complete"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status });
    return null;
  },
});

export const updateEmail = mutation({
  args: { id: v.id("properties"), email: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { email: args.email });
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
    let created = 0;
    let updated = 0;
    for (const row of args.rows) {
      let streetDoc = await ctx.db
        .query("streets")
        .withIndex("by_name", (q) => q.eq("name", row.streetName))
        .first();
      if (!streetDoc) {
        const streetId = await ctx.db.insert("streets", {
          name: row.streetName,
          createdAt: Date.now(),
        });
        streetDoc = await ctx.db.get(streetId);
      }
      if (!streetDoc) continue;

      const onStreet = await ctx.db
        .query("properties")
        .withIndex("by_street", (q) => q.eq("streetId", streetDoc._id))
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

export const updateInspectorNotes = mutation({
  args: { id: v.id("properties"), inspectorNotes: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { inspectorNotes: args.inspectorNotes });
    return null;
  },
});

/** Inspector completion without auto-generating a letter. */
export const completeHouseCapture = mutation({
  args: {
    id: v.id("properties"),
    inspectorNotes: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      inspectorNotes: args.inspectorNotes,
      status: "complete",
    });
    return { ok: true as const };
  },
});

/** Persist generated letter HTML from explicit admin generation step. */
export const saveGeneratedLetterHtml = mutation({
  args: {
    id: v.id("properties"),
    html: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      generatedLetterHtml: args.html,
      generatedLetterAt: Date.now(),
    });
    return null;
  },
});

/** Save notes, mark complete, persist generated letter HTML (sync merge, no image AI). */
export const completeHouseAndSaveLetter = mutation({
  args: {
    id: v.id("properties"),
    inspectorNotes: v.string(),
  },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.id);
    if (!property) throw new Error("Property not found");

    const templateDoc = await ctx.db
      .query("templates")
      .withIndex("by_type", (q) => q.eq("type", "letter"))
      .first();
    const templateContent = templateDoc?.content ?? DEFAULT_LETTER_TEMPLATE;

    const merged = {
      address: property.address,
      accessToken: property.accessToken,
      inspectorNotes: args.inspectorNotes,
      previousFrontObs: property.previousFrontObs,
      previousBackObs: property.previousBackObs,
      previousInspectorComments: property.previousInspectorComments,
      previousInspectionSummary: property.previousInspectionSummary,
      previousCitations2024: property.previousCitations2024,
    };

    const findingsHtml = paragraphsFromPlainText(args.inspectorNotes);
    const publicBase = process.env.PUBLIC_BASE_URL ?? "http://localhost:5173";
    const html = buildLetterHtmlSync({
      templateContent,
      property: merged,
      publicBaseUrl: publicBase,
      violationsOrFindingsHtml: findingsHtml,
    });

    await ctx.db.patch(args.id, {
      inspectorNotes: args.inspectorNotes,
      status: "complete",
      generatedLetterHtml: html,
      generatedLetterAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const getLetterHtml = query({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.id);
    if (!p) return null;
    return { html: p.generatedLetterHtml ?? null, generatedLetterAt: p.generatedLetterAt };
  },
});

/** Admin PDF export: all stored letter bodies. */
export const listGeneratedLetterBodies = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("properties").collect();
    return all
      .filter((p) => p.generatedLetterHtml && p.generatedLetterHtml.length > 0)
      .map((p) => ({
        _id: p._id,
        address: p.address,
        html: p.generatedLetterHtml as string,
      }));
  },
});
