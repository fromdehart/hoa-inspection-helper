import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";
import { isFeatureEnabled } from "./lib/featureFlags";
import { logCaseEvent } from "./lib/caseEvents";
import { findOpenViolationCase, openCaseInternal } from "./cases";
import { normalizeEmail } from "./lib/homeownerAuth";

/**
 * Email intake: cc/forward an email to the per-HOA intake address and an AI
 * pipeline builds the case record. HARD SAFETY CEILING: email can only ADD
 * information (open a case, append an emailReceived event). It can never
 * advance a stage, send a notice, or record a hearing/fine — those stay
 * human-only in the app.
 *
 * Address scheme: cases-<hoaSlug>@<INBOUND_DOMAIN>, with an optional case
 * token via plus-addressing: cases-<hoaSlug>+<caseId>@<INBOUND_DOMAIN>.
 * Unknown senders are quarantined (never silently dropped, never processed).
 */

const INTAKE_PREFIX = "cases-";
const AI_MODEL = "gpt-4o-mini";
const MAX_BODY_CHARS = 20_000;

export function parseIntakeAddress(to: string): { hoaSlug: string; caseToken?: string } | null {
  const email = normalizeEmail(to);
  const localPart = email.split("@")[0] ?? "";
  if (!localPart.startsWith(INTAKE_PREFIX)) return null;
  const rest = localPart.slice(INTAKE_PREFIX.length);
  const plus = rest.indexOf("+");
  if (plus === -1) return { hoaSlug: rest };
  return { hoaSlug: rest.slice(0, plus), caseToken: rest.slice(plus + 1) || undefined };
}

/** Store the raw email (idempotent on messageId). Returns null on duplicate. */
export const ingest = internalMutation({
  args: {
    from: v.string(),
    to: v.string(),
    subject: v.string(),
    textBody: v.string(),
    htmlBody: v.optional(v.string()),
    messageId: v.string(),
    inReplyTo: v.optional(v.string()),
    attachmentsMeta: v.optional(
      v.array(v.object({ fileName: v.string(), contentType: v.string(), size: v.number() })),
    ),
  },
  handler: async (ctx, args): Promise<Id<"inboundEmails"> | null> => {
    // Webhook retries are safe: same messageId ⇒ no-op.
    const existing = await ctx.db
      .query("inboundEmails")
      .withIndex("by_message_id", (q) => q.eq("messageId", args.messageId))
      .first();
    if (existing) return null;

    // Resolve HOA from the intake address (best effort; process re-checks).
    let hoaId: Id<"hoas"> | undefined;
    const parsed = parseIntakeAddress(args.to);
    if (parsed) {
      const hoa = await ctx.db
        .query("hoas")
        .withIndex("by_slug", (q) => q.eq("slug", parsed.hoaSlug))
        .first();
      hoaId = hoa?._id;
    }

    return ctx.db.insert("inboundEmails", {
      hoaId,
      from: normalizeEmail(args.from),
      to: args.to,
      subject: args.subject,
      textBody: args.textBody.slice(0, MAX_BODY_CHARS),
      htmlBody: args.htmlBody,
      messageId: args.messageId,
      inReplyTo: args.inReplyTo,
      attachmentsMeta: args.attachmentsMeta,
      status: "received",
      createdAt: Date.now(),
    });
  },
});

/** Everything the processor needs, resolved in one authorized read. */
export const getForProcessing = internalQuery({
  args: { inboundEmailId: v.id("inboundEmails") },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.inboundEmailId);
    if (!email) return null;

    const hoa = email.hoaId ? await ctx.db.get(email.hoaId) : null;
    if (!hoa) return { email, hoa: null } as const;

    const intakeEnabled = await isFeatureEnabled(ctx, hoa._id, "emailIntake");

    // Sender approval: explicit allowlist + implicit (staff, board, homeowner-of-record, company staff).
    const sender = email.from;
    let approved = false;
    let senderPropertyId: Id<"properties"> | undefined;

    const explicit = await ctx.db
      .query("approvedSenders")
      .withIndex("by_hoa_email", (q) => q.eq("hoaId", hoa._id).eq("email", sender))
      .first();
    if (explicit) approved = true;

    if (!approved) {
      const memberships = await ctx.db
        .query("userHoaMemberships")
        .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
        .collect();
      if (memberships.some((m) => m.email && normalizeEmail(m.email) === sender)) approved = true;
    }

    if (!approved) {
      const companyId = hoa.managementCompanyId;
      if (companyId) {
        const staff = await ctx.db
          .query("companyMemberships")
          .withIndex("by_company", (q) => q.eq("companyId", companyId))
          .collect();
        if (staff.some((m) => m.email && normalizeEmail(m.email) === sender)) approved = true;
      }
    }

    // Homeowner of record: match against property emails (also pins the property).
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
      .collect();
    const senderProperty = properties.find(
      (p) => p.email && normalizeEmail(p.email) === sender,
    );
    if (senderProperty) {
      approved = true;
      senderPropertyId = senderProperty._id;
    }

    // Reply-thread routing: does inReplyTo reference a prior intake email on a case?
    let threadCaseId: Id<"cases"> | undefined;
    if (email.inReplyTo) {
      const prior = await ctx.db
        .query("inboundEmails")
        .withIndex("by_message_id", (q) => q.eq("messageId", email.inReplyTo!))
        .first();
      if (prior?.caseId) threadCaseId = prior.caseId;
    }

    return {
      email,
      hoa: { _id: hoa._id, name: hoa.name, slug: hoa.slug },
      intakeEnabled,
      approved,
      senderPropertyId,
      threadCaseId,
      addressBook: properties.map((p) => ({ propertyId: p._id, address: p.address })),
    } as const;
  },
});

export const markStatus = internalMutation({
  args: {
    inboundEmailId: v.id("inboundEmails"),
    status: v.union(
      v.literal("processed"),
      v.literal("quarantined"),
      v.literal("rejected"),
      v.literal("error"),
    ),
    aiSummary: v.optional(v.string()),
    caseId: v.optional(v.id("cases")),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inboundEmailId, {
      status: args.status,
      aiSummary: args.aiSummary,
      caseId: args.caseId,
      propertyId: args.propertyId,
      processedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Apply an email to the case record: attach to an existing case or open a new
 * one. ADD-INFO-ONLY — this is deliberately the only case write email can
 * reach; it never touches stages, notices, hearings, or fines.
 */
export const applyToCase = internalMutation({
  args: {
    inboundEmailId: v.id("inboundEmails"),
    hoaId: v.id("hoas"),
    propertyId: v.id("properties"),
    caseId: v.optional(v.id("cases")),
    summary: v.string(),
    suggestedTitle: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"cases">> => applyToCaseInline(ctx, args),
});

/** Admin + board notification emails for every email-driven change (nothing enters the record unseen). */
export const getNotifyRecipients = internalQuery({
  args: { hoaId: v.id("hoas") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_hoa", (q) => q.eq("hoaId", args.hoaId))
      .collect();
    return memberships
      .filter((m) => (m.role === "admin" || m.role === "board") && m.email)
      .map((m) => m.email as string);
  },
});

export const process = internalAction({
  args: { inboundEmailId: v.id("inboundEmails") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.emailIntake.getForProcessing, {
      inboundEmailId: args.inboundEmailId,
    });
    if (!data) return null;

    const quarantine = async (reason: string) => {
      await ctx.runMutation(internal.emailIntake.markStatus, {
        inboundEmailId: args.inboundEmailId,
        status: "quarantined",
        aiSummary: reason,
      });
      if (data.hoa) {
        await notify(
          data.hoa._id,
          `Quarantined email needs review — ${data.email.subject || "(no subject)"}`,
          `An email from ${data.email.from} was quarantined (${reason}). Review it in the Case Queue under "Needs filing".`,
        );
      }
    };

    const notify = async (hoaId: Id<"hoas">, subject: string, body: string) => {
      const recipients = await ctx.runQuery(internal.emailIntake.getNotifyRecipients, { hoaId });
      for (const to of recipients) {
        await ctx.runAction(internal.resend.sendEmail, {
          to,
          subject: `[Happier Block] ${subject}`,
          html: `<p>${body}</p>`,
        });
      }
    };

    if (!data.hoa) {
      await ctx.runMutation(internal.emailIntake.markStatus, {
        inboundEmailId: args.inboundEmailId,
        status: "rejected",
        aiSummary: "No neighborhood matches the intake address.",
      });
      return null;
    }
    if (!data.intakeEnabled) {
      await quarantine("Email intake is not enabled for this neighborhood");
      return null;
    }
    if (!data.approved) {
      await quarantine("Sender is not on the approved list");
      return null;
    }

    // --- Routing: (1) case token, (2) reply thread, (3) sender's own property, (4) AI address match.
    const parsed = parseIntakeAddress(data.email.to);
    let caseId: Id<"cases"> | undefined;
    let propertyId: Id<"properties"> | undefined = data.senderPropertyId;

    if (parsed?.caseToken) caseId = parsed.caseToken as Id<"cases">;
    if (!caseId && data.threadCaseId) caseId = data.threadCaseId;

    // --- AI extraction (summary + optional property match).
    const addressListing = data.addressBook
      .slice(0, 400)
      .map((p) => `${p.propertyId} :: ${p.address}`)
      .join("\n");
    const { text } = await ctx.runAction(internal.openai.generateText, {
      systemPrompt:
        "You file inbound HOA emails into case records. " +
        'Return STRICT JSON: {"summary": "≤40 word factual summary", "suggestedTitle": "≤8 words", ' +
        '"propertyId": "<id from the list if the email clearly references one property, else null>", ' +
        '"confidence": "high"|"low"}. Never guess a property on weak evidence — use null + low.',
      prompt:
        `Email from: ${data.email.from}\nSubject: ${data.email.subject}\n\nBody:\n${data.email.textBody.slice(0, 12_000)}\n\n` +
        `Known properties (id :: address):\n${addressListing}`,
      model: AI_MODEL,
      temperature: 0.1,
      textFormatJsonObject: true,
    });

    let summary = data.email.subject || "Email received";
    let suggestedTitle: string | undefined;
    try {
      const parsedAi = JSON.parse(text) as {
        summary?: string;
        suggestedTitle?: string;
        propertyId?: string | null;
        confidence?: string;
      };
      if (parsedAi.summary) summary = parsedAi.summary;
      suggestedTitle = parsedAi.suggestedTitle;
      if (!propertyId && !caseId && parsedAi.propertyId && parsedAi.confidence === "high") {
        const match = data.addressBook.find((p) => p.propertyId === parsedAi.propertyId);
        if (match) propertyId = match.propertyId;
      }
    } catch {
      // extraction failed — keep the subject as summary
    }

    // Token/thread routes still need the property from the case itself.
    if (caseId && !propertyId) {
      const applied = await ctx
        .runMutation(internal.emailIntake.applyByCaseId, {
          inboundEmailId: args.inboundEmailId,
          caseId,
          summary,
        })
        .catch(() => null);
      if (applied) {
        await ctx.runMutation(internal.emailIntake.markStatus, {
          inboundEmailId: args.inboundEmailId,
          status: "processed",
          aiSummary: summary,
          caseId: applied.caseId,
          propertyId: applied.propertyId,
        });
        await notify(
          data.hoa._id,
          `Case updated via email — ${data.email.subject || "(no subject)"}`,
          `${data.email.from} added information to a case by email. Summary: ${summary}`,
        );
        return null;
      }
      caseId = undefined; // bad token → fall through
    }

    if (!propertyId) {
      await quarantine("Could not confidently match the email to a property");
      return null;
    }

    const newCaseId = await ctx.runMutation(internal.emailIntake.applyToCase, {
      inboundEmailId: args.inboundEmailId,
      hoaId: data.hoa._id,
      propertyId,
      caseId,
      summary,
      suggestedTitle,
    });
    await ctx.runMutation(internal.emailIntake.markStatus, {
      inboundEmailId: args.inboundEmailId,
      status: "processed",
      aiSummary: summary,
      caseId: newCaseId,
      propertyId,
    });
    await notify(
      data.hoa._id,
      `Case updated via email — ${data.email.subject || "(no subject)"}`,
      `${data.email.from} added information to a case by email. Summary: ${summary}`,
    );
    return null;
  },
});

/** Attach to a specific case id (token/thread route); validates the case exists. */
export const applyByCaseId = internalMutation({
  args: {
    inboundEmailId: v.id("inboundEmails"),
    caseId: v.id("cases"),
    summary: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ caseId: Id<"cases">; propertyId: Id<"properties"> }> => {
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) throw new Error("Case not found for token.");
    const email = await ctx.db.get(args.inboundEmailId);
    if (!email || email.hoaId !== caseDoc.hoaId) throw new Error("Case/HOA mismatch.");

    await logCaseEvent(ctx, {
      hoaId: caseDoc.hoaId,
      caseId: caseDoc._id,
      propertyId: caseDoc.propertyId,
      type: "emailReceived",
      actorRole: "system",
      summary: `Email from ${email.from}: ${args.summary}`,
      visibility: "shared",
      inboundEmailId: args.inboundEmailId,
    });
    await ctx.db.patch(caseDoc._id, { updatedAt: Date.now() });
    return { caseId: caseDoc._id, propertyId: caseDoc.propertyId };
  },
});

// ---------------- Admin surface ----------------

export const listQuarantined = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const rows = await ctx.db
      .query("inboundEmails")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    return rows
      .filter((r) => r.status === "quarantined")
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        _id: r._id,
        from: r.from,
        subject: r.subject,
        textBody: r.textBody.slice(0, 2000),
        aiSummary: r.aiSummary,
        createdAt: r.createdAt,
      }));
  },
});

/** Admin files a quarantined email onto a property (and optionally a case). */
export const fileQuarantined = mutation({
  args: {
    inboundEmailId: v.id("inboundEmails"),
    propertyId: v.id("properties"),
    caseId: v.optional(v.id("cases")),
    alsoApproveSender: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const email = await ctx.db.get(args.inboundEmailId);
    if (!email || email.hoaId !== viewer.hoaId) throw new Error("Email not found.");
    if (email.status !== "quarantined") throw new Error("Only quarantined emails can be filed.");
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.hoaId !== viewer.hoaId) throw new Error("Property not found.");

    // Quarantine reasons live in aiSummary; don't reuse them as the case summary.
    const isReason = !email.aiSummary || /^(Sender|Could not|Email intake)/.test(email.aiSummary);
    const caseId = await applyToCaseInline(ctx, {
      inboundEmailId: args.inboundEmailId,
      hoaId: viewer.hoaId,
      propertyId: args.propertyId,
      caseId: args.caseId,
      summary: isReason ? email.subject || "Email filed by admin" : email.aiSummary!,
      suggestedTitle: email.subject,
    });

    await ctx.db.patch(args.inboundEmailId, {
      status: "processed",
      caseId,
      propertyId: args.propertyId,
      processedAt: Date.now(),
    });

    if (args.alsoApproveSender) {
      const existing = await ctx.db
        .query("approvedSenders")
        .withIndex("by_hoa_email", (q) => q.eq("hoaId", viewer.hoaId).eq("email", email.from))
        .first();
      if (!existing) {
        await ctx.db.insert("approvedSenders", {
          hoaId: viewer.hoaId,
          email: email.from,
          addedByClerkUserId: viewer.clerkUserId,
          createdAt: Date.now(),
        });
      }
    }
    return caseId;
  },
});

/** Shared body of applyToCase usable from a same-file mutation. */
async function applyToCaseInline(
  ctx: MutationCtx,
  args: {
    inboundEmailId: Id<"inboundEmails">;
    hoaId: Id<"hoas">;
    propertyId: Id<"properties">;
    caseId?: Id<"cases">;
    summary: string;
    suggestedTitle?: string;
  },
): Promise<Id<"cases">> {
  const email = await ctx.db.get(args.inboundEmailId);
  if (!email) throw new Error("Inbound email not found.");

  let caseId = args.caseId ?? null;
  if (caseId) {
    const caseDoc = await ctx.db.get(caseId);
    if (!caseDoc || caseDoc.hoaId !== args.hoaId) caseId = null;
  }
  if (!caseId) {
    const open = await findOpenViolationCase(ctx, args.propertyId);
    caseId = open?._id ?? null;
  }
  if (!caseId) {
    caseId = await openCaseInternal(ctx, {
      hoaId: args.hoaId,
      propertyId: args.propertyId,
      caseType: "violation",
      title: args.suggestedTitle?.trim() || email.subject || "Email report",
      source: "email",
      actorRole: "system",
    });
  }
  await logCaseEvent(ctx, {
    hoaId: args.hoaId,
    caseId,
    propertyId: args.propertyId,
    type: "emailReceived",
    actorRole: "system",
    summary: `Email from ${email.from}: ${args.summary}`,
    visibility: "shared",
    inboundEmailId: args.inboundEmailId,
  });
  await ctx.db.patch(caseId, { updatedAt: Date.now() });
  return caseId;
}

export const rejectQuarantined = mutation({
  args: { inboundEmailId: v.id("inboundEmails") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const email = await ctx.db.get(args.inboundEmailId);
    if (!email || email.hoaId !== viewer.hoaId) throw new Error("Email not found.");
    await ctx.db.patch(args.inboundEmailId, { status: "rejected", processedAt: Date.now() });
    return null;
  },
});

export const listApprovedSenders = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const rows = await ctx.db
      .query("approvedSenders")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    return rows.sort((a, b) => a.email.localeCompare(b.email));
  },
});

export const approveSender = mutation({
  args: { email: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const email = normalizeEmail(args.email);
    if (!email.includes("@")) throw new Error("Enter a valid email address.");
    const existing = await ctx.db
      .query("approvedSenders")
      .withIndex("by_hoa_email", (q) => q.eq("hoaId", viewer.hoaId).eq("email", email))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("approvedSenders", {
      hoaId: viewer.hoaId,
      email,
      label: args.label?.trim() || undefined,
      addedByClerkUserId: viewer.clerkUserId,
      createdAt: Date.now(),
    });
  },
});

export const removeSender = mutation({
  args: { id: v.id("approvedSenders") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin"]);
    const row = await ctx.db.get(args.id);
    if (!row || row.hoaId !== viewer.hoaId) throw new Error("Not found.");
    await ctx.db.delete(args.id);
    return null;
  },
});
