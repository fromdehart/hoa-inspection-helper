import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

const ROLE_VALIDATOR = v.union(v.literal("admin"), v.literal("inspector"));

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
