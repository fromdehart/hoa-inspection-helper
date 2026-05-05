import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const streets = await ctx.db
      .query("streets")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    const result = await Promise.all(
      streets.map(async (street) => {
        const properties = await ctx.db
          .query("properties")
          .withIndex("by_hoa_street", (q) => q.eq("hoaId", viewer.hoaId).eq("streetId", street._id))
          .collect();
        const total = properties.length;
        /** Only verified-complete counts; `review` waits on peer verification. */
        const complete = properties.filter((p) => p.status === "complete").length;
        const inProgress = properties.filter((p) => p.status === "inProgress").length;
        return { _id: street._id, name: street.name, total, complete, inProgress };
      }),
    );
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getWithProperties = query({
  args: { streetId: v.id("streets") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const street = await ctx.db.get(args.streetId);
    if (!street || street.hoaId !== viewer.hoaId) return null;
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_hoa_street", (q) => q.eq("hoaId", viewer.hoaId).eq("streetId", args.streetId))
      .collect();
    const odds = properties
      .filter((p) => p.houseNumber % 2 !== 0)
      .sort((a, b) => a.houseNumber - b.houseNumber);
    const evens = properties
      .filter((p) => p.houseNumber % 2 === 0)
      .sort((a, b) => b.houseNumber - a.houseNumber);
    return { street, properties: [...odds, ...evens] };
  },
});
