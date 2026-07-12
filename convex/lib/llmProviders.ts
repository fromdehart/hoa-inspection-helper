/**
 * LLM provider implementations. Providers are plain functions with one shared
 * request/response shape so `convex/llm.ts` can swap them by configuration —
 * adding Anthropic/OpenRouter later means one new function here and a registry
 * entry, zero caller changes (PRD §11.1).
 */

export type LlmRequest = {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  previousResponseId?: string;
  reasoning?: "low" | "medium" | "high";
  /** Ask the provider for a JSON-object response (structured outputs). */
  jsonObject?: boolean;
};

export type LlmResponse = {
  text: string;
  /** Provider conversation handle when supported (OpenAI Responses API); "" otherwise. */
  responseId: string;
};

function isOpenAiReasoningModel(model: string): boolean {
  return /^(o1|o3|o4)/.test(model);
}

/** Extract text from an OpenAI Responses API payload; "" on unexpected shape. */
function extractOpenAiText(response: {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
  try {
    const parts = response.output?.flatMap((o) => o.content ?? []) ?? [];
    return parts
      .filter((c) => c.type === "output_text" && c.text != null)
      .map((c) => c.text as string)
      .join("");
  } catch {
    return "";
  }
}

export async function openaiGenerate(req: LlmRequest): Promise<LlmResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { text: "", responseId: "" };
  }
  const isReasoning = isOpenAiReasoningModel(req.model);

  const input: Array<Record<string, unknown>> = [];
  if (req.systemPrompt) {
    input.push({
      type: "message",
      role: isReasoning ? "developer" : "system",
      content: [{ type: "input_text", text: req.systemPrompt }],
    });
  }
  input.push({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: req.prompt }],
  });

  const body: Record<string, unknown> = { model: req.model, input };
  if (req.jsonObject) {
    body.text = { format: { type: "json_object" } };
  }
  if (req.previousResponseId) {
    body.previous_response_id = req.previousResponseId;
  }
  if (!isReasoning && req.temperature != null) {
    body.temperature = req.temperature;
  }
  if (isReasoning && req.reasoning) {
    body.reasoning = { effort: req.reasoning };
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
    return { text: extractOpenAiText(data), responseId: data.id ?? "" };
  } catch (e) {
    console.error("OpenAI request failed:", e);
    return { text: "", responseId: "" };
  }
}

export type LlmProvider = (req: LlmRequest) => Promise<LlmResponse>;

export const PROVIDERS: Record<string, LlmProvider> = {
  openai: openaiGenerate,
};
