import type { Id } from "../_generated/dataModel";

type MembershipRole = "admin" | "inspector";

type QueryBuilder<T> = {
  withIndex: (indexName: string, fn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
    first: () => Promise<T | null>;
  };
};

type CtxWithDbAndAuth = {
  db: {
    query: (table: string) => QueryBuilder<{
      _id: Id<"userHoaMemberships">;
      hoaId: Id<"hoas">;
      role: MembershipRole;
    }>;
    get: (id: Id<"hoas">) => Promise<{ _id: Id<"hoas">; status: "active" | "inactive" } | null>;
  };
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
};

export type ViewerContext = {
  clerkUserId: string;
  hoaId: Id<"hoas">;
  role: MembershipRole;
};

export async function requireViewerContext(ctx: CtxWithDbAndAuth): Promise<ViewerContext> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    throw new Error("Authentication required.");
  }
  const membership = await ctx.db
    .query("userHoaMemberships")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first();
  if (!membership) {
    throw new Error("No HOA membership found for this user.");
  }
  const hoa = await ctx.db.get(membership.hoaId);
  if (!hoa || hoa.status !== "active") {
    throw new Error("Assigned HOA is inactive or missing.");
  }
  return {
    clerkUserId: identity.subject,
    hoaId: membership.hoaId,
    role: membership.role,
  };
}

export async function requireViewerRole(
  ctx: CtxWithDbAndAuth,
  roles: MembershipRole[],
): Promise<ViewerContext> {
  const viewer = await requireViewerContext(ctx);
  if (!roles.includes(viewer.role)) {
    throw new Error("You do not have permission for this action.");
  }
  return viewer;
}

