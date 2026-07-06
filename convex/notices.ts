import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { logCaseEvent } from "./lib/caseEvents";
import { getOrSeedWorkflow } from "./caseWorkflows";
import { buildLetterHtmlSync, DEFAULT_LETTER_TEMPLATE, escapeHtml } from "./letterBody";

/**
 * Stage notices for cases: generated correspondence with delivery tracking.
 * Reuses the letter template machinery; the recipient city/state/zip comes
 * from the per-HOA aiConfig key "letterCityStateZip" (never hardcoded).
 */

async function getCityStateZip(ctx: QueryCtx, hoaId: Id<"hoas">): Promise<string> {
  const row = await ctx.db
    .query("aiConfig")
    .withIndex("by_hoa_key", (q) => q.eq("hoaId", hoaId).eq("key", "letterCityStateZip"))
    .first();
  return row?.value ?? "";
}

export const generateForStage = mutation({
  args: {
    caseId: v.id("cases"),
    /** Stage this notice belongs to; defaults to the case's current stage. */
    stageKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) throw new Error("Case not found.");
    const property = await ctx.db.get(caseDoc.propertyId);
    if (!property) throw new Error("Property not found.");

    const workflow = await getOrSeedWorkflow(ctx, caseDoc.hoaId, caseDoc.caseType);
    const stageKey = args.stageKey ?? caseDoc.stageKey;
    const stage = workflow.stages.find((s) => s.key === stageKey);
    if (!stage) throw new Error("Unknown stage for this workflow.");

    // Letter body: HOA letter template (or default) merged with property +
    // case context. The case title/description ride in as the findings text.
    const templateDoc = await ctx.db
      .query("templates")
      .withIndex("by_hoa_type", (q) => q.eq("hoaId", caseDoc.hoaId).eq("type", "letter"))
      .first();
    const cityStateZip = await getCityStateZip(ctx, caseDoc.hoaId);

    const findings = [caseDoc.title, caseDoc.description].filter(Boolean).join("\n");
    const dueLine = stage.dueInDays
      ? `Please respond or resolve within ${stage.dueInDays} days of this notice.`
      : "";

    let html = buildLetterHtmlSync({
      templateContent: templateDoc?.content ?? DEFAULT_LETTER_TEMPLATE,
      property: {
        address: property.address,
        accessToken: property.accessToken,
        recipientName: property.homeownerNames?.trim() || "Homeowner",
        recipientStreet: property.address,
        recipientCityStateZip: cityStateZip,
        previousFrontObs: property.previousFrontObs,
        previousBackObs: property.previousBackObs,
        previousInspectorComments: property.previousInspectorComments,
        previousInspectionSummary: property.previousInspectionSummary,
        previousCitations2024: property.previousCitations2024,
      },
      publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:5173",
      inspectorFindingsPlain: findings,
      maintenanceItemsPlain: property.aiLetterBullets?.trim() || "",
    });
    // Stage banner so each notice names its step in the process.
    html =
      `<p style="font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;">` +
      `${escapeHtml(stage.label)}${dueLine ? ` — ${escapeHtml(dueLine)}` : ""}</p>` +
      html;

    const noticeId = await ctx.db.insert("notices", {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      stageKey: stage.key,
      templateKey: stage.noticeTemplateKey,
      html,
      channel: "email",
      deliveryStatus: "draft",
      createdByClerkUserId: viewer.clerkUserId,
      createdAt: Date.now(),
    });

    await logCaseEvent(ctx, {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      type: "noticeGenerated",
      actorRole: "admin",
      actorClerkUserId: viewer.clerkUserId,
      summary: `${stage.label} notice generated`,
      visibility: "shared",
      noticeId,
    });
    return noticeId;
  },
});

export const listForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc || caseDoc.hoaId !== viewer.hoaId) return [];
    const notices = await ctx.db
      .query("notices")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
    return notices
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ html, ...rest }) => ({ ...rest, hasHtml: html.length > 0 }));
  },
});

export const getHtml = query({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "inspector"]);
    const notice = await ctx.db.get(args.noticeId);
    if (!notice || notice.hoaId !== viewer.hoaId) return null;
    return { html: notice.html };
  },
});

export const getInternal = internalQuery({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, args) => ctx.db.get(args.noticeId),
});

/**
 * Reply-to loop-back: when email intake is on, replies to a notice land on the
 * case automatically via cases-<hoaSlug>+<caseId>@<INBOUND_DOMAIN>.
 */
export const getReplyToForCase = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<string | undefined> => {
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) return undefined;
    const hoa = await ctx.db.get(caseDoc.hoaId);
    if (!hoa?.featureFlags?.includes("emailIntake")) return undefined;
    const domain = process.env.INBOUND_EMAIL_DOMAIN;
    if (!domain) return undefined;
    return `cases-${hoa.slug}+${caseDoc._id}@${domain}`;
  },
});

export const markSent = internalMutation({
  args: {
    noticeId: v.id("notices"),
    success: v.boolean(),
    actorClerkUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const notice = await ctx.db.get(args.noticeId);
    if (!notice) throw new Error("Notice not found.");
    if (!args.success) {
      await ctx.db.patch(args.noticeId, { deliveryStatus: "failed" });
      return null;
    }
    await ctx.db.patch(args.noticeId, {
      deliveryStatus: "sent",
      sentAt: Date.now(),
    });
    const caseDoc = await ctx.db.get(notice.caseId);
    if (caseDoc) {
      await logCaseEvent(ctx, {
        hoaId: notice.hoaId,
        caseId: notice.caseId,
        propertyId: notice.propertyId,
        type: "noticeSent",
        actorRole: args.actorClerkUserId ? "admin" : "system",
        actorClerkUserId: args.actorClerkUserId,
        summary: "Notice emailed to homeowner",
        visibility: "shared",
        noticeId: notice._id,
      });
      await ctx.db.patch(caseDoc._id, { updatedAt: Date.now() });
    }
    return null;
  },
});

export const send = action({
  args: { noticeId: v.id("notices") },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const viewer = await ctx.runQuery(api.tenancy.viewerContext, {});
    if (!viewer || viewer.role !== "admin") {
      return { success: false, error: "Admin access is required to send notices." };
    }
    const notice = await ctx.runQuery(internal.notices.getInternal, { noticeId: args.noticeId });
    if (!notice || notice.hoaId !== viewer.hoaId) {
      return { success: false, error: "Notice not found." };
    }
    if (notice.deliveryStatus !== "draft" && notice.deliveryStatus !== "failed") {
      return { success: false, error: "Notice was already sent." };
    }
    const property = await ctx.runQuery(api.properties.get, { id: notice.propertyId });
    if (!property?.email) {
      return { success: false, error: "No homeowner email on record." };
    }
    const replyTo = await ctx.runQuery(internal.notices.getReplyToForCase, {
      caseId: notice.caseId,
    });
    const result = await ctx.runAction(internal.resend.sendEmail, {
      to: property.email,
      subject: `HOA Notice — ${property.address}`,
      html: notice.html,
      replyTo,
    });
    await ctx.runMutation(internal.notices.markSent, {
      noticeId: args.noticeId,
      success: result.success,
      actorClerkUserId: viewer.clerkUserId,
    });
    return result;
  },
});
