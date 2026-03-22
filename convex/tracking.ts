import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const trackEvent = mutation({
  args: {
    eventName: v.string(),
    metadata: v.any(),
    challengeId: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      challengeId: args.challengeId,
      sessionId: args.sessionId,
      eventName: args.eventName,
      metadata: args.metadata,
      timestamp: Date.now(),
    });
  },
});
