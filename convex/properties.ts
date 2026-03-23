import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    streetId: v.optional(v.id("streets")),
    status: v.optional(v.union(
      v.literal("notStarted"),
      v.literal("inProgress"),
      v.literal("complete"),
    )),
  },
  handler: async (ctx, args) => {
    let properties;
    if (args.streetId) {
      properties = await ctx.db
        .query("properties")
        .withIndex("by_street", (q) => q.eq("streetId", args.streetId!))
        .collect();
    } else {
      properties = await ctx.db.query("properties").collect();
    }
    if (args.status) {
      properties = properties.filter((p) => p.status === args.status);
    }
    return properties.sort((a, b) => a.address.localeCompare(b.address));
  },
});

export const get = query({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("properties")
      .withIndex("by_token", (q) => q.eq("accessToken", args.token))
      .first();
    if (!doc) return null;
    const { accessToken: _accessToken, ...safe } = doc;
    return safe;
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const importFromCSV = mutation({
  args: {
    rows: v.array(
      v.object({
        address: v.string(),
        streetName: v.string(),
        houseNumber: v.number(),
        email: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let created = 0;
    let skipped = 0;
    for (const row of args.rows) {
      // Find or create street
      let streetDoc = await ctx.db
        .query("streets")
        .withIndex("by_name", (q) => q.eq("name", row.streetName))
        .first();
      if (!streetDoc) {
        const streetId = await ctx.db.insert("streets", {
          name: row.streetName,
          createdAt: Date.now(),
        });
        streetDoc = await ctx.db.get(streetId);
      }
      if (!streetDoc) continue;

      // Check for duplicate
      const existing = await ctx.db
        .query("properties")
        .withIndex("by_street", (q) => q.eq("streetId", streetDoc!._id))
        .collect();
      if (existing.some((p) => p.address === row.address)) {
        skipped++;
        continue;
      }

      await ctx.db.insert("properties", {
        streetId: streetDoc._id,
        address: row.address,
        houseNumber: row.houseNumber,
        email: row.email,
        status: "notStarted",
        accessToken: crypto.randomUUID(),
        createdAt: Date.now(),
      });
      created++;
    }
    return { created, skipped };
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("properties"),
    status: v.union(
      v.literal("notStarted"),
      v.literal("inProgress"),
      v.literal("complete"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status });
    return null;
  },
});

export const updateEmail = mutation({
  args: { id: v.id("properties"), email: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { email: args.email });
    return null;
  },
});

export const markLetterSent = internalMutation({
  args: { id: v.id("properties") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { letterSentAt: Date.now() });
    return null;
  },
});
