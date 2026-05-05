import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole, tryGetViewerContext } from "./lib/tenantAuth";

const ROLE_VALIDATOR = v.union(v.literal("admin"), v.literal("inspector"));

/**
 * HOA membership attribution: prefers `fullName`, then a readable form of the email local-part (no domain).
 * Falls back when neither exists (some seed/import rows omit both).
 */
function membershipDisplayLabel(m: { fullName?: string; email?: string }): string {
  const trimmed = m.fullName?.trim();
  if (trimmed) return trimmed;

  const email = m.email?.trim().toLowerCase();
  if (email?.includes("@")) {
    let localPart = email.split("@")[0] ?? "";
    const plus = localPart.indexOf("+");
    if (plus !== -1) localPart = localPart.slice(0, plus);
    if (localPart) {
      const parts = localPart.split(/[._+-]+/).filter(Boolean);
      if (parts.length > 0) {
        return parts
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
          .join(" ");
      }
    }
  }

  return "Team member";
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const memberships = await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();

    return memberships
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => ({
        _id: m._id,
        clerkUserId: m.clerkUserId,
        role: m.role,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        email: m.email ?? "",
        fullName: m.fullName ?? "",
        invitedByClerkUserId: m.invitedByClerkUserId ?? "",
      }));
  },
});

/** Display names for attribution (no emails); same HOA as viewer. */
export const displayNamesByClerkIds = query({
  args: { clerkUserIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const ids = [...new Set(args.clerkUserIds.filter(Boolean))];
    if (ids.length === 0) return {} as Record<string, string>;

    const memberships = await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();

    const map: Record<string, string> = {};
    for (const m of memberships) {
      if (ids.includes(m.clerkUserId)) {
        map[m.clerkUserId] = membershipDisplayLabel(m);
      }
    }
    return map;
  },
});

/** Writes Clerk-derived name onto the viewer's membership so attribution ("Added by …") stays accurate. */
export const syncMyMembershipDisplayName = mutation({
  args: { fullName: v.string() },
  handler: async (ctx, args) => {
    const viewer = await tryGetViewerContext(ctx);
    if (!viewer) return null;

    const name = args.fullName.trim();
    if (!name) return null;

    const membership = await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", viewer.clerkUserId))
      .first();
    if (!membership) return null;

    if ((membership.fullName ?? "").trim() === name) return null;

    await ctx.db.patch(membership._id, {
      fullName: name,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const updateRole = mutation({
  args: {
    membershipId: v.id("userHoaMemberships"),
    role: ROLE_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.hoaId !== viewer.hoaId) {
      throw new Error("Member not found for your HOA.");
    }
    if (membership.role === args.role) {
      return { updated: false as const };
    }
    if (membership.role === "admin" && args.role !== "admin") {
      const adminCount = (
        await ctx.db
          .query("userHoaMemberships")
          .withIndex("by_hoa_role", (q) => q.eq("hoaId", viewer.hoaId).eq("role", "admin"))
          .collect()
      ).length;
      if (adminCount <= 1) {
        throw new Error("You must keep at least one admin in the HOA.");
      }
    }

    await ctx.db.patch(membership._id, {
      role: args.role,
      updatedAt: Date.now(),
    });
    return { updated: true as const };
  },
});

export const removeMember = mutation({
  args: {
    membershipId: v.id("userHoaMemberships"),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.hoaId !== viewer.hoaId) {
      throw new Error("Member not found for your HOA.");
    }

    if (membership.role === "admin") {
      const adminCount = (
        await ctx.db
          .query("userHoaMemberships")
          .withIndex("by_hoa_role", (q) => q.eq("hoaId", viewer.hoaId).eq("role", "admin"))
          .collect()
      ).length;
      if (adminCount <= 1) {
        throw new Error("You must keep at least one admin in the HOA.");
      }
    }

    await ctx.db.delete(membership._id);
    return { removed: true as const };
  },
});

export const upsertMembershipInternal = internalMutation({
  args: {
    clerkUserId: v.string(),
    hoaId: v.id("hoas"),
    role: ROLE_VALIDATOR,
    email: v.string(),
    fullName: v.optional(v.string()),
    invitedByClerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        hoaId: args.hoaId,
        role: args.role,
        email: args.email,
        fullName: args.fullName,
        invitedByClerkUserId: args.invitedByClerkUserId,
        updatedAt: now,
      });
      return { membershipId: existing._id, created: false as const };
    }

    const membershipId = await ctx.db.insert("userHoaMemberships", {
      clerkUserId: args.clerkUserId,
      hoaId: args.hoaId,
      role: args.role,
      email: args.email,
      fullName: args.fullName,
      invitedByClerkUserId: args.invitedByClerkUserId,
      createdAt: now,
      updatedAt: now,
    });
    return { membershipId, created: true as const };
  },
});

export const listMembershipByClerkUserInternal = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();
  },
});
