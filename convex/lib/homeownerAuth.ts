import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type HomeownerProperty = {
  propertyId: Id<"properties">;
  hoaId: Id<"hoas"> | undefined;
};

export type HomeownerContext = {
  clerkUserId: string;
  email: string | undefined;
  properties: HomeownerProperty[];
};

/**
 * Resolve the signed-in Clerk user's homeowner memberships (property-scoped).
 * Returns null for unauthenticated callers or users with no propertyMemberships.
 * Homeowner queries/mutations use this instead of requireViewerRole (which is
 * admin/inspector only).
 */
export async function tryGetHomeownerContext(
  ctx: QueryCtx,
): Promise<HomeownerContext | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) return null;

  const memberships = await ctx.db
    .query("propertyMemberships")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", identity.subject))
    .collect();
  if (memberships.length === 0) return null;

  return {
    clerkUserId: identity.subject,
    email: typeof identity.email === "string" ? identity.email : undefined,
    properties: memberships.map((m) => ({
      propertyId: m.propertyId,
      hoaId: m.hoaId,
    })),
  };
}

export async function requireHomeownerContext(
  ctx: QueryCtx,
): Promise<HomeownerContext> {
  const homeowner = await tryGetHomeownerContext(ctx);
  if (!homeowner) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) throw new Error("Authentication required.");
    throw new Error("No homeowner account found. Use your HOA portal link to get started.");
  }
  return homeowner;
}

/**
 * Assert the caller owns `propertyId`; returns the homeowner context on success.
 * Throws otherwise. Every homeowner read/write for a specific property goes
 * through this so one homeowner can never touch another's property.
 */
export async function requireHomeownerForProperty(
  ctx: QueryCtx,
  propertyId: Id<"properties">,
): Promise<HomeownerContext> {
  const homeowner = await requireHomeownerContext(ctx);
  const owns = homeowner.properties.some((p) => p.propertyId === propertyId);
  if (!owns) {
    throw new Error("You do not have access to this property.");
  }
  return homeowner;
}

/** Normalize an email for case/whitespace-insensitive comparison. */
export function normalizeEmail(email: string | undefined | null): string {
  return (email ?? "").trim().toLowerCase();
}
