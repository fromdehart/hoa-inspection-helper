import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";

const FALLBACK_TEMPLATE = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2>HOA Inspection Notice</h2>
  <p>Date: {{date}}</p>
  <p>Property: {{address}}</p>
  <h3>Violations Found</h3>
  {{violations}}
  <p>Please submit proof of corrections at: {{portalLink}}</p>
  <p>Thank you for your cooperation.</p>
</div>`;

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

    if (openViolations.length === 0) {
      return { html: "<p>No open violations found for this property.</p>" };
    }

    const templateDoc = await ctx.runQuery(api.templates.get, { type: "letter" });
    const templateContent = templateDoc?.content ?? FALLBACK_TEMPLATE;

    const violationListText = openViolations
      .map((v, i) => `${i + 1}. [${v.severity?.toUpperCase() ?? "N/A"}] ${v.description}`)
      .join("\n");

    let formalViolations = violationListText;
    try {
      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "user",
              content: `Rewrite the following HOA violations as formal, concise paragraphs for an official letter. Use professional language. Violations:\n${violationListText}`,
            },
          ],
          max_tokens: 800,
        }),
      });
      const aiData = await aiResponse.json();
      const aiText = aiData.choices?.[0]?.message?.content;
      if (aiText) {
        formalViolations = aiText
          .split("\n\n")
          .filter(Boolean)
          .map((p: string) => `<p>${p}</p>`)
          .join("\n");
      }
    } catch (err) {
      console.error("Letter AI generation error:", err);
      formalViolations = openViolations.map((v) => `<p>${v.description}</p>`).join("\n");
    }

    const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:5173";
    const portalLink = `${PUBLIC_BASE_URL}/portal/${property.accessToken}`;
    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const html = templateContent
      .replace(/\{\{address\}\}/g, property.address)
      .replace(/\{\{violations\}\}/g, formalViolations)
      .replace(
        /\{\{portalLink\}\}/g,
        `<a href="${portalLink}">${portalLink}</a>`,
      )
      .replace(/\{\{date\}\}/g, dateStr);

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
