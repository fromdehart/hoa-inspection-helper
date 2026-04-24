import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import {
  buildLetterHtmlSync,
  DEFAULT_LETTER_TEMPLATE,
  escapeHtml,
  paragraphsFromPlainText,
} from "./letterBody";

async function polishLetterBody(rawText: string, mode: "violations" | "notes"): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !rawText.trim()) {
    return mode === "violations"
      ? rawText
          .split("\n")
          .filter(Boolean)
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join("\n")
      : paragraphsFromPlainText(rawText);
  }
  const instruction =
    mode === "violations"
      ? `Rewrite the following HOA violation list as formal, concise HTML paragraphs only (no outer wrapper). Use <p> tags. Content:\n${rawText}`
      : `Rewrite the following inspector field notes as clear, professional HTML paragraphs only (no outer wrapper). Use <p> tags. Preserve all substantive observations:\n${rawText}`;
  try {
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: instruction }],
        max_tokens: 900,
      }),
    });
    const aiData = await aiResponse.json();
    const aiText = aiData.choices?.[0]?.message?.content as string | undefined;
    if (aiText?.trim()) return aiText.trim();
  } catch (err) {
    console.error("Letter polish error:", err);
  }
  return mode === "violations"
    ? rawText
        .split("\n")
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("\n")
    : paragraphsFromPlainText(rawText);
}

export const generate = action({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args): Promise<{ html: string }> => {
    const property = await ctx.runQuery(internal.properties.getInternal, { id: args.propertyId });
    if (!property) {
      return { html: "<p>Property not found.</p>" };
    }

    const allViolations = await ctx.runQuery(api.violations.listByProperty, {
      propertyId: args.propertyId,
    });
    const openViolations = allViolations.filter((v) => v.status === "open");

    const templateDoc = await ctx.runQuery(api.templates.get, { type: "letter" });
    const templateContent = templateDoc?.content ?? DEFAULT_LETTER_TEMPLATE;

    const violationListText = openViolations
      .map((vi, i) => `${i + 1}. [${vi.severity?.toUpperCase() ?? "N/A"}] ${vi.description}`)
      .join("\n");

    const notes = property.inspectorNotes ?? "";
    let slotHtml: string;
    if (openViolations.length > 0) {
      slotHtml = await polishLetterBody(violationListText, "violations");
    } else if (notes.trim()) {
      slotHtml = await polishLetterBody(notes, "notes");
    } else {
      slotHtml = paragraphsFromPlainText("");
    }

    const publicBase = process.env.PUBLIC_BASE_URL ?? "http://localhost:5173";
    const html = buildLetterHtmlSync({
      templateContent,
      property: {
        address: property.address,
        accessToken: property.accessToken,
        inspectorNotes: notes,
        previousFrontObs: property.previousFrontObs,
        previousBackObs: property.previousBackObs,
        previousInspectorComments: property.previousInspectorComments,
        previousInspectionSummary: property.previousInspectionSummary,
        previousCitations2024: property.previousCitations2024,
      },
      publicBaseUrl: publicBase,
      violationsOrFindingsHtml: slotHtml,
    });

    return { html };
  },
});

export const send = action({
  args: { propertyId: v.id("properties"), html: v.string() },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const property = await ctx.runQuery(api.properties.get, { id: args.propertyId });
    if (!property?.email) {
      return { success: false, error: "No homeowner email on record" };
    }
    const result = await ctx.runAction(api.resend.sendEmail, {
      to: property.email,
      subject: `HOA Inspection Notice — ${property.address}`,
      html: args.html,
    });
    if (result.success) {
      await ctx.runMutation(internal.properties.markLetterSent, { id: args.propertyId });
    }
    return result;
  },
});
