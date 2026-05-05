import type { Doc } from "../_generated/dataModel";

/** True when the property document has persisted inspection notes (sections or legacy combined). */
export function propertyHasInspectorNotesContent(property: Doc<"properties">): boolean {
  if (
    (property.inspectorNotesFront?.trim() ?? "") ||
    (property.inspectorNotesSide?.trim() ?? "") ||
    (property.inspectorNotesBack?.trim() ?? "")
  ) {
    return true;
  }
  return !!(property.inspectorNotes?.trim() ?? "");
}

export function buildCombinedInspectorNotes(front: string, side: string, back: string): string {
  const parts: string[] = [];
  const f = front.trim();
  const s = side.trim();
  const b = back.trim();
  if (f) parts.push(`Front:\n${f}`);
  if (s) parts.push(`Side:\n${s}`);
  if (b) parts.push(`Back:\n${b}`);
  return parts.join("\n\n");
}

/** Legacy rows: only `inspectorNotes` until first section save; treat as front content. */
export function resolveSectionInputs(
  property: Doc<"properties">,
  front: string,
  side: string,
  back: string,
): { front: string; side: string; back: string } {
  const anyStored =
    (property.inspectorNotesFront?.trim() ?? "") ||
    (property.inspectorNotesSide?.trim() ?? "") ||
    (property.inspectorNotesBack?.trim() ?? "");
  const legacy = property.inspectorNotes?.trim() ?? "";
  if (!front.trim() && !side.trim() && !back.trim() && legacy && !anyStored) {
    return { front: legacy, side: "", back: "" };
  }
  return { front, side, back };
}

export function buildInspectorNotesPatch(
  property: Doc<"properties">,
  viewerClerkUserId: string,
  resolved: { front: string; side: string; back: string },
): Record<string, unknown> {
  const combined = buildCombinedInspectorNotes(resolved.front, resolved.side, resolved.back);
  const now = Date.now();
  const hasContent = !!(resolved.front.trim() || resolved.side.trim() || resolved.back.trim());
  const patch: Record<string, unknown> = {
    inspectorNotesFront: resolved.front,
    inspectorNotesSide: resolved.side,
    inspectorNotesBack: resolved.back,
    inspectorNotes: combined || undefined,
    inspectionNotesLastUpdatedByClerkUserId: viewerClerkUserId,
    inspectionNotesLastUpdatedAt: now,
  };
  if (hasContent && !property.inspectionNotesEnteredByClerkUserId) {
    patch.inspectionNotesEnteredByClerkUserId = viewerClerkUserId;
    patch.inspectionNotesEnteredAt = now;
  }
  return patch;
}
