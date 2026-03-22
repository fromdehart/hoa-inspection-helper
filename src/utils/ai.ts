import { convex } from "@/lib/convexClient";
import { api } from "../../convex/_generated/api";

export type GenerateTextOptions = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  previousResponseId?: string;
  reasoning?: "low" | "medium" | "high";
  temperature?: number;
};

export type GenerateTextResult = { text: string; responseId: string };

export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const result = await convex.action(api.openai.generateText, {
    prompt: options.prompt,
    systemPrompt: options.systemPrompt,
    model: options.model,
    previousResponseId: options.previousResponseId,
    reasoning: options.reasoning,
    temperature: options.temperature,
  });
  return { text: result.text ?? "", responseId: result.responseId ?? "" };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function streamText(
  options: GenerateTextOptions,
  onChunk: (chunk: string) => void
): Promise<GenerateTextResult> {
  const { text, responseId } = await generateText(options);
  const words = text.split(/(\s+)/);
  for (const word of words) {
    await delay(25);
    onChunk(word);
  }
  return { text, responseId };
}

export function isReasoningModel(model: string): boolean {
  return /^(o1|o3|o4)/.test(model);
}
