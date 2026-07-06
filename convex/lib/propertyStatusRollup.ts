import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Dual-write bridge: derive the legacy `properties.status` from the property's
 * cases so the existing Dashboard/homeowner portal keep working while the case
 * system becomes the source of truth. Called at the end of every case mutation.
 *
 * Mapping: any open case → inProgress; else any awaitingHomeowner →
 * review; else (≥1 case, all resolved/closed) → complete. Escalated counts as
 * open work. Properties with no cases are left untouched (legacy flows own them).
 */
export async function syncPropertyStatusFromCases(
  ctx: MutationCtx,
  propertyId: Id<"properties">,
): Promise<void> {
  const property = await ctx.db.get(propertyId);
  if (!property) return;

  const cases = await ctx.db
    .query("cases")
    .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
    .collect();
  if (cases.length === 0) return;

  const hasOpen = cases.some((c) => c.status === "open" || c.status === "escalated");
  const hasAwaiting = cases.some((c) => c.status === "awaitingHomeowner");

  const next = hasOpen ? "inProgress" : hasAwaiting ? "review" : "complete";
  if (property.status !== next) {
    await ctx.db.patch(propertyId, { status: next });
  }
}
