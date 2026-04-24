"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const getApiKey = () => process.env.OPENAI_API_KEY!;

function isReasoningModel(model: string): boolean {
  return /^(o1|o3|o4)/.test(model);
}

/**
 * Extract text from OpenAI Responses API response.
 * Handles nested output[].content[] with type "output_text"; returns "" on missing/unexpected shape.
 */
function extractText(response: {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
  try {
    const parts =
      response.output?.flatMap((o) => o.content ?? []) ?? [];
    const texts = parts
      .filter((c) => c.type === "output_text" && c.text != null)
      .map((c) => c.text as string);
    return texts.join("") ?? "";
  } catch {
    return "";
  }
}

export const generateText = action({
  args: {
    prompt: v.string(),
    systemPrompt: v.optional(v.string()),
    model: v.optional(v.string()),
    previousResponseId: v.optional(v.string()),
    reasoning: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    temperature: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { text: "", responseId: "" };
    }
    const model = args.model ?? "gpt-4o";
    const isReasoning = isReasoningModel(model);

    const input: Array<Record<string, unknown>> = [];
    if (args.systemPrompt) {
      if (isReasoning) {
        input.push({
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: args.systemPrompt }],
        });
      } else {
        input.push({
          type: "message",
          role: "system",
          content: [{ type: "input_text", text: args.systemPrompt }],
        });
      }
    }
    input.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: args.prompt }],
    });

    const body: Record<string, unknown> = {
      model,
      input,
    };
    if (args.previousResponseId) {
      body.previous_response_id = args.previousResponseId;
    }
    if (!isReasoning && args.temperature != null) {
      body.temperature = args.temperature;
    }
    if (isReasoning && args.reasoning) {
      body.reasoning = { effort: args.reasoning };
    }

    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("OpenAI Responses API error:", res.status, errText);
        return { text: "", responseId: "" };
      }
      const data = (await res.json()) as {
        id?: string;
        output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      };
      const text = extractText(data);
      const responseId = data.id ?? "";
      return { text, responseId };
    } catch (e) {
      console.error("OpenAI request failed:", e);
      return { text: "", responseId: "" };
    }
  },
});

/** Optional Whisper transcription (inspector mic); requires OPENAI_API_KEY on Convex. */
export const transcribeAudio = action({
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
