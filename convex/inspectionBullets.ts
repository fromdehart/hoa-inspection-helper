import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { LETTER_BULLET_FEW_SHOT_BLOCK } from "./lib/letterBulletFewShot";

const SYSTEM_PROMPT = `You are an editor for an HOA exterior inspection program.

Output rules:
- Return ONLY a markdown bullet list: one issue per line, each line starting with "- ".
- Neutral, professional, concise wording (like formal letters to homeowners).
- Merge duplicate or near-duplicate observations.
- If the raw text clearly indicates there are no exterior issues, output exactly: - No exterior items to cite for this inspection.
- No preamble, no closing paragraph, no numbering other than "- " bullets.

${LETTER_BULLET_FEW_SHOT_BLOCK}`;

export const generateFromInspectorNotes = action({
  args: { propertyId: v.id("properties") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const viewer = await ctx.runQuery(api.tenancy.viewerContext, {});
    if (!viewer || (viewer.role !== "admin" && viewer.role !== "inspector")) {
      return { ok: false, error: "Inspector or admin access required" };
    }
    const property = await ctx.runQuery(api.properties.get, { id: args.propertyId });
    if (!property) {
      return { ok: false, error: "Property not found" };
    }
    const raw = property.inspectorNotes?.trim() ?? "";
    if (!raw) {
      return { ok: false, error: "No inspector notes to process" };
    }

    const prompt = `Property address: ${property.address}

Raw field notes from the inspector (labeled Front / Side / Back when provided; may include speech-to-text noise):
${raw}

Produce the bullet list now.`;

    const { text } = await ctx.runAction(api.openai.generateText, {
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      model: "gpt-4o-mini",
      temperature: 0.25,
    });

    const trimmed = text?.trim() ?? "";
    if (!trimmed) {
      return { ok: false, error: "AI returned empty text (check OPENAI_API_KEY on Convex)" };
    }

    await ctx.runMutation(internal.properties.patchAiLetterBullets, {
      id: args.propertyId,
      aiLetterBullets: trimmed,
    });

    return { ok: true };
  },
});
