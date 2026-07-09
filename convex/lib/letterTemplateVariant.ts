import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

export const letterTemplateVariantValidator = v.union(
  v.literal("violation"),
  v.literal("noViolations"),
);

export type LetterTemplateVariant = "violation" | "noViolations";

export const letterTemplateVersionSourceValidator = v.union(
  v.literal("save"),
  v.literal("upload"),
  v.literal("revert"),
  v.literal("seed"),
);

export type LetterTemplateVersionSource = "save" | "upload" | "revert" | "seed";

export const LETTER_TEMPLATE_VERSION_RETENTION = 30;

export function normalizeLetterTemplateVariant(
  variant: LetterTemplateVariant | undefined,
): LetterTemplateVariant {
  return variant ?? "violation";
}

export function docMatchesVariant(
  doc: Doc<"letterTemplateDocs">,
  variant: LetterTemplateVariant,
): boolean {
  return normalizeLetterTemplateVariant(doc.variant) === variant;
}
