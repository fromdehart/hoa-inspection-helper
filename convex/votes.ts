import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

export const castVote = mutation({
  args: {
    challengeId: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("votes")
      .withIndex("by_challenge_and_session", (q) =>
        q.eq("challengeId", args.challengeId).eq("sessionId", args.sessionId)
      )
      .unique();
    if (existing) {
      return { alreadyVoted: true as const };
    }
    await ctx.db.insert("votes", {
      challengeId: args.challengeId,
      sessionId: args.sessionId,
      createdAt: Date.now(),
    });
    const docs = await ctx.db
      .query("votes")
      .withIndex("by_challengeId", (q) => q.eq("challengeId", args.challengeId))
      .collect();
    const count = docs.length;
    if (count === 25) {
      await ctx.scheduler.runAfter(0, api.resend.sendVoteTractionEmail, {
        challengeId: args.challengeId,
        count,
      });
    }
    if (count === 250) {
      await ctx.scheduler.runAfter(0, api.resend.sendVoteMilestoneEmail, {
        challengeId: args.challengeId,
        count,
      });
    }
    return { alreadyVoted: false as const, count };
  },
});

export const getVotes = query({
  args: {
    challengeId: v.string(),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("votes")
      .withIndex("by_challengeId", (q) => q.eq("challengeId", args.challengeId))
      .collect();
    return { count: docs.length };
  },
});
