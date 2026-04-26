import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const seedRidgeTopTerraceAndBackfill = mutation({
  args: {
    hoaName: v.string(),
    hoaSlug: v.string(),
    memberships: v.array(
      v.object({
        clerkUserId: v.string(),
        role: v.union(v.literal("admin"), v.literal("inspector")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new Error("Authentication required.");
    }

    const now = Date.now();
    let hoa = await ctx.db
      .query("hoas")
      .withIndex("by_slug", (q) => q.eq("slug", args.hoaSlug))
      .first();
    if (!hoa) {
      const hoaId = await ctx.db.insert("hoas", {
        name: args.hoaName,
        slug: args.hoaSlug,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      hoa = await ctx.db.get(hoaId);
    }
    if (!hoa) throw new Error("Failed to create HOA.");

    const byStreet = await ctx.db.query("streets").collect();
    for (const street of byStreet) {
      if (street.hoaId !== hoa._id) {
        await ctx.db.patch(street._id, { hoaId: hoa._id });
      }
    }

    const properties = await ctx.db.query("properties").collect();
    for (const property of properties) {
      if (property.hoaId !== hoa._id) {
        await ctx.db.patch(property._id, { hoaId: hoa._id });
      }
    }

    const photos = await ctx.db.query("photos").collect();
    for (const photo of photos) {
      if (photo.hoaId !== hoa._id) {
        await ctx.db.patch(photo._id, { hoaId: hoa._id });
      }
    }

    const fixPhotos = await ctx.db.query("fixPhotos").collect();
    for (const fixPhoto of fixPhotos) {
      if (fixPhoto.hoaId !== hoa._id) {
        await ctx.db.patch(fixPhoto._id, { hoaId: hoa._id });
      }
    }

    const templates = await ctx.db.query("templates").collect();
    for (const template of templates) {
      if (template.hoaId !== hoa._id) {
        await ctx.db.patch(template._id, { hoaId: hoa._id });
      }
    }

    const aiConfigs = await ctx.db.query("aiConfig").collect();
    for (const cfg of aiConfigs) {
      if (cfg.hoaId !== hoa._id) {
        await ctx.db.patch(cfg._id, { hoaId: hoa._id });
      }
    }

    const templateDocs = await ctx.db.query("letterTemplateDocs").collect();
    for (const doc of templateDocs) {
      if (doc.hoaId !== hoa._id) {
        await ctx.db.patch(doc._id, { hoaId: hoa._id });
      }
    }

    let upsertedMemberships = 0;
    for (const m of args.memberships) {
      const existing = await ctx.db
        .query("userHoaMemberships")
        .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", m.clerkUserId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          hoaId: hoa._id,
          role: m.role,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("userHoaMemberships", {
          clerkUserId: m.clerkUserId,
          hoaId: hoa._id,
          role: m.role,
          createdAt: now,
          updatedAt: now,
        });
      }
      upsertedMemberships++;
    }

    return {
      hoaId: hoa._id,
      hoaName: hoa.name,
      hoaSlug: hoa.slug,
      upsertedMemberships,
      runByClerkUserId: identity.subject,
    };
  },
});

