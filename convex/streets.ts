import { query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const streets = await ctx.db.query("streets").collect();
    const result = await Promise.all(
      streets.map(async (street) => {
        const properties = await ctx.db
          .query("properties")
          .withIndex("by_street", (q) => q.eq("streetId", street._id))
          .collect();
        const total = properties.length;
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
    const street = await ctx.db.get(args.streetId);
    if (!street) return null;
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_street", (q) => q.eq("streetId", args.streetId))
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
