import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireViewerRole } from "./lib/tenantAuth";

export type ArcReviewPosture = "strict" | "practical" | "homeownerFriendly";

const POSTURE_KEY = "arcReviewPosture";
const GUIDANCE_KEY = "arcReviewAdminGuidance";
const SHOW_ON_PROPERTY_KEY = "arcShowApplicationOnPropertyPage";

async function readSettings(ctx: QueryCtx, hoaId: Id<"hoas">) {
  const postureDoc = await ctx.db
    .query("aiConfig")
    .withIndex("by_hoa_key", (q) => q.eq("hoaId", hoaId).eq("key", POSTURE_KEY))
    .first();
  const guidanceDoc = await ctx.db
    .query("aiConfig")
    .withIndex("by_hoa_key", (q) => q.eq("hoaId", hoaId).eq("key", GUIDANCE_KEY))
    .first();
  const showOnPropertyDoc = await ctx.db
    .query("aiConfig")
    .withIndex("by_hoa_key", (q) => q.eq("hoaId", hoaId).eq("key", SHOW_ON_PROPERTY_KEY))
    .first();
  const postureRaw = postureDoc?.value ?? "";
  const posture: ArcReviewPosture =
    postureRaw === "strict" || postureRaw === "practical" || postureRaw === "homeownerFriendly"
      ? postureRaw
      : "homeownerFriendly";
  return {
    reviewPosture: posture,
    adminGuidance: guidanceDoc?.value ?? "",
    showArcApplicationOnPropertyPage: showOnPropertyDoc?.value === "true",
  };
}

/** Internal: ARC review settings for an HOA (used by scheduled ARC review). */
export const getByHoaInternal = internalQuery({
  args: { hoaId: v.id("hoas") },
  handler: async (ctx, args) => readSettings(ctx, args.hoaId),
});

export const get = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    return readSettings(ctx, viewer.hoaId);
  },
});

export const set = mutation({
  args: {
    reviewPosture: v.union(v.literal("strict"), v.literal("practical"), v.literal("homeownerFriendly")),
    adminGuidance: v.string(),
    showArcApplicationOnPropertyPage: v.boolean(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const upsert = async (key: string, value: string) => {
      const existing = await ctx.db
        .query("aiConfig")
        .withIndex("by_hoa_key", (q) => q.eq("hoaId", viewer.hoaId).eq("key", key))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
      } else {
        await ctx.db.insert("aiConfig", {
          hoaId: viewer.hoaId,
          key,
          value,
          updatedAt: Date.now(),
        });
      }
    };
    await upsert(POSTURE_KEY, args.reviewPosture);
    await upsert(GUIDANCE_KEY, args.adminGuidance);
    await upsert(SHOW_ON_PROPERTY_KEY, args.showArcApplicationOnPropertyPage ? "true" : "false");
    return null;
  },
});
