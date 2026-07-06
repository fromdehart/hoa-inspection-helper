import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  normalizeEmail,
  requireHomeownerContext,
  tryGetHomeownerContext,
} from "./lib/homeownerAuth";

/**
 * Bootstrap a homeowner account from the emailed portal token.
 * Requires: signed-in Clerk user whose verified email matches properties.email.
 * Idempotent — re-claiming returns the existing membership.
 */
export const claimPropertyByToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      return { ok: false as const, error: "Please sign in to claim your property." };
    }
    const identityEmail = normalizeEmail(
      typeof identity.email === "string" ? identity.email : undefined,
    );
    if (!identityEmail) {
      return {
        ok: false as const,
        error: "Your account has no email on file. Sign in with the email your HOA has for you.",
      };
    }

    const property = await ctx.db
      .query("properties")
      .withIndex("by_token", (q) => q.eq("accessToken", args.token))
      .first();
    if (!property) {
      return { ok: false as const, error: "This portal link is invalid or has expired." };
    }

    const propertyEmail = normalizeEmail(property.email);
    if (!propertyEmail) {
      return {
        ok: false as const,
        error: "No homeowner email is on file for this property. Contact your HOA to be added.",
      };
    }
    if (propertyEmail !== identityEmail) {
      return {
        ok: false as const,
        error: "This portal link belongs to a different email. Sign in with the email your HOA has on file.",
      };
    }

    const existing = await ctx.db
      .query("propertyMemberships")
      .withIndex("by_clerk_and_property", (q) =>
        q.eq("clerkUserId", identity.subject).eq("propertyId", property._id),
      )
      .first();
    if (existing) {
      return { ok: true as const, propertyId: property._id, alreadyLinked: true };
    }

    const now = Date.now();
    await ctx.db.insert("propertyMemberships", {
      clerkUserId: identity.subject,
      propertyId: property._id,
      hoaId: property.hoaId,
      email: property.email,
      fullName:
        typeof identity.name === "string" ? identity.name : property.homeownerNames,
      claimedViaToken: true,
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true as const, propertyId: property._id, alreadyLinked: false };
  },
});

/**
 * Properties the signed-in homeowner has claimed. Drives the homeowner shell/guard
 * and the dashboard property switcher. Returns [] for non-homeowners (no throw).
 */
export const myProperties = query({
  args: {},
  handler: async (ctx) => {
    const homeowner = await tryGetHomeownerContext(ctx);
    if (!homeowner) return [];

    const rows = await Promise.all(
      homeowner.properties.map(async ({ propertyId }) => {
        const property = await ctx.db.get(propertyId);
        if (!property) return null;
        const hoa = property.hoaId ? await ctx.db.get(property.hoaId) : null;
        return {
          propertyId,
          address: property.address,
          status: property.status,
          hoaId: property.hoaId ?? null,
          hoaName: hoa?.name ?? "",
          casesEnabled: hoa?.featureFlags?.includes("cases") ?? false,
        };
      }),
    );
    return rows.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/** Lightweight boolean for the frontend guard. */
export const amIHomeowner = query({
  args: {},
  handler: async (ctx) => {
    const homeowner = await requireHomeownerContext(ctx).catch(() => null);
    return homeowner !== null;
  },
});
