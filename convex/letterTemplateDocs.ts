import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_NO_VIOLATIONS_LETTER_TEMPLATE } from "./letterBody";
import {
  hasAnyVersion,
  listVersionsForDoc,
  recordVersionIfChanged,
} from "./lib/letterTemplateVersions";
import { requireViewerRole } from "./lib/tenantAuth";
import {
  docMatchesVariant,
  letterTemplateVariantValidator,
  letterTemplateVersionSourceValidator,
  normalizeLetterTemplateVariant,
  type LetterTemplateVariant,
} from "./lib/letterTemplateVariant";

const emptyBlocks = [] as Array<{
  idx: number;
  text: string;
  kind: "paragraph" | "bullet";
}>;

const emptyDetection = {
  date: undefined,
  recipientName: undefined,
  recipientStreet: undefined,
  recipientCityStateZip: undefined,
  maintenanceStart: undefined,
  maintenanceEnd: undefined,
};

const emptyMapping = {
  date: undefined,
  recipientName: undefined,
  recipientStreet: undefined,
  recipientCityStateZip: undefined,
  maintenanceStart: undefined,
  maintenanceEnd: undefined,
};

const versionSummaryValidator = v.object({
  _id: v.id("letterTemplateVersions"),
  savedAt: v.number(),
  source: letterTemplateVersionSourceValidator,
  note: v.optional(v.string()),
  preview: v.string(),
});

async function getActiveForHoa(
  ctx: QueryCtx,
  hoaId: Id<"hoas">,
  variant: LetterTemplateVariant,
) {
  const indexed = await ctx.db
    .query("letterTemplateDocs")
    .withIndex("by_hoa_status_variant", (q) =>
      q.eq("hoaId", hoaId).eq("status", "active").eq("variant", variant),
    )
    .first();
  if (indexed) return indexed;

  if (variant !== "violation") return null;

  const legacyActive = await ctx.db
    .query("letterTemplateDocs")
    .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoaId).eq("status", "active"))
    .collect();
  return legacyActive.find((doc) => docMatchesVariant(doc, "violation")) ?? null;
}

async function requireOwnedTemplateDoc(
  ctx: QueryCtx,
  viewerHoaId: Id<"hoas">,
  templateDocId: Id<"letterTemplateDocs">,
): Promise<Doc<"letterTemplateDocs">> {
  const doc = await ctx.db.get(templateDocId);
  if (!doc || !doc.hoaId || doc.hoaId !== viewerHoaId) {
    throw new Error("Template not found.");
  }
  return doc;
}

export const list = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const all = await ctx.db
      .query("letterTemplateDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const getActive = query({
  args: {
    variant: v.optional(letterTemplateVariantValidator),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    return await getActiveForHoa(
      ctx,
      viewer.hoaId,
      normalizeLetterTemplateVariant(args.variant),
    );
  },
});

export const getActivePair = query({
  args: {},
  returns: v.object({
    violation: v.union(v.any(), v.null()),
    noViolations: v.union(v.any(), v.null()),
  }),
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const [violation, noViolations] = await Promise.all([
      getActiveForHoa(ctx, viewer.hoaId, "violation"),
      getActiveForHoa(ctx, viewer.hoaId, "noViolations"),
    ]);
    return { violation, noViolations };
  },
});

export const listVersions = query({
  args: {
    templateDocId: v.id("letterTemplateDocs"),
  },
  returns: v.array(versionSummaryValidator),
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    await requireOwnedTemplateDoc(ctx, viewer.hoaId, args.templateDocId);
    return await listVersionsForDoc(ctx, args.templateDocId);
  },
});

const versionDetailValidator = v.object({
  _id: v.id("letterTemplateVersions"),
  savedAt: v.number(),
  source: letterTemplateVersionSourceValidator,
  note: v.optional(v.string()),
  templateText: v.string(),
});

export const getVersion = query({
  args: {
    versionId: v.id("letterTemplateVersions"),
  },
  returns: v.union(versionDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.hoaId !== viewer.hoaId) return null;

    const doc = await ctx.db.get(version.templateDocId);
    if (!doc || !doc.hoaId || doc.hoaId !== viewer.hoaId) return null;

    return {
      _id: version._id,
      savedAt: version.savedAt,
      source: version.source,
      note: version.note,
      templateText: version.templateText,
    };
  },
});

export const setMapping = mutation({
  args: {
    id: v.id("letterTemplateDocs"),
    mapping: v.object({
      date: v.optional(v.number()),
      recipientName: v.optional(v.number()),
      recipientStreet: v.optional(v.number()),
      recipientCityStateZip: v.optional(v.number()),
      maintenanceStart: v.optional(v.number()),
      maintenanceEnd: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const doc = await ctx.db.get(args.id);
    if (!doc || !doc.hoaId || doc.hoaId !== viewer.hoaId) throw new Error("Template not found.");
    await ctx.db.patch(args.id, { mapping: args.mapping, updatedAt: Date.now() });
    return null;
  },
});

export const updateTemplateText = mutation({
  args: {
    id: v.id("letterTemplateDocs"),
    templateText: v.string(),
  },
  returns: v.object({ savedAt: v.number() }),
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const doc = await ctx.db.get(args.id);
    if (!doc || !doc.hoaId || doc.hoaId !== viewer.hoaId) throw new Error("Template not found.");
    if (!args.templateText.trim()) {
      throw new Error("Template text cannot be empty. Re-upload the file to start from the original extract.");
    }
    const savedAt = Date.now();
    await ctx.db.patch(args.id, { templateText: args.templateText, updatedAt: savedAt });
    await recordVersionIfChanged(ctx, {
      doc,
      templateText: args.templateText,
      source: "save",
      clerkUserId: viewer.clerkUserId,
    });
    return { savedAt };
  },
});

export const revertToVersion = mutation({
  args: {
    versionId: v.id("letterTemplateVersions"),
  },
  returns: v.object({
    savedAt: v.number(),
    templateText: v.string(),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.hoaId !== viewer.hoaId) {
      throw new Error("Version not found.");
    }

    const doc = await ctx.db.get(version.templateDocId);
    if (!doc || !doc.hoaId || doc.hoaId !== viewer.hoaId || doc.status !== "active") {
      throw new Error("Active template not found for this version.");
    }

    const restoredAt = new Date(version.savedAt).toLocaleString();
    const note = `Restored from ${restoredAt}`;
    const savedAt = Date.now();
    await ctx.db.patch(doc._id, {
      templateText: version.templateText,
      updatedAt: savedAt,
    });

    await recordVersionIfChanged(ctx, {
      doc,
      templateText: version.templateText,
      source: "revert",
      clerkUserId: viewer.clerkUserId,
      note,
    });

    return { savedAt, templateText: version.templateText };
  },
});

export const bootstrapVersionFromCurrent = mutation({
  args: {},
  returns: v.object({ seeded: v.number() }),
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    let seeded = 0;

    for (const variant of ["violation", "noViolations"] as const) {
      const doc = await getActiveForHoa(ctx, viewer.hoaId, variant);
      if (!doc?.templateText?.trim()) continue;
      if (await hasAnyVersion(ctx, doc._id)) continue;

      const versionId = await recordVersionIfChanged(ctx, {
        doc,
        templateText: doc.templateText,
        source: "seed",
        clerkUserId: viewer.clerkUserId,
        note: "Initial version from current template",
      });
      if (versionId) seeded += 1;
    }

    return { seeded };
  },
});

export const createDraft = mutation({
  args: {
    fileName: v.string(),
    fileType: v.union(v.literal("docx"), v.literal("pdf")),
    sourcePublicUrl: v.string(),
    sourceFilePath: v.string(),
    parsedText: v.string(),
    templateText: v.string(),
    blocks: v.array(v.object({
      idx: v.number(),
      text: v.string(),
      kind: v.union(v.literal("paragraph"), v.literal("bullet")),
    })),
    detection: v.object({
      date: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientName: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientStreet: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientCityStateZip: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      maintenanceStart: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      maintenanceEnd: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
    }),
    mapping: v.object({
      date: v.optional(v.number()),
      recipientName: v.optional(v.number()),
      recipientStreet: v.optional(v.number()),
      recipientCityStateZip: v.optional(v.number()),
      maintenanceStart: v.optional(v.number()),
      maintenanceEnd: v.optional(v.number()),
    }),
    variant: v.optional(letterTemplateVariantValidator),
  },
  returns: v.id("letterTemplateDocs"),
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const variant = normalizeLetterTemplateVariant(args.variant);
    const all = await ctx.db
      .query("letterTemplateDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();

    for (const doc of all) {
      if (doc.status === "active" && docMatchesVariant(doc, variant)) {
        if (doc.templateText?.trim()) {
          await recordVersionIfChanged(ctx, {
            doc,
            templateText: doc.templateText,
            source: "upload",
            clerkUserId: viewer.clerkUserId,
            note: `Before upload: ${doc.fileName}`,
          });
        }
        await ctx.db.patch(doc._id, { status: "draft", updatedAt: Date.now() });
      }
    }

    const now = Date.now();
    const newDocId = await ctx.db.insert("letterTemplateDocs", {
      hoaId: viewer.hoaId,
      fileName: args.fileName,
      fileType: args.fileType,
      sourcePublicUrl: args.sourcePublicUrl,
      sourceFilePath: args.sourceFilePath,
      parsedText: args.parsedText,
      templateText: args.templateText,
      blocks: args.blocks,
      detection: args.detection,
      mapping: args.mapping,
      variant,
      status: "active",
      createdAt: now,
      updatedAt: now,
      activatedAt: now,
    });

    const newDoc = await ctx.db.get(newDocId);
    if (newDoc) {
      await recordVersionIfChanged(ctx, {
        doc: newDoc,
        templateText: args.templateText,
        source: "upload",
        clerkUserId: viewer.clerkUserId,
        note: `Uploaded: ${args.fileName}`,
      });
    }

    return newDocId;
  },
});

export const activate = mutation({
  args: { id: v.id("letterTemplateDocs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const target = await ctx.db.get(args.id);
    if (!target || !target.hoaId || target.hoaId !== viewer.hoaId) throw new Error("Template not found.");
    const variant = normalizeLetterTemplateVariant(target.variant);
    const all = await ctx.db
      .query("letterTemplateDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    for (const doc of all) {
      if (doc.status === "active" && doc._id !== args.id && docMatchesVariant(doc, variant)) {
        await ctx.db.patch(doc._id, { status: "draft", updatedAt: Date.now() });
      }
    }
    await ctx.db.patch(args.id, { status: "active", activatedAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

/** Inserts or backfills the default no-violations token template (safe to call multiple times). */
export const seedDefaultNoViolationsIfNeeded = mutation({
  args: {},
  returns: v.object({ seeded: v.boolean() }),
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const existing = await getActiveForHoa(ctx, viewer.hoaId, "noViolations");
    const templateText = DEFAULT_NO_VIOLATIONS_LETTER_TEMPLATE;

    if (existing?.templateText?.trim()) {
      return { seeded: false };
    }

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        templateText,
        parsedText: existing.parsedText?.trim() ? existing.parsedText : templateText,
        updatedAt: now,
      });
      const updated = await ctx.db.get(existing._id);
      if (updated) {
        await recordVersionIfChanged(ctx, {
          doc: updated,
          templateText,
          source: "seed",
          clerkUserId: viewer.clerkUserId,
          note: "Backfilled default no-violations template text",
        });
      }
      return { seeded: true };
    }

    const newDocId = await ctx.db.insert("letterTemplateDocs", {
      hoaId: viewer.hoaId,
      fileName: "default-no-violations-letter.txt",
      fileType: "docx",
      sourcePublicUrl: "",
      sourceFilePath: "",
      parsedText: templateText,
      templateText,
      blocks: emptyBlocks,
      detection: emptyDetection,
      mapping: emptyMapping,
      variant: "noViolations",
      status: "active",
      createdAt: now,
      updatedAt: now,
      activatedAt: now,
    });

    const newDoc = await ctx.db.get(newDocId);
    if (newDoc) {
      await recordVersionIfChanged(ctx, {
        doc: newDoc,
        templateText,
        source: "seed",
        clerkUserId: viewer.clerkUserId,
        note: "Default no-violations template",
      });
    }

    return { seeded: true };
  },
});

/** Ops restore: patch templateText on an existing letterTemplateDocs row (CLI/script only). */
export const internalRestoreTemplateText = internalMutation({
  args: {
    id: v.id("letterTemplateDocs"),
    templateText: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) throw new Error("Template not found.");
    if (!args.templateText.trim()) throw new Error("Template text cannot be empty.");

    await ctx.db.patch(args.id, {
      templateText: args.templateText,
      updatedAt: Date.now(),
    });

    await recordVersionIfChanged(ctx, {
      doc,
      templateText: args.templateText,
      source: "revert",
      note: args.note ?? "Restored from backup",
    });

    return null;
  },
});
