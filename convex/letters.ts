import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { mergeTokenTemplateTextToHtml, mergeUploadedTemplateToHtml } from "./templateRender";

export const generate = action({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args): Promise<{ html: string }> => {
    const property = await ctx.runQuery(internal.properties.getInternal, { id: args.propertyId });
    if (!property) {
      return { html: "<p>Property not found.</p>" };
    }

    const uploadedTemplate =
      (await ctx.runQuery(api.letterTemplateDocs.getActive, {})) ??
      (await ctx.runQuery(api.letterTemplateDocs.list, {}))[0];
    const maintenanceItemsPlain = property.aiLetterBullets?.trim() || "";
    const maintenanceItems = maintenanceItemsPlain
      .split("\n")
      .map((x) => x.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);
    const date = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    if (!uploadedTemplate) {
      return {
        html: "<p>No uploaded template found. Go to Settings and upload a DOCX or PDF template.</p>",
      };
    }
    const html = uploadedTemplate.templateText?.trim()
      ? mergeTokenTemplateTextToHtml(uploadedTemplate.templateText, {
          date,
          recipientName: property.homeownerNames?.trim() || "Homeowner",
          recipientStreet: property.address,
          recipientCityStateZip: "Fairfax, VA 22030",
          maintenanceItems,
        })
      : mergeUploadedTemplateToHtml(uploadedTemplate, {
      date,
      recipientName: property.homeownerNames?.trim() || "Homeowner",
      recipientStreet: property.address,
      recipientCityStateZip: "Fairfax, VA 22030",
      maintenanceItems,
    });
    return { html };
  },
});

export const send = action({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const property = await ctx.runQuery(api.properties.get, { id: args.propertyId });
    if (!property?.email) {
      return { success: false, error: "No homeowner email on record" };
    }
    if (!property.generatedLetterHtml?.trim()) {
      return { success: false, error: "No generated letter found. Generate the letter first." };
    }
    const result = await ctx.runAction(api.resend.sendEmail, {
      to: property.email,
      subject: `HOA Inspection Notice — ${property.address}`,
      html: property.generatedLetterHtml,
    });
    if (result.success) {
      await ctx.runMutation(internal.properties.markLetterSent, { id: args.propertyId });
    }
    return result;
  },
});
