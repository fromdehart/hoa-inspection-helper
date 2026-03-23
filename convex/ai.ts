import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const analyzePhoto = internalAction({
  args: { photoId: v.id("photos") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.photos.updateAnalysisStatus, {
      id: args.photoId,
      status: "processing",
    });
    try {
      const photo = await ctx.runQuery(internal.photos.getById, { id: args.photoId });
      if (!photo) return;

      const config = await ctx.runQuery(internal.aiConfig.getAllInternal);

      const promptString = `You are an HOA compliance inspector reviewing a property exterior photo.
Violation Rules: ${config.violationRules || "Standard HOA rules apply."}
Approved Colors: ${config.approvedColors || "No specific color restrictions."}
HOA Guidelines: ${config.hoaGuidelines || "Standard guidelines apply."}

Analyze this photo carefully for any HOA violations. Return a JSON object with a single
key "violations" containing an array of objects. Each object must have:
  - description: string (clear description of the violation)
  - severity: "low" | "medium" | "high"
If there are no violations, return {"violations": []}.`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
              content: [
                { type: "image_url", image_url: { url: photo.publicUrl } },
                { type: "text", text: promptString },
              ],
            },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1000,
        }),
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      const parsed = JSON.parse(content);
      const violations: Array<{ description: string; severity: "low" | "medium" | "high" }> =
        parsed.violations ?? [];

      for (const violation of violations) {
        await ctx.runMutation(internal.violations.create, {
          propertyId: photo.propertyId,
          photoId: args.photoId,
          description: violation.description,
          severity: violation.severity,
        });
      }

      await ctx.runMutation(internal.photos.updateAnalysisStatus, {
        id: args.photoId,
        status: "done",
      });
    } catch (err) {
      console.error("analyzePhoto error:", err);
      await ctx.runMutation(internal.photos.updateAnalysisStatus, {
        id: args.photoId,
        status: "error",
      });
    }
  },
});

export const verifyFix = internalAction({
  args: { fixPhotoId: v.id("fixPhotos") },
  handler: async (ctx, args) => {
    try {
      const fixPhoto = await ctx.runQuery(internal.fixPhotos.getById, { id: args.fixPhotoId });
      if (!fixPhoto) return;

      const contentItems: Array<unknown> = [];
      let violation: { description: string; photoId?: string } | null = null;
      let hasBeforePhoto = false;

      if (fixPhoto.violationId) {
        violation = await ctx.runQuery(internal.violations.getById, { id: fixPhoto.violationId });
        if (violation?.photoId) {
          const beforePhoto = await ctx.runQuery(internal.photos.getById, {
            id: violation.photoId as any,
          });
          if (beforePhoto) {
            contentItems.push({
              type: "image_url",
              image_url: { url: beforePhoto.publicUrl },
            });
            hasBeforePhoto = true;
          }
        }
      }

      contentItems.push({
        type: "image_url",
        image_url: { url: fixPhoto.publicUrl },
      });

      const prompt = `You are verifying an HOA violation fix.
${violation ? `The original violation was: ${violation.description}` : ""}
${hasBeforePhoto ? "The first image is the BEFORE photo showing the violation." : ""}
The ${hasBeforePhoto ? "second" : "only"} image is the AFTER photo submitted by the homeowner.
Return JSON: { "status": "resolved" | "notResolved" | "needsReview", "note": "<brief explanation>" }
- resolved: violation is clearly corrected
- notResolved: violation is clearly still present
- needsReview: ambiguous, poor photo quality, or cannot determine`;

      contentItems.push({ type: "text", text: prompt });

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: contentItems }],
          response_format: { type: "json_object" },
          max_tokens: 500,
        }),
      });

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      const parsed = JSON.parse(content);
      const status: "resolved" | "notResolved" | "needsReview" = parsed.status ?? "needsReview";
      const note: string = parsed.note ?? "";

      await ctx.runMutation(internal.fixPhotos.updateVerification, {
        id: args.fixPhotoId,
        status,
        note,
      });
    } catch (err) {
      console.error("verifyFix error:", err);
      await ctx.runMutation(internal.fixPhotos.updateVerification, {
        id: args.fixPhotoId,
        status: "needsReview",
        note: "AI verification failed; please review manually.",
      });
    }
  },
});
