import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { listManagedHoas, requireCompanyMember } from "./lib/companyAuth";

/**
 * Cross-HOA queues for a management company's staff. Every query fans out over
 * the portfolio's HOA ids with indexed per-HOA reads (never unindexed scans).
 */

const OPEN_STATUSES = new Set<Doc<"cases">["status"]>([
  "open",
  "awaitingHomeowner",
  "escalated",
]);

async function managedHoaIds(
  ctx: QueryCtx,
  companyId: Id<"managementCompanies">,
): Promise<Id<"hoas">[]> {
  const hoas = await listManagedHoas(ctx, companyId);
  return hoas.map((h) => h._id);
}

async function enrichCases(ctx: QueryCtx, cases: Doc<"cases">[]) {
  const enriched = await Promise.all(
    cases.map(async (c) => {
      const [property, hoa] = await Promise.all([
        ctx.db.get(c.propertyId),
        ctx.db.get(c.hoaId),
      ]);
      return {
        _id: c._id,
        hoaId: c.hoaId,
        title: c.title,
        caseType: c.caseType,
        stageKey: c.stageKey,
        status: c.status,
        actionDueAt: c.actionDueAt,
        updatedAt: c.updatedAt,
        address: property?.address ?? "",
        hoaName: hoa?.name ?? "",
      };
    }),
  );
  return enriched.sort((a, b) => (a.actionDueAt ?? Infinity) - (b.actionDueAt ?? Infinity));
}

/** Cases assigned to me, across every community in the portfolio. */
export const myWorkQueue = query({
  args: {},
  handler: async (ctx) => {
    const company = await requireCompanyMember(ctx);
    const hoaIds = new Set(await managedHoaIds(ctx, company.companyId));

    const assigned = await ctx.db
      .query("cases")
      .withIndex("by_assignee_status", (q) =>
        q.eq("assignedToClerkUserId", company.clerkUserId),
      )
      .collect();

    const mine = assigned.filter((c) => hoaIds.has(c.hoaId) && OPEN_STATUSES.has(c.status));
    return enrichCases(ctx, mine);
  },
});

/** Open cases past their action deadline, portfolio-wide. */
export const overdueCases = query({
  args: {},
  handler: async (ctx) => {
    const company = await requireCompanyMember(ctx);
    const hoaIds = await managedHoaIds(ctx, company.companyId);
    const now = Date.now();

    const perHoa = await Promise.all(
      hoaIds.map(async (hoaId) => {
        const rows = await ctx.db
          .query("cases")
          .withIndex("by_hoa_due", (q) => q.eq("hoaId", hoaId).lt("actionDueAt", now))
          .collect();
        return rows.filter((c) => c.actionDueAt !== undefined && OPEN_STATUSES.has(c.status));
      }),
    );
    return enrichCases(ctx, perHoa.flat());
  },
});

/** Undecided hearings coming up across the portfolio. */
export const hearingsThisWeek = query({
  args: { withinDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const company = await requireCompanyMember(ctx);
    const hoaIds = await managedHoaIds(ctx, company.companyId);
    const now = Date.now();
    const horizon = now + (args.withinDays ?? 7) * 86_400_000;

    const perHoa = await Promise.all(
      hoaIds.map((hoaId) =>
        ctx.db
          .query("hearings")
          .withIndex("by_hoa_scheduled", (q) =>
            q.eq("hoaId", hoaId).gte("scheduledFor", now).lte("scheduledFor", horizon),
          )
          .collect(),
      ),
    );
    const upcoming = perHoa.flat().filter((h) => !h.decidedAt);
    return Promise.all(
      upcoming
        .sort((a, b) => a.scheduledFor - b.scheduledFor)
        .map(async (h) => {
          const [caseDoc, property, hoa] = await Promise.all([
            ctx.db.get(h.caseId),
            ctx.db.get(h.propertyId),
            ctx.db.get(h.hoaId),
          ]);
          return {
            _id: h._id,
            caseId: h.caseId,
            scheduledFor: h.scheduledFor,
            location: h.location,
            caseTitle: caseDoc?.title ?? "",
            address: property?.address ?? "",
            hoaName: hoa?.name ?? "",
          };
        }),
    );
  },
});

/** Waiting-on-us vs waiting-on-homeowner split, portfolio-wide. */
export const awaitingSplit = query({
  args: {},
  handler: async (ctx) => {
    const company = await requireCompanyMember(ctx);
    const hoaIds = await managedHoaIds(ctx, company.companyId);

    let awaitingStaff = 0;
    let awaitingHomeowner = 0;
    for (const hoaId of hoaIds) {
      for (const status of ["open", "escalated", "awaitingHomeowner"] as const) {
        const rows = await ctx.db
          .query("cases")
          .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoaId).eq("status", status))
          .collect();
        if (status === "awaitingHomeowner") awaitingHomeowner += rows.length;
        else awaitingStaff += rows.length;
      }
    }
    return { awaitingStaff, awaitingHomeowner };
  },
});

/**
 * Benchmarking across the portfolio (pure query — no AI): open load, overdue
 * rate, and resolution speed per community, plus per-manager load.
 */
export const benchmarks = query({
  args: {},
  handler: async (ctx) => {
    const company = await requireCompanyMember(ctx);
    const hoaIds = await managedHoaIds(ctx, company.companyId);
    const now = Date.now();

    const communities = await Promise.all(
      hoaIds.map(async (hoaId) => {
        const hoa = await ctx.db.get(hoaId);
        const cases = await ctx.db
          .query("cases")
          .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
          .collect();
        const open = cases.filter((c) => OPEN_STATUSES.has(c.status));
        const overdue = open.filter((c) => c.actionDueAt !== undefined && c.actionDueAt < now);
        const closed = cases.filter((c) => c.closedAt !== undefined);
        return {
          hoaId,
          name: hoa?.name ?? "",
          totalCases: cases.length,
          openCases: open.length,
          overdueRate: open.length > 0 ? overdue.length / open.length : 0,
          avgResolutionDays:
            closed.length > 0
              ? closed.reduce((sum, c) => sum + ((c.closedAt ?? 0) - c.openedAt), 0) /
                closed.length /
                86_400_000
              : null,
        };
      }),
    );

    // Per-manager open-case load (assigned cases only).
    const managerLoad = new Map<string, number>();
    for (const hoaId of hoaIds) {
      const open = await ctx.db
        .query("cases")
        .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
        .collect();
      for (const c of open) {
        if (!OPEN_STATUSES.has(c.status) || !c.assignedToClerkUserId) continue;
        managerLoad.set(
          c.assignedToClerkUserId,
          (managerLoad.get(c.assignedToClerkUserId) ?? 0) + 1,
        );
      }
    }

    return {
      communities: communities.sort((a, b) => b.openCases - a.openCases),
      managerLoad: [...managerLoad.entries()].map(([clerkUserId, openCases]) => ({
        clerkUserId,
        openCases,
      })),
    };
  },
});

/** Homeowner-chatbot deflection: conversations handled per community (manager time saved). */
export const deflectionStats = query({
  args: {},
  handler: async (ctx) => {
    const company = await requireCompanyMember(ctx);
    const hoaIds = await managedHoaIds(ctx, company.companyId);

    const perHoa = await Promise.all(
      hoaIds.map(async (hoaId) => {
        const hoa = await ctx.db.get(hoaId);
        const conversations = await ctx.db
          .query("chatConversations")
          .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
          .collect();
        let messages = 0;
        for (const conversation of conversations) {
          const rows = await ctx.db
            .query("chatMessages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
            .collect();
          messages += rows.filter((m) => m.role === "assistant").length;
        }
        return {
          hoaId,
          name: hoa?.name ?? "",
          conversations: conversations.length,
          answersDelivered: messages,
        };
      }),
    );
    return perHoa.sort((a, b) => b.answersDelivered - a.answersDelivered);
  },
});
