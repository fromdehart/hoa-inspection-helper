"use node";

import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as telegramClient from "./telegramClient";

const TELEGRAM_CHALLENGE_ID = "telegram";

function getToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

export const sendMessage = action({
  args: {
    chatId: v.string(),
    message: v.string(),
    mediaUrl: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const token = getToken();
    if (!token) {
      return { success: false as const, error: "Telegram not configured" };
    }
    if (args.mediaUrl) {
      const result = await telegramClient.sendPhoto(
        token,
        args.chatId,
        args.mediaUrl
      );
      if (!result.ok) {
        return { success: false as const, error: result.error };
      }
      return { success: true as const };
    }
    const result = await telegramClient.sendMessage(
      token,
      args.chatId,
      args.message
    );
    if (!result.ok) {
      return { success: false as const, error: result.error };
    }
    return { success: true as const };
  },
});

export const storeIncoming = internalMutation({
  args: {
    chatId: v.string(),
    from: v.optional(v.any()),
    text: v.optional(v.string()),
    updateId: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      challengeId: TELEGRAM_CHALLENGE_ID,
      sessionId: args.chatId,
      eventName: "telegram_incoming",
      metadata: {
        chatId: args.chatId,
        from: args.from,
        text: args.text,
        updateId: args.updateId,
      },
      timestamp: Date.now(),
    });
  },
});
