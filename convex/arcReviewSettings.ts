import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

export type ArcReviewPosture = "strict" | "practical" | "homeownerFriendly";

const POSTURE_KEY = "arcReviewPosture";
const GUIDANCE_KEY = "arcReviewAdminGuidance";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const postureDoc = await ctx.db
      .query("aiConfig")
      .withIndex("by_hoa_key", (q) => q.eq("hoaId", viewer.hoaId).eq("key", POSTURE_KEY))
      .first();
    const guidanceDoc = await ctx.db
      .query("aiConfig")
      .withIndex("by_hoa_key", (q) => q.eq("hoaId", viewer.hoaId).eq("key", GUIDANCE_KEY))
      .first();
    const postureRaw = postureDoc?.value ?? "";
    const posture: ArcReviewPosture =
      postureRaw === "strict" || postureRaw === "practical" || postureRaw === "homeownerFriendly"
        ? postureRaw
        : "homeownerFriendly";
    return {
      reviewPosture: posture,
      adminGuidance: guidanceDoc?.value ?? "",
    };
  },
});

export const set = mutation({
  args: {
    reviewPosture: v.union(v.literal("strict"), v.literal("practical"), v.literal("homeownerFriendly")),
    adminGuidance: v.string(),
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
    return null;
  },
});
