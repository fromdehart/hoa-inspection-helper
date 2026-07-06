import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  listManagedHoas,
  requireCompanyMember,
  tryGetCompanyContext,
} from "./lib/companyAuth";

/** Management-company staff surface: portfolio context, acting-as, HOA list. */

export const viewerCompanyContext = query({
  args: {},
  handler: async (ctx) => {
    const company = await tryGetCompanyContext(ctx);
    if (!company) return null;
    const companyDoc = await ctx.db.get(company.companyId);
    if (!companyDoc || companyDoc.status !== "active") return null;

    const session = await ctx.db
      .query("companySessions")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", company.clerkUserId))
      .first();

    return {
      clerkUserId: company.clerkUserId,
      companyId: company.companyId,
      companyName: companyDoc.name,
      role: company.role,
      actingHoaId: session?.actingHoaId ?? null,
    };
  },
});

/** The company's portfolio (active HOAs) with case metrics for the dashboard tiles. */
export const listMyHoas = query({
  args: {},
  handler: async (ctx) => {
    const company = await requireCompanyMember(ctx);
    const hoas = await listManagedHoas(ctx, company.companyId);

    return Promise.all(
      hoas.map(async (hoa) => {
        const full = await ctx.db.get(hoa._id);
        const cases = await ctx.db
          .query("cases")
          .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
          .collect();
        const now = Date.now();
        const openStatuses = new Set(["open", "awaitingHomeowner", "escalated"]);
        const open = cases.filter((c) => openStatuses.has(c.status));
        const overdue = open.filter((c) => c.actionDueAt !== undefined && c.actionDueAt < now);
        const closed = cases.filter((c) => c.closedAt !== undefined);
        const avgResolutionDays =
          closed.length > 0
            ? closed.reduce((sum, c) => sum + ((c.closedAt ?? 0) - c.openedAt), 0) /
              closed.length /
              86_400_000
            : null;
        return {
          hoaId: hoa._id,
          name: full?.name ?? "",
          slug: full?.slug ?? "",
          casesEnabled: full?.featureFlags?.includes("cases") ?? false,
          openCases: open.length,
          overdueCases: overdue.length,
          avgResolutionDays,
        };
      }),
    );
  },
});

/** Act as an HOA in the portfolio — scope-checked here AND on every subsequent read. */
export const setActingHoa = mutation({
  args: { hoaId: v.id("hoas") },
  handler: async (ctx, args) => {
    const company = await requireCompanyMember(ctx);
    const hoa = await ctx.db.get(args.hoaId);
    if (!hoa || hoa.status !== "active") throw new Error("Neighborhood not found.");
    if (hoa.managementCompanyId !== company.companyId) {
      throw new Error("That neighborhood is not in your portfolio.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("companySessions")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", company.clerkUserId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { actingHoaId: args.hoaId, updatedAt: now });
    } else {
      await ctx.db.insert("companySessions", {
        clerkUserId: company.clerkUserId,
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
    const company = await requireCompanyMember(ctx);
    const existing = await ctx.db
      .query("companySessions")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", company.clerkUserId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { actingHoaId: undefined, updatedAt: Date.now() });
    }
    return { cleared: true as const };
  },
});
