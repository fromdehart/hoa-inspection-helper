import type { Id } from "../_generated/dataModel";
import { getActingHoaId, isPlatformAdmin } from "./platformAuth";

type MembershipRole = "admin" | "inspector";

type QueryBuilder = {
  withIndex: (indexName: string, fn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
    first: () => Promise<unknown>;
  };
};

type CtxWithDbAndAuth = {
  db: {
    query: (table: string) => QueryBuilder;
    get: (id: Id<"hoas">) => Promise<{ _id: Id<"hoas">; status: "active" | "inactive" } | null>;
  };
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
};

type MembershipRow = {
  _id: Id<"userHoaMemberships">;
  hoaId: Id<"hoas">;
  role: MembershipRole;
};

export type ViewerContext = {
  clerkUserId: string;
  hoaId: Id<"hoas">;
  role: MembershipRole;
  isPlatformAdmin: boolean;
  isActingAsAdmin: boolean;
};

/** For public queries: no identity, membership, or active HOA → null (no throw). */
export async function tryGetViewerContext(ctx: CtxWithDbAndAuth): Promise<ViewerContext | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) return null;

  const platformAdmin = await isPlatformAdmin(ctx, identity.subject);
  const actingHoaId = platformAdmin ? await getActingHoaId(ctx, identity.subject) : null;

  if (platformAdmin && actingHoaId) {
    const hoa = await ctx.db.get(actingHoaId);
    if (!hoa || hoa.status !== "active") return null;
    return {
      clerkUserId: identity.subject,
      hoaId: actingHoaId,
      role: "admin",
      isPlatformAdmin: true,
      isActingAsAdmin: true,
    };
  }

  const membership = (await ctx.db
    .query("userHoaMemberships")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .first()) as MembershipRow | null;
  if (!membership) {
    if (platformAdmin) {
      return null;
    }
    return null;
  }
  const hoa = await ctx.db.get(membership.hoaId);
  if (!hoa || hoa.status !== "active") return null;
  return {
    clerkUserId: identity.subject,
    hoaId: membership.hoaId,
    role: membership.role,
    isPlatformAdmin: platformAdmin,
    isActingAsAdmin: false,
  };
}

export async function requireViewerContext(ctx: CtxWithDbAndAuth): Promise<ViewerContext> {
  const viewer = await tryGetViewerContext(ctx);
  if (!viewer) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new Error("Authentication required.");
    }
    const platformAdmin = await isPlatformAdmin(ctx, identity.subject);
    if (platformAdmin) {
      throw new Error("Select a neighborhood to act as admin, or use your HOA membership.");
    }
    throw new Error("No HOA membership found for this user.");
  }
  return viewer;
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
