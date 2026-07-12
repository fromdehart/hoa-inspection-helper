import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * The generic two-pass drafting pipeline (PRD §5, §11.2), shared by every
 * Steward duty that produces prose:
 *
 *   Steward pass   → composes a draft from a deterministic context bundle
 *   code prechecks → caller-supplied, run before spending a Reviewer call
 *   Reviewer pass  → independent verification (same context + draft, never
 *                    the Steward's reasoning); reject-with-reasons feeds a
 *                    bounded retry; exhausted → the caller escalates to the
 *                    Desk as needs_human
 *
 * Callers own the prompts and the persistence; this module owns the loop.
 */

export type DraftResult = {
  /** The approved draft, or null when no attempt survived review. */
  draft: { subject: string; body: string } | null;
  attempts: number;
  /** Reviewer reasons (approval notes or the final rejection). */
  reasons: string;
  /** Resolved model of the last Steward pass (provenance). */
  model: string;
};

export function parseJsonLoose<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

export async function draftWithReview(
  ctx: Pick<ActionCtx, "runAction">,
  opts: {
    stewardSystem: string;
    reviewerSystem: string;
    /** The deterministic context bundle both agents see. */
    context: string;
    /** Cheap code checks on a draft; return a failure reason or null. */
    precheck?: (draft: { subject: string; body: string }) => string | null;
    maxAttempts?: number;
    temperature?: number;
  },
): Promise<DraftResult> {
  const maxAttempts = opts.maxAttempts ?? 2;
  let attempts = 0;
  let rejectionFeedback = "";
  let lastReasons = "";
  let model = "";

  while (attempts < maxAttempts) {
    attempts += 1;

    const stewardRes = await ctx.runAction(internal.llm.generateText, {
      role: "steward",
      systemPrompt: opts.stewardSystem,
      prompt:
        opts.context +
        (rejectionFeedback
          ? `\n\nYour previous draft was rejected by review for these reasons — fix them:\n${rejectionFeedback}`
          : "") +
        "\n\nWrite the JSON now.",
      temperature: opts.temperature ?? 0.4,
      textFormatJsonObject: true,
    });
    model = stewardRes.model;
    const draft = parseJsonLoose<{ subject: string; body: string }>(stewardRes.text);
    if (!draft?.subject || !draft?.body) {
      lastReasons = "Steward returned unparseable output";
      rejectionFeedback = "Output was not valid JSON with subject and body.";
      continue;
    }

    const precheckFailure = opts.precheck?.(draft) ?? null;
    if (precheckFailure) {
      lastReasons = `precheck: ${precheckFailure}`;
      rejectionFeedback = precheckFailure;
      continue;
    }

    const reviewRes = await ctx.runAction(internal.llm.generateText, {
      role: "reviewer",
      systemPrompt: opts.reviewerSystem,
      prompt: `CONTEXT:\n${opts.context}\n\nDRAFT SUBJECT: ${draft.subject}\n\nDRAFT BODY:\n${draft.body}\n\nReturn the JSON verdict now.`,
      temperature: 0,
      textFormatJsonObject: true,
    });
    const review = parseJsonLoose<{ verdict: string; reasons?: string[] }>(reviewRes.text);
    if (review?.verdict === "approve") {
      return { draft, attempts, reasons: (review.reasons ?? []).join("; "), model };
    }
    lastReasons = (review?.reasons ?? ["Reviewer returned no verdict"]).join("; ");
    rejectionFeedback = lastReasons;
  }

  return { draft: null, attempts, reasons: lastReasons, model };
}
