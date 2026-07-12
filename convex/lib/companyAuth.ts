import type { Id } from "../_generated/dataModel";

/**
 * Auth helpers for management-company staff. A company manager has NO
 * userHoaMemberships rows; they reach HOA data only by "acting as" an HOA in
 * their portfolio (companySessions.actingHoaId), which tenantAuth resolves to
 * an admin-shaped ViewerContext. Portfolio scope is re-validated on every read
 * — a stale session pointing at an HOA that left the portfolio yields null.
 */

type CompanyRole = "owner" | "manager";

// Structural ctx types (same pattern as tenantAuth/platformAuth) so these
// helpers work from queries, mutations, and internal queries alike.
type QueryBuilder = {
  withIndex: (
    indexName: string,
    fn: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
  ) => {
    first: () => Promise<unknown>;
    collect: () => Promise<unknown[]>;
  };
};

type CompanyCtx = {
  db: {
    query: (table: string) => QueryBuilder;
  };
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
};

type MembershipRow = {
  _id: Id<"companyMemberships">;
  companyId: Id<"managementCompanies">;
  role: CompanyRole;
};

type SessionRow = {
  actingHoaId?: Id<"hoas">;
};

type HoaRow = {
  _id: Id<"hoas">;
  status: "active" | "inactive";
  managementCompanyId?: Id<"managementCompanies">;
};

export type CompanyContext = {
  clerkUserId: string;
  companyId: Id<"managementCompanies">;
  role: CompanyRole;
};

export async function tryGetCompanyContext(ctx: CompanyCtx): Promise<CompanyContext | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) return null;
  return tryGetCompanyContextForUser(ctx, identity.subject);
}

export async function tryGetCompanyContextForUser(
  ctx: CompanyCtx,
  clerkUserId: string,
): Promise<CompanyContext | null> {
  const membership = (await ctx.db
    .query("companyMemberships")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first()) as MembershipRow | null;
  if (!membership) return null;
  return {
    clerkUserId,
    companyId: membership.companyId,
    role: membership.role,
  };
}

export async function requireCompanyMember(ctx: CompanyCtx): Promise<CompanyContext> {
  const company = await tryGetCompanyContext(ctx);
  if (!company) throw new Error("Management-company access required.");
  return company;
}

export async function requireCompanyRole(
  ctx: CompanyCtx,
  roles: CompanyRole[],
): Promise<CompanyContext> {
  const company = await requireCompanyMember(ctx);
  if (!roles.includes(company.role)) {
    throw new Error("You do not have permission for this action.");
  }
  return company;
}

/** Active HOAs in the company's portfolio. */
export async function listManagedHoas(
  ctx: CompanyCtx,
  companyId: Id<"managementCompanies">,
): Promise<HoaRow[]> {
  const hoas = (await ctx.db
    .query("hoas")
    .withIndex("by_company", (q) => q.eq("managementCompanyId", companyId))
    .collect()) as HoaRow[];
  return hoas.filter((h) => h.status === "active");
}

/**
 * The HOA a company manager is currently acting as — validated against the
 * portfolio on EVERY read (unlike the platform-admin session, which is global).
 */
export async function getCompanyActingHoa(
  ctx: CompanyCtx,
  clerkUserId: string,
): Promise<{ hoaId: Id<"hoas">; companyId: Id<"managementCompanies"> } | null> {
  const membership = (await ctx.db
    .query("companyMemberships")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first()) as MembershipRow | null;
  if (!membership) return null;

  const session = (await ctx.db
    .query("companySessions")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
    .first()) as SessionRow | null;
  if (!session?.actingHoaId) return null;

  const hoas = await listManagedHoas(ctx, membership.companyId);
  const hoa = hoas.find((h) => h._id === session.actingHoaId);
  if (!hoa) return null; // stale session or HOA left the portfolio → no access
  return { hoaId: hoa._id, companyId: membership.companyId };
}
