import type { MutationCtx } from "../_generated/server";

/**
 * Sliding-window rate limit for homeowner AI calls, keyed by Clerk user.
 * Throws when the limit is exceeded. Call from a mutation (needs ctx.db writes).
 */
export async function checkAndBumpRateLimit(
  ctx: MutationCtx,
  clerkUserId: string,
  opts: { limit: number; windowMs: number; label?: string },
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query("homeownerAiUsage")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first();

  if (!row) {
    await ctx.db.insert("homeownerAiUsage", { clerkUserId, windowStart: now, count: 1 });
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
      `You've reached the ${opts.label ?? "AI"} usage limit. Please try again in about ${mins} minute(s).`,
    );
  }

  await ctx.db.patch(row._id, { count: row.count + 1 });
}
