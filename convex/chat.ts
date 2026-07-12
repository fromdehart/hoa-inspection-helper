import { action, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { requireHomeownerForProperty } from "./lib/homeownerAuth";
import { checkAndBumpRateLimit } from "./lib/homeownerRateLimit";

const MAX_CORPUS_CHARS = 36_000;
const RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000, label: "chat" };

const SYSTEM_PROMPT = `You are a friendly assistant for a homeowners association (HOA).
Answer homeowner questions using ONLY the HOA rules and guideline documents provided in the context.
Rules:
- If the answer is in the documents, answer clearly and cite the document title in parentheses.
- If the documents don't cover the question, say you don't have that in the HOA documents and suggest they contact the HOA board. Do not guess.
- Never give legal advice or make binding approvals; the HOA board has final say.
- Be concise and neighborly.`;

/**
 * Build the HOA rules corpus for grounding (visible reference docs + config text),
 * truncated to MAX_CORPUS_CHARS. Enforces homeowner ownership of the property.
 */
export const getContext = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    await requireHomeownerForProperty(ctx, args.propertyId);
    const property = await ctx.db.get(args.propertyId);
    if (!property?.hoaId) return { corpus: "" };

    const sections: string[] = [];
    for (const key of ["approvedColors", "hoaGuidelines", "violationRules"] as const) {
      const doc = await ctx.db
        .query("aiConfig")
        .withIndex("by_hoa_key", (q) => q.eq("hoaId", property.hoaId).eq("key", key))
        .first();
      if (doc?.value?.trim()) sections.push(`# ${key}\n${doc.value.trim()}`);
    }

    const refDocs = await ctx.db
      .query("arcReferenceDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", property.hoaId))
      .collect();
    for (const d of refDocs) {
      if (d.visibleToHomeowners === false) continue;
      if (d.parsedText.trim()) sections.push(`# ${d.title}\n${d.parsedText.trim()}`);
    }

    let corpus = "";
    for (const s of sections) {
      if (corpus.length + s.length + 2 > MAX_CORPUS_CHARS) {
        corpus += "\n\n" + s.slice(0, Math.max(0, MAX_CORPUS_CHARS - corpus.length)) + "\n[... truncated ...]";
        break;
      }
      corpus += (corpus ? "\n\n" : "") + s;
    }
    return { corpus };
  },
});

/** The homeowner's chat thread for a property, with messages in order. */
export const myConversation = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const homeowner = await requireHomeownerForProperty(ctx, args.propertyId);
    const convo = await ctx.db
      .query("chatConversations")
      .withIndex("by_clerk_property", (q) =>
        q.eq("clerkUserId", homeowner.clerkUserId).eq("propertyId", args.propertyId),
      )
      .first();
    if (!convo) return { conversationId: null, messages: [] as const };
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", convo._id))
      .collect();
    return {
      conversationId: convo._id,
      messages: messages
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((m) => ({ _id: m._id, role: m.role, text: m.text, createdAt: m.createdAt })),
    };
  },
});

export const internalCheckRateLimit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) throw new Error("Authentication required.");
    await checkAndBumpRateLimit(ctx, identity.subject, RATE_LIMIT);
  },
});

export const internalRecordUserMessage = internalMutation({
  args: { propertyId: v.id("properties"), message: v.string() },
  handler: async (ctx, args) => {
    const homeowner = await requireHomeownerForProperty(ctx, args.propertyId);
    const property = await ctx.db.get(args.propertyId);
    const now = Date.now();

    const convo = await ctx.db
      .query("chatConversations")
      .withIndex("by_clerk_property", (q) =>
        q.eq("clerkUserId", homeowner.clerkUserId).eq("propertyId", args.propertyId),
      )
      .first();

    let conversationId;
    let previousResponseId = "";
    if (!convo) {
      conversationId = await ctx.db.insert("chatConversations", {
        clerkUserId: homeowner.clerkUserId,
        propertyId: args.propertyId,
        hoaId: property?.hoaId,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      conversationId = convo._id;
      previousResponseId = convo.openaiResponseId ?? "";
      await ctx.db.patch(convo._id, { updatedAt: now });
    }

    await ctx.db.insert("chatMessages", {
      conversationId,
      role: "user",
      text: args.message,
      createdAt: now,
    });
    return { conversationId, previousResponseId };
  },
});

export const internalRecordAssistantMessage = internalMutation({
  args: {
    conversationId: v.id("chatConversations"),
    text: v.string(),
    responseId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("chatMessages", {
      conversationId: args.conversationId,
      role: "assistant",
      text: args.text,
      createdAt: now,
    });
    if (args.responseId) {
      await ctx.db.patch(args.conversationId, {
        openaiResponseId: args.responseId,
        updatedAt: now,
      });
    }
    return null;
  },
});

/**
 * Ask the HOA assistant a question. Rate-limited, grounded in the HOA docs, and
 * multi-turn via the OpenAI Responses API previous_response_id.
 */
export const ask = action({
  args: { propertyId: v.id("properties"), message: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const trimmed = args.message.trim();
    if (!trimmed) return { ok: false, error: "Please enter a question." };
    if (trimmed.length > 2000) return { ok: false, error: "That question is too long." };

    try {
      await ctx.runMutation(internal.chat.internalCheckRateLimit, {});
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Rate limit reached." };
    }

    // Enforces ownership and gives us the grounding corpus.
    const { corpus } = await ctx.runQuery(api.chat.getContext, { propertyId: args.propertyId });

    const { conversationId, previousResponseId } = await ctx.runMutation(
      internal.chat.internalRecordUserMessage,
      { propertyId: args.propertyId, message: trimmed },
    );

    // On the first turn we stuff the corpus; later turns rely on previous_response_id.
    const prompt = previousResponseId
      ? trimmed
      : `HOA documents (context):\n${corpus || "(No HOA documents have been published yet.)"}\n\nHomeowner question:\n${trimmed}`;

    const { text, responseId } = await ctx.runAction(internal.llm.generateText, {
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      role: "chat",
      temperature: 0.3,
      previousResponseId: previousResponseId || undefined,
    });

    const answer =
      text.trim() ||
      "I'm sorry, I couldn't generate an answer right now. Please try again in a moment.";
    await ctx.runMutation(internal.chat.internalRecordAssistantMessage, {
      conversationId,
      text: answer,
      responseId: responseId ?? "",
    });

    return { ok: true, text: answer };
  },
});
