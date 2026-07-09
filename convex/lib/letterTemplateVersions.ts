import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  LETTER_TEMPLATE_VERSION_RETENTION,
  normalizeLetterTemplateVariant,
  type LetterTemplateVersionSource,
} from "./letterTemplateVariant";

export function versionPreview(templateText: string, maxLen = 120): string {
  const oneLine = templateText.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen)}…`;
}

async function getLatestVersion(
  ctx: QueryCtx | MutationCtx,
  templateDocId: Id<"letterTemplateDocs">,
): Promise<Doc<"letterTemplateVersions"> | null> {
  return await ctx.db
    .query("letterTemplateVersions")
    .withIndex("by_template_doc", (q) => q.eq("templateDocId", templateDocId))
    .order("desc")
    .first();
}

async function pruneOldVersions(
  ctx: MutationCtx,
  templateDocId: Id<"letterTemplateDocs">,
): Promise<void> {
  const versions = await ctx.db
    .query("letterTemplateVersions")
    .withIndex("by_template_doc", (q) => q.eq("templateDocId", templateDocId))
    .order("desc")
    .collect();

  for (const version of versions.slice(LETTER_TEMPLATE_VERSION_RETENTION)) {
    await ctx.db.delete(version._id);
  }
}

export async function recordVersionIfChanged(
  ctx: MutationCtx,
  args: {
    doc: Doc<"letterTemplateDocs">;
    templateText: string;
    source: LetterTemplateVersionSource;
    clerkUserId?: string;
    note?: string;
  },
): Promise<Id<"letterTemplateVersions"> | null> {
  if (!args.doc.hoaId) return null;

  const templateText = args.templateText.trim();
  if (!templateText) return null;

  const latest = await getLatestVersion(ctx, args.doc._id);
  if (latest?.templateText === templateText) return null;

  const savedAt = Date.now();
  const versionId = await ctx.db.insert("letterTemplateVersions", {
    hoaId: args.doc.hoaId,
    templateDocId: args.doc._id,
    variant: normalizeLetterTemplateVariant(args.doc.variant),
    templateText,
    source: args.source,
    savedAt,
    savedByClerkUserId: args.clerkUserId,
    note: args.note,
  });

  await pruneOldVersions(ctx, args.doc._id);
  return versionId;
}

export async function listVersionsForDoc(
  ctx: QueryCtx,
  templateDocId: Id<"letterTemplateDocs">,
  limit = LETTER_TEMPLATE_VERSION_RETENTION,
): Promise<Array<{
  _id: Id<"letterTemplateVersions">;
  savedAt: number;
  source: LetterTemplateVersionSource;
  note?: string;
  preview: string;
}>> {
  const versions = await ctx.db
    .query("letterTemplateVersions")
    .withIndex("by_template_doc", (q) => q.eq("templateDocId", templateDocId))
    .order("desc")
    .take(limit);

  return versions.map((version) => ({
    _id: version._id,
    savedAt: version.savedAt,
    source: version.source,
    note: version.note,
    preview: versionPreview(version.templateText),
  }));
}

export async function hasAnyVersion(
  ctx: QueryCtx | MutationCtx,
  templateDocId: Id<"letterTemplateDocs">,
): Promise<boolean> {
  const latest = await getLatestVersion(ctx, templateDocId);
  return latest !== null;
}
