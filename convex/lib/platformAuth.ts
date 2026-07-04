import type { Id } from "../_generated/dataModel";

type PlatformCtx = {
  db: {
    query: (table: string) => {
      withIndex: (
        indexName: string,
        fn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        first: () => Promise<unknown | null>;
      };
    };
  };
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
};

export async function isPlatformAdmin(
  ctx: PlatformCtx,
  clerkUserId: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("platformAdmins")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first();
  return row !== null;
}

export async function requirePlatformAdmin(ctx: PlatformCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("Authentication required.");
  }
  const ok = await isPlatformAdmin(ctx, identity.subject);
  if (!ok) {
    throw new Error("Platform admin access required.");
  }
  return identity.subject;
}

export async function getActingHoaId(
  ctx: PlatformCtx,
  clerkUserId: string,
): Promise<Id<"hoas"> | null> {
  const session = await ctx.db
    .query("platformAdminSessions")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first();
  if (!session || !("actingHoaId" in session) || !session.actingHoaId) {
    return null;
  }
  return session.actingHoaId as Id<"hoas">;
}
