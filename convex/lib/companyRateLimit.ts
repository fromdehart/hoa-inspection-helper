import type { MutationCtx } from "../_generated/server";

/**
 * Sliding-window rate limit for management-company copilot AI calls, keyed by
 * Clerk user (mirrors lib/homeownerRateLimit against companyAiUsage). Throws
 * when the limit is exceeded. Call from a mutation (needs ctx.db writes).
 */
export async function checkAndBumpCompanyRateLimit(
  ctx: MutationCtx,
  clerkUserId: string,
  opts: { limit: number; windowMs: number; label?: string },
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query("companyAiUsage")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first();

  if (!row) {
    await ctx.db.insert("companyAiUsage", { clerkUserId, windowStart: now, count: 1 });
    return;
  }

  const windowExpired = now - row.windowStart > opts.windowMs;
  if (windowExpired) {
    await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    return;
  }

  if (row.count >= opts.limit) {
    const mins = Math.ceil((opts.windowMs - (now - row.windowStart)) / 60000);
    throw new Error(
      `You've reached the ${opts.label ?? "copilot"} usage limit. Please try again in about ${mins} minute(s).`,
    );
  }

  await ctx.db.patch(row._id, { count: row.count + 1 });
}
