import type { Id } from "../_generated/dataModel";

/**
 * Per-HOA feature flags stored on `hoas.featureFlags` (string array).
 * Platform admins toggle flags from the platform HOA detail page.
 * Known flags: "cases" (case tracking system), "emailIntake" (email → case pipeline).
 */

export type FeatureFlag = "cases" | "emailIntake";

type CtxWithDb = {
  db: {
    get: (id: Id<"hoas">) => Promise<{ featureFlags?: string[] } | null>;
  };
};

export async function isFeatureEnabled(
  ctx: CtxWithDb,
  hoaId: Id<"hoas">,
  flag: FeatureFlag,
): Promise<boolean> {
  const hoa = await ctx.db.get(hoaId);
  return !!hoa?.featureFlags?.includes(flag);
}

export async function requireFeature(
  ctx: CtxWithDb,
  hoaId: Id<"hoas">,
  flag: FeatureFlag,
): Promise<void> {
  if (!(await isFeatureEnabled(ctx, hoaId, flag))) {
    throw new Error("This feature is not enabled for this neighborhood.");
  }
}
