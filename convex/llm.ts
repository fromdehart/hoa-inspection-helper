"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { PROVIDERS, type LlmRequest } from "./lib/llmProviders";

/**
 * Provider-swappable LLM entry point (PRD §11.1). Callers reference a model
 * ROLE, never a model string; roles resolve to a provider + model from env:
 *
 *   LLM_PROVIDER            — provider for all roles (default "openai")
 *   LLM_MODEL_<ROLE>        — per-role model override, e.g. LLM_MODEL_STEWARD
 *
 * Defaults below reproduce today's behavior exactly, so migrating a caller
 * from `internal.openai.generateText` to this action is a no-op until someone
 * changes configuration. Switching a role to another provider later is an env
 * change + a provider function in lib/llmProviders.ts — zero caller edits.
 */

export const MODEL_ROLES = {
  /** Inspection notes → letter bullets (also feeds letter generation). */
  bullets: "gpt-4o-mini",
  /** Homeowner portal chatbot. */
  chat: "gpt-4o-mini",
  /** Staff copilot (reactive Q&A / worklist reasons). */
  copilot: "gpt-4o-mini",
  /** ARC application review. */
  arcReview: "gpt-4.1-mini",
  /** Email intake classification/filing. */
  intakeTriage: "gpt-4o-mini",
  /** The Steward — proactive agent passes (drafting, chasing, prep). */
  steward: "gpt-4o",
  /** The Reviewer — verification passes over the Steward's output. */
  reviewer: "gpt-4o-mini",
} as const;

export type ModelRole = keyof typeof MODEL_ROLES;

const ROLE_VALIDATOR = v.union(
  v.literal("bullets"),
  v.literal("chat"),
  v.literal("copilot"),
  v.literal("arcReview"),
  v.literal("intakeTriage"),
  v.literal("steward"),
  v.literal("reviewer"),
);

export function resolveRole(role: ModelRole): { provider: string; model: string } {
  const provider = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();
  const envKey = `LLM_MODEL_${role.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
  const model = process.env[envKey] ?? MODEL_ROLES[role];
  return { provider, model };
}

/**
 * INTERNAL ONLY — reach it through an authenticated wrapper so we never expose
 * an unauthenticated, cost-bearing LLM call. Returns the resolved model so
 * callers that persist provenance (e.g. ARC review) record what actually ran.
 */
export const generateText = internalAction({
  args: {
    role: ROLE_VALIDATOR,
    prompt: v.string(),
    systemPrompt: v.optional(v.string()),
    temperature: v.optional(v.number()),
    previousResponseId: v.optional(v.string()),
    reasoning: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    textFormatJsonObject: v.optional(v.boolean()),
  },
  handler: async (_ctx, args) => {
    const { provider, model } = resolveRole(args.role);
    const impl = PROVIDERS[provider];
    if (!impl) {
      console.error(`Unknown LLM_PROVIDER "${provider}" — falling back to openai.`);
    }
    const req: LlmRequest = {
      model,
      prompt: args.prompt,
      systemPrompt: args.systemPrompt,
      temperature: args.temperature,
      previousResponseId: args.previousResponseId,
      reasoning: args.reasoning,
      jsonObject: args.textFormatJsonObject,
    };
    const res = await (impl ?? PROVIDERS.openai)(req);
    return { ...res, model, provider: impl ? provider : "openai" };
  },
});
