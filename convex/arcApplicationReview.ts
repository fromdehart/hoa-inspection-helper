import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  fallbackFeedbackFromRaw,
  parseArcReviewResponse,
  type ArcReviewFeedback,
} from "./lib/arcReviewJson";

const MAX_REF_CHARS = 36_000;
const MAX_APP_CHARS = 54_000;
const AI_MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT = `You are an assistant to an HOA Architecture Review Committee (ARC). You compare a homeowner's modification application to the HOA's reference materials (rules, guidelines, and example decisions).

Rules:
- You do not make binding legal or board decisions; you summarize alignment and gaps for staff review.
- Use only the reference excerpts and application text provided in the user message. If something is not stated there, say so rather than inventing rules.
- Output ONLY valid JSON (no markdown fences, no commentary outside JSON) with this exact shape:
{
  "verdict": "likelyApproved" | "needsMoreInformation" | "likelyDenied" | "uncertain",
  "mustHaveNow": string[],
  "helpfulButOptional": string[],
  "rationale": string,
  "citationsToRules": string[]
}
- verdict guidance: likelyApproved if the application appears complete and consistent with stated rules; needsMoreInformation if required details are missing; likelyDenied if the proposal clearly conflicts with stated rules; uncertain if the materials are insufficient to tell.
- put only clearly required blockers in mustHaveNow.
- put nice-to-have or context-dependent improvements in helpfulButOptional.
- do not escalate to expensive engineering artifacts (site surveys, drainage studies, etc.) unless the references clearly require them for this specific project scope.
- citationsToRules: short quotes or paraphrased rule labels drawn from the reference section only.`;

function buildLabeledSection(title: string, body: string, maxChars: number): { text: string; truncated: boolean } {
  const header = `### ${title}\n\n`;
  const budget = maxChars - header.length;
  if (budget < 200) {
    return { text: header + "[... omitted: not enough space ...]", truncated: true };
  }
  let truncated = false;
  let t = body;
  if (t.length > budget) {
    t = t.slice(0, budget) + "\n[... truncated ...]";
    truncated = true;
  }
  return { text: header + t, truncated };
}

function buildCorpus(
  parts: { title: string; body: string }[],
  maxTotal: number,
): { text: string; truncated: boolean } {
  let truncated = false;
  const out: string[] = [];
  let remaining = maxTotal;
  for (const p of parts) {
    const { text, truncated: t } = buildLabeledSection(p.title, p.body, remaining);
    truncated ||= t;
    out.push(text);
    remaining -= text.length;
    if (remaining < 500) break;
  }
  return { text: out.join("\n\n---\n\n"), truncated };
}

export const runReview = action({
  args: { submissionId: v.id("arcApplicationSubmissions") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const viewer = await ctx.runQuery(api.tenancy.viewerContext, {});
    if (!viewer || viewer.role !== "admin") {
      return { ok: false, error: "Admin access required." };
    }

    const submission = await ctx.runQuery(api.arcApplications.get, { id: args.submissionId });
    if (!submission) {
      return { ok: false, error: "Submission not found." };
    }

    const property = await ctx.runQuery(api.properties.get, { id: submission.propertyId });
    if (!property) {
      return { ok: false, error: "Property not found." };
    }

    const combinedAppText = submission.files.map((f) => f.parsedText).join("\n\n").trim();
    if (!combinedAppText) {
      return { ok: false, error: "No extracted text in this submission. Re-upload PDFs as text-based files or DOCX." };
    }

    const refDocs = await ctx.runQuery(api.arcReferenceDocs.list, {});
    const refParts = (refDocs ?? []).map((d) => ({
      title: `Reference: ${d.title}`,
      body: d.parsedText,
    }));
    const refCorpus =
      refParts.length > 0
        ? buildCorpus(refParts, MAX_REF_CHARS)
        : {
            text: "### Reference library\n\n(No ARC reference documents uploaded for this HOA yet. Base your verdict mainly on completeness of the application.)",
            truncated: false,
          };

    const appParts = submission.files.map((f) => ({
      title: `Application file: ${f.fileName}`,
      body: f.parsedText,
    }));
    const appCorpus = buildCorpus(appParts, MAX_APP_CHARS);
    const reviewSettings = await ctx.runQuery(api.arcReviewSettings.get, {});

    const promptHadTruncation = refCorpus.truncated || appCorpus.truncated;
    const userMessage = `Property address: ${property.address}

## HOA review posture (admin-configured)
Review posture: ${reviewSettings.reviewPosture}
Admin guidance:
${reviewSettings.adminGuidance?.trim() || "(none)"}

Interpretation guidance:
- strict: enforce listed requirements conservatively.
- practical: enforce clear requirements but avoid over-escalating asks for minor work.
- homeownerFriendly: prioritize actionable, low-friction asks and avoid intimidating language.

## HOA reference materials
${refCorpus.text}

## Homeowner application materials
${appCorpus.text}

Return the JSON object now.`;

    await ctx.runMutation(internal.arcApplications.internalSetReviewing, {
      submissionId: args.submissionId,
    });

    const { text: rawText } = await ctx.runAction(api.openai.generateText, {
      systemPrompt: SYSTEM_PROMPT,
      prompt: userMessage,
      model: AI_MODEL,
      textFormatJsonObject: true,
    });

    if (!rawText?.trim()) {
      await ctx.runMutation(internal.arcApplications.internalFailReview, {
        submissionId: args.submissionId,
        aiError:
          "The AI returned no text. Check OPENAI_API_KEY on your Convex deployment and try again.",
      });
      return { ok: false, error: "AI returned empty response." };
    }

    let feedback: ArcReviewFeedback | null = parseArcReviewResponse(rawText);
    if (!feedback) {
      feedback = fallbackFeedbackFromRaw(rawText, "Could not parse JSON from the model.");
    }

    const aiFeedbackJson = JSON.stringify(feedback);
    await ctx.runMutation(internal.arcApplications.internalCompleteReview, {
      submissionId: args.submissionId,
      verdict: feedback.verdict,
      aiFeedbackJson,
      aiModel: AI_MODEL,
      promptHadTruncation,
    });

    return { ok: true };
  },
});
