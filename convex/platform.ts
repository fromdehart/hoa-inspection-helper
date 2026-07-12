import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  getActingHoaId,
  isPlatformAdmin,
  requirePlatformAdmin,
} from "./lib/platformAuth";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function requireBootstrapSecret(provided: string) {
  const expected = process.env.PLATFORM_BOOTSTRAP_SECRET;
  if (!expected || expected.length < 6) {
    throw new Error(
      "PLATFORM_BOOTSTRAP_SECRET is not configured on Convex (set a non-empty value).",
    );
  }
  if (!timingSafeEqualString(provided, expected)) {
    throw new Error("Invalid platform bootstrap secret.");
  }
}

export function normalizeHoaSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function assertValidSlug(slug: string) {
  if (slug.length < 3 || slug.length > 48) {
    throw new Error("Slug must be 3–48 characters.");
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error("Slug may only contain lowercase letters, numbers, and hyphens.");
  }
}

export const isPlatformAdminInternal = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    return await isPlatformAdmin(ctx, args.clerkUserId);
  },
});

export const isPlatformAdminQuery = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return false;
    return await isPlatformAdmin(ctx, identity.subject);
  },
});

export const viewerPlatformState = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      return { isPlatformAdmin: false, actingHoaId: null, actingHoaName: null };
    }
    const platformAdmin = await isPlatformAdmin(ctx, identity.subject);
    if (!platformAdmin) {
      return { isPlatformAdmin: false, actingHoaId: null, actingHoaName: null };
    }
    const actingHoaId = await getActingHoaId(ctx, identity.subject);
    if (!actingHoaId) {
      return { isPlatformAdmin: true, actingHoaId: null, actingHoaName: null };
    }
    const hoa = await ctx.db.get(actingHoaId);
    return {
      isPlatformAdmin: true,
      actingHoaId,
      actingHoaName: hoa?.name ?? null,
    };
  },
});

export const listHoas = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const hoas = await ctx.db.query("hoas").collect();
    const memberships = await ctx.db.query("userHoaMemberships").collect();

    return hoas
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((hoa) => {
        const hoaMembers = memberships.filter((m) => m.hoaId === hoa._id);
        const adminCount = hoaMembers.filter((m) => m.role === "admin").length;
        return {
          _id: hoa._id,
          name: hoa.name,
          slug: hoa.slug,
          status: hoa.status,
          createdAt: hoa.createdAt,
          updatedAt: hoa.updatedAt,
          adminCount,
          memberCount: hoaMembers.length,
        };
      });
  },
});

export const getHoa = query({
  args: { hoaId: v.id("hoas") },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const hoa = await ctx.db.get(args.hoaId);
    if (!hoa) throw new Error("Neighborhood not found.");

    const members = await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_hoa", (q) => q.eq("hoaId", args.hoaId))
      .collect();

    return {
      ...hoa,
      members: members
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((m) => ({
          _id: m._id,
          clerkUserId: m.clerkUserId,
          role: m.role,
          email: m.email ?? "",
          fullName: m.fullName ?? "",
          createdAt: m.createdAt,
        })),
    };
  },
});

export const createHoa = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required.");

    const slug = normalizeHoaSlug(args.slug || name);
    assertValidSlug(slug);

    const existing = await ctx.db
      .query("hoas")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) {
      throw new Error(`A neighborhood with slug "${slug}" already exists.`);
    }

    const now = Date.now();
    const hoaId = await ctx.db.insert("hoas", {
      name,
      slug,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { hoaId, name, slug };
  },
});

export const setHoaStatus = mutation({
  args: {
    hoaId: v.id("hoas"),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const hoa = await ctx.db.get(args.hoaId);
    if (!hoa) throw new Error("Neighborhood not found.");
    await ctx.db.patch(args.hoaId, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return { updated: true as const };
  },
});

/** Toggle a per-HOA feature flag (e.g. "cases", "emailIntake"). Platform admin only. */
export const setFeatureFlag = mutation({
  args: {
    hoaId: v.id("hoas"),
    flag: v.union(v.literal("cases"), v.literal("emailIntake")),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const hoa = await ctx.db.get(args.hoaId);
    if (!hoa) throw new Error("Neighborhood not found.");
    const current = hoa.featureFlags ?? [];
    const next = args.enabled
      ? current.includes(args.flag)
        ? current
        : [...current, args.flag]
      : current.filter((f) => f !== args.flag);
    await ctx.db.patch(args.hoaId, {
      featureFlags: next,
      updatedAt: Date.now(),
    });
    return { featureFlags: next };
  },
});

export const setActingHoa = mutation({
  args: { hoaId: v.id("hoas") },
  handler: async (ctx, args) => {
    const clerkUserId = await requirePlatformAdmin(ctx);
    const hoa = await ctx.db.get(args.hoaId);
    if (!hoa) throw new Error("Neighborhood not found.");
    if (hoa.status !== "active") {
      throw new Error("Cannot act as admin for an inactive neighborhood.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("platformAdminSessions")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        actingHoaId: args.hoaId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("platformAdminSessions", {
        clerkUserId,
        actingHoaId: args.hoaId,
        updatedAt: now,
      });
    }
    return { actingHoaId: args.hoaId, hoaName: hoa.name };
  },
});

export const clearActingHoa = mutation({
  args: {},
  handler: async (ctx) => {
    const clerkUserId = await requirePlatformAdmin(ctx);
    const existing = await ctx.db
      .query("platformAdminSessions")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        actingHoaId: undefined,
        updatedAt: Date.now(),
      });
    }
    return { cleared: true as const };
  },
});

export const addPlatformAdmin = mutation({
  args: {
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdBy = await requirePlatformAdmin(ctx);
    const clerkUserId = args.clerkUserId.trim();
    if (!clerkUserId) throw new Error("clerkUserId is required.");

    const existing = await ctx.db
      .query("platformAdmins")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .first();
    if (existing) {
      return { platformAdminId: existing._id, created: false as const };
    }

    const platformAdminId = await ctx.db.insert("platformAdmins", {
      clerkUserId,
      email: args.email?.trim() || undefined,
      fullName: args.fullName?.trim() || undefined,
      createdAt: Date.now(),
      createdByClerkUserId: createdBy,
    });
    return { platformAdminId, created: true as const };
  },
});

export const bootstrapPlatformAdmin = mutation({
  args: {
    secret: v.string(),
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireBootstrapSecret(args.secret);
    const clerkUserId = args.clerkUserId.trim();
    if (!clerkUserId) throw new Error("clerkUserId is required.");

    const existing = await ctx.db
      .query("platformAdmins")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .first();
    if (existing) {
      return { platformAdminId: existing._id, created: false as const };
    }

    const platformAdminId = await ctx.db.insert("platformAdmins", {
      clerkUserId,
      email: args.email?.trim() || undefined,
      fullName: args.fullName?.trim() || undefined,
      createdAt: Date.now(),
    });
    return { platformAdminId, created: true as const };
  },
});
