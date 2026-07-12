import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePlatformAdmin } from "./lib/platformAuth";

/** Platform-admin management of property-management companies and their portfolios. */

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

export const listCompanies = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const companies = await ctx.db.query("managementCompanies").collect();
    return Promise.all(
      companies
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (company) => {
          const hoas = await ctx.db
            .query("hoas")
            .withIndex("by_company", (q) => q.eq("managementCompanyId", company._id))
            .collect();
          const members = await ctx.db
            .query("companyMemberships")
            .withIndex("by_company", (q) => q.eq("companyId", company._id))
            .collect();
          return {
            _id: company._id,
            name: company.name,
            slug: company.slug,
            status: company.status,
            hoaCount: hoas.length,
            memberCount: members.length,
            hoas: hoas.map((h) => ({ _id: h._id, name: h.name })),
            members: members.map((m) => ({
              _id: m._id,
              clerkUserId: m.clerkUserId,
              role: m.role,
              email: m.email ?? "",
              fullName: m.fullName ?? "",
            })),
          };
        }),
    );
  },
});

export const createCompany = mutation({
  args: { name: v.string(), slug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required.");
    const slug = normalizeSlug(args.slug || name);
    if (!slug) throw new Error("Slug is required.");

    const existing = await ctx.db
      .query("managementCompanies")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) throw new Error(`A company with slug "${slug}" already exists.`);

    const now = Date.now();
    const companyId = await ctx.db.insert("managementCompanies", {
      name,
      slug,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { companyId, name, slug };
  },
});

/** Attach/detach an HOA to a company's portfolio (pass companyId: undefined to detach). */
export const assignHoaToCompany = mutation({
  args: {
    hoaId: v.id("hoas"),
    companyId: v.optional(v.id("managementCompanies")),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const hoa = await ctx.db.get(args.hoaId);
    if (!hoa) throw new Error("Neighborhood not found.");
    if (args.companyId) {
      const company = await ctx.db.get(args.companyId);
      if (!company || company.status !== "active") throw new Error("Company not found.");
    }
    await ctx.db.patch(args.hoaId, {
      managementCompanyId: args.companyId,
      updatedAt: Date.now(),
    });
    return { assigned: !!args.companyId };
  },
});

/**
 * Attach an existing Clerk user as company staff. (Clerk-invite flow for new
 * users mirrors membersNode.createOrAttachMember and can be added when needed;
 * v1 keeps company staff provisioning platform-admin-driven.)
 */
export const addCompanyMember = mutation({
  args: {
    companyId: v.id("managementCompanies"),
    clerkUserId: v.string(),
    role: v.union(v.literal("owner"), v.literal("manager")),
    email: v.optional(v.string()),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx);
    const company = await ctx.db.get(args.companyId);
    if (!company) throw new Error("Company not found.");
    const clerkUserId = args.clerkUserId.trim();
    if (!clerkUserId) throw new Error("Clerk user id is required.");

    // One company membership per user (same one-row assumption as HOA memberships).
    const existing = await ctx.db
      .query("companyMemberships")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        companyId: args.companyId,
        role: args.role,
        email: args.email?.trim().toLowerCase() || existing.email,
        fullName: args.fullName?.trim() || existing.fullName,
        updatedAt: now,
      });
      return { membershipId: existing._id, moved: existing.companyId !== args.companyId };
    }
    const membershipId = await ctx.db.insert("companyMemberships", {
      clerkUserId,
      companyId: args.companyId,
      role: args.role,
      email: args.email?.trim().toLowerCase() || undefined,
      fullName: args.fullName?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { membershipId, moved: false };
  },
});
