"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { openaiGenerate } from "./lib/llmProviders";

const DEFAULT_MODEL = "gpt-4o";

/**
 * Allowlist of models callers may request. Prevents a caller from selecting an
 * arbitrary/expensive model. Unknown models fall back to DEFAULT_MODEL.
 */
const ALLOWED_MODELS = new Set([
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "o1",
  "o3",
  "o3-mini",
  "o4-mini",
]);

function resolveModel(requested: string | undefined): string {
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  return DEFAULT_MODEL;
}

/**
 * DEPRECATED — new callers use `internal.llm.generateText` with a model ROLE
 * (provider-swappable, PRD §11.1). Kept as a thin wrapper over the same
 * provider implementation so existing behavior is unchanged.
 *
 * INTERNAL ONLY. Not callable from the client — reach it through an
 * authenticated wrapper so we never expose an unauthenticated, cost-bearing
 * LLM call. Model is allowlisted via resolveModel.
 */
export const generateText = internalAction({
  args: {
    prompt: v.string(),
    systemPrompt: v.optional(v.string()),
    model: v.optional(v.string()),
    previousResponseId: v.optional(v.string()),
    reasoning: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    temperature: v.optional(v.number()),
    /** When set, ask the Responses API for JSON object output (helps structured ARC reviews). */
    textFormatJsonObject: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    return await openaiGenerate({
      model: resolveModel(args.model),
      prompt: args.prompt,
      systemPrompt: args.systemPrompt,
      temperature: args.temperature,
      previousResponseId: args.previousResponseId,
      reasoning: args.reasoning,
      jsonObject: args.textFormatJsonObject,
    });
  },
});

/** Optional Whisper transcription (inspector mic); requires OPENAI_API_KEY on Convex. Internal only. */
export const transcribeAudio = internalAction({
  args: {
    audioBase64: v.string(),
    mimeType: v.string(),
  },
  handler: async (_ctx, args): Promise<{ text: string; error?: string }> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return { text: "", error: "OPENAI_API_KEY is not configured" };
    }
    try {
      const buf = Buffer.from(args.audioBase64, "base64");
      const form = new FormData();
      const blob = new Blob([buf], { type: args.mimeType || "audio/webm" });
      form.append("file", blob, "clip.webm");
      form.append("model", "whisper-1");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("Whisper error:", res.status, errText);
        return { text: "", error: `Transcription failed (${res.status})` };
      }
      const data = (await res.json()) as { text?: string };
      return { text: data.text ?? "" };
    } catch (e) {
      console.error("transcribeAudio:", e);
      return { text: "", error: "Transcription request failed" };
    }
  },
});
