"use node";

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/telegram-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const headerSecret = request.headers.get("X-Telegram-Secret");
      const url = new URL(request.url);
      const querySecret = url.searchParams.get("secret");
      const provided = headerSecret ?? querySecret ?? "";
      if (provided !== secret) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body: {
      update_id: number;
      message?: {
        chat: { id: number };
        from?: { id: number; username?: string; first_name?: string };
        text?: string;
      };
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const updateId = body.update_id ?? 0;
    const message = body.message;
    const chatId = message?.chat?.id != null ? String(message.chat.id) : "";
    const from = message?.from;
    const text = message?.text;

    if (chatId) {
      await ctx.runMutation(internal.telegram.storeIncoming, {
        chatId,
        from: from ?? undefined,
        text: text ?? undefined,
        updateId,
      });
    }

    return new Response(null, { status: 200 });
  }),
});

export default http;
