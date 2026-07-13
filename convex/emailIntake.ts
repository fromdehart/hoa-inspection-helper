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
import { effectiveAutonomy } from "./lib/stewardAutonomy";
import { draftWithReview } from "./lib/stewardPipeline";

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

    const memberships = await ctx.db
      .query("userHoaMemberships")
      .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
      .collect();
    const senderMembership = memberships.find(
      (m) => m.email && normalizeEmail(m.email) === sender,
    );
    if (senderMembership) approved = true;

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

    // Open (unverified/escalated) deadlines for the evidence-matching Watch hook.
    const openDeadlines = await ctx.db
      .query("deadlines")
      .withIndex("by_hoa_due", (q) => q.eq("hoaId", hoa._id))
      .collect();

    // Steward context: reply drafting + concurrence capture (both flag-gated).
    const stewardEnabled = await isFeatureEnabled(ctx, hoa._id, "steward");
    const stewardConfig = stewardEnabled
      ? await ctx.db
          .query("stewardConfig")
          .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
          .first()
      : null;
    const openMotions = stewardEnabled
      ? await ctx.db
          .query("motions")
          .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoa._id).eq("status", "open"))
          .collect()
      : [];

    return {
      email,
      hoa: { _id: hoa._id, name: hoa.name, slug: hoa.slug },
      intakeEnabled,
      approved,
      senderPropertyId,
      threadCaseId,
      addressBook: properties.map((p) => ({ propertyId: p._id, address: p.address })),
      stewardEnabled,
      stewardAutonomy: stewardConfig?.autonomy,
      senderMembership: senderMembership
        ? { clerkUserId: senderMembership.clerkUserId, role: senderMembership.role }
        : null,
      openMotions: openMotions.map((m) => ({ _id: m._id, title: m.title })),
      openDeadlines: openDeadlines
        .filter((d) => d.verificationState !== "verified")
        .map((d) => ({ _id: d._id, title: d.title })),
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
    category: v.optional(v.string()),
    caseId: v.optional(v.id("cases")),
    propertyId: v.optional(v.id("properties")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.inboundEmailId, {
      status: args.status,
      aiSummary: args.aiSummary,
      category: args.category,
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
    category: v.optional(v.string()),
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

    // --- AI triage: summary, property match, and CATEGORY (PRD §8.3).
    const addressListing = data.addressBook
      .slice(0, 400)
      .map((p) => `${p.propertyId} :: ${p.address}`)
      .join("\n");
    const { text } = await ctx.runAction(internal.llm.generateText, {
      systemPrompt:
        "You triage inbound HOA emails. " +
        'Return STRICT JSON: {"summary": "≤40 word factual summary", "suggestedTitle": "≤8 words", ' +
        '"propertyId": "<id from the list if the email clearly references one property, else null>", ' +
        '"confidence": "high"|"low", ' +
        '"category": "violation"|"arc"|"vendor"|"financial"|"complaint"|"privileged"|"concurrence"|"noise"|"other", ' +
        '"concurrenceVote": "yes"|"no"|null}. ' +
        "Categories: arc = architectural request/application; vendor = contractor quotes/scheduling/invoices; " +
        "financial = statements/accounting/banking; privileged = attorney-client or legal-counsel correspondence; " +
        "concurrence = a board member voting/agreeing/objecting to a pending decision (set concurrenceVote); " +
        "noise = newsletters/automated notices needing no action. " +
        "Never guess a property on weak evidence — use null + low.",
      prompt:
        `Email from: ${data.email.from}\nSubject: ${data.email.subject}\n\nBody:\n${data.email.textBody.slice(0, 12_000)}\n\n` +
        `Known properties (id :: address):\n${addressListing}`,
      role: "intakeTriage",
      temperature: 0.1,
      textFormatJsonObject: true,
    });

    let summary = data.email.subject || "Email received";
    let suggestedTitle: string | undefined;
    let category = "other";
    let concurrenceVote: "yes" | "no" | null = null;
    try {
      const parsedAi = JSON.parse(text) as {
        summary?: string;
        suggestedTitle?: string;
        propertyId?: string | null;
        confidence?: string;
        category?: string;
        concurrenceVote?: string | null;
      };
      if (parsedAi.summary) summary = parsedAi.summary;
      suggestedTitle = parsedAi.suggestedTitle;
      if (parsedAi.category) category = parsedAi.category;
      if (parsedAi.concurrenceVote === "yes" || parsedAi.concurrenceVote === "no") {
        concurrenceVote = parsedAi.concurrenceVote;
      }
      if (!propertyId && !caseId && parsedAi.propertyId && parsedAi.confidence === "high") {
        const match = data.addressBook.find((p) => p.propertyId === parsedAi.propertyId);
        if (match) propertyId = match.propertyId;
      }
    } catch {
      // extraction failed — keep the subject as summary, category "other"
    }
    // Privileged content: the classifier read the body, but nothing derived
    // from it may persist — redact the stored summary at the source.
    const storedSummary =
      category === "privileged" ? "Privileged correspondence (content withheld)" : summary;

    // --- Concurrence capture (PRD §8.4): a board/admin member voting by email.
    if (
      category === "concurrence" &&
      data.stewardEnabled &&
      data.senderMembership &&
      data.senderMembership.role !== "inspector" &&
      !caseId
    ) {
      if (data.openMotions.length === 1 && concurrenceVote) {
        const level = effectiveAutonomy("record_concurrence", data.stewardAutonomy);
        if (level !== "L0") {
          const motion = data.openMotions[0];
          await ctx.runMutation(internal.stewardChase.recordProposal, {
            hoaId: data.hoa._id,
            actionType: "record_concurrence",
            duty: "triage",
            trigger: "email:intake",
            inboundEmailId: args.inboundEmailId,
            motionId: motion._id,
            concurrenceClerkUserId: data.senderMembership.clerkUserId,
            concurrenceVote,
            autonomyLevel: level,
            draftSubject: `Record ${concurrenceVote.toUpperCase()} vote on "${motion.title}"`,
            draftBody: `${data.email.from} emailed a ${concurrenceVote} concurrence on the open motion "${motion.title}". Approving records it as an evidence-linked vote.`,
            contextSummary: `Email subject: ${data.email.subject}\nSummary: ${summary}`,
            reviewerVerdict: "approved",
            attempts: 1,
            needsHuman: false,
            model: "deterministic",
          });
        }
      } else if (data.openMotions.length > 1) {
        await ctx.runMutation(internal.steward.createEventFinding, {
          hoaId: data.hoa._id,
          kind: "concurrence_needs_match",
          dedupeKey: `concurrence_needs_match:${args.inboundEmailId}`,
          title: `${data.email.from} emailed a concurrence — link it to the right motion`,
          inboundEmailId: args.inboundEmailId,
        });
      }
      await ctx.runMutation(internal.emailIntake.markStatus, {
        inboundEmailId: args.inboundEmailId,
        status: "processed",
        aiSummary: storedSummary,
        category,
      });
      return null;
    }

    // --- Watch duty (Phase 3a): does this email plausibly verify an open
    // compliance deadline? Deterministic keyword overlap — the human decides.
    const haystack = `${data.email.subject} ${summary}`.toLowerCase();
    for (const d of data.openDeadlines) {
      const words = d.title.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
      const hits = words.filter((w) => haystack.includes(w)).length;
      if (hits >= 2) {
        await ctx.runMutation(internal.steward.createEventFinding, {
          hoaId: data.hoa._id,
          kind: "deadline_evidence_maybe",
          dedupeKey: `deadline_evidence_maybe:${d._id}:${args.inboundEmailId}`,
          title: `Email may verify "${d.title}" — attach it as evidence?`,
          inboundEmailId: args.inboundEmailId,
        });
      }
    }

    // --- Financial packet review (Phase 4a): every financial email produces
    // the recurring-checks checklist finding; the treasurer reviews from a
    // list, not a blank stare.
    if (category === "financial" && data.stewardEnabled) {
      await ctx.runMutation(internal.steward.createEventFinding, {
        hoaId: data.hoa._id,
        kind: "financial_packet_review",
        dedupeKey: `financial_packet_review:${args.inboundEmailId}`,
        title: `Financial mail: "${data.email.subject || "(no subject)"}" — run the checks`,
        detail:
          "Recurring checks: reserve auto-transfer recorded? · estimated taxes on schedule? · " +
          "unexplained fees (returned-check class)? · substitute/replacement reports? · new payees?",
        inboundEmailId: args.inboundEmailId,
      });
      const level = effectiveAutonomy("financial_questions", data.stewardAutonomy);
      if (level !== "L0") {
        try {
          const result = await draftWithReview(ctx, {
            stewardSystem: FINANCIAL_STEWARD_SYSTEM,
            reviewerSystem: FINANCIAL_REVIEWER_SYSTEM,
            context:
              `HOA: ${data.hoa.name}\nFrom: ${data.email.from}\nSubject: ${data.email.subject}\n\n` +
              `Email body (excerpt):\n${data.email.textBody.slice(0, 6_000)}`,
            precheck: (draft) => {
              const words = draft.body.trim().split(/\s+/).length;
              return words < 20 || words > 220 ? `body is ${words} words (expected 30-200)` : null;
            },
          });
          if (result.draft) {
            await ctx.runMutation(internal.stewardChase.recordProposal, {
              hoaId: data.hoa._id,
              actionType: "financial_questions",
              duty: "review",
              trigger: "email:intake",
              inboundEmailId: args.inboundEmailId,
              autonomyLevel: level,
              draftSubject: result.draft.subject,
              draftBody: result.draft.body,
              contextSummary: `Questions about: ${data.email.subject}`,
              reviewerVerdict: "approved",
              verdictReasons: result.reasons || undefined,
              attempts: result.attempts,
              needsHuman: false,
              model: result.model,
            });
          }
        } catch (e) {
          console.error("financial questions draft failed", e);
        }
      }
    }

    // --- Noise: classified as needing no action, and nothing routed it to a
    // case. Filed as processed with no record touched (still auditable on the
    // inboundEmails table).
    if (category === "noise" && !caseId) {
      await ctx.runMutation(internal.emailIntake.markStatus, {
        inboundEmailId: args.inboundEmailId,
        status: "processed",
        aiSummary: storedSummary,
        category,
      });
      return null;
    }

    // Token/thread routes still need the property from the case itself.
    if (caseId && !propertyId) {
      const applied = await ctx
        .runMutation(internal.emailIntake.applyByCaseId, {
          inboundEmailId: args.inboundEmailId,
          caseId,
          summary: storedSummary,
        })
        .catch(() => null);
      if (applied) {
        await ctx.runMutation(internal.emailIntake.markStatus, {
          inboundEmailId: args.inboundEmailId,
          status: "processed",
          aiSummary: storedSummary,
          category,
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
      category,
    });
    await ctx.runMutation(internal.emailIntake.markStatus, {
      inboundEmailId: args.inboundEmailId,
      status: "processed",
      aiSummary: storedSummary,
      category,
      caseId: newCaseId,
      propertyId,
    });
    await notify(
      data.hoa._id,
      `Case updated via email — ${data.email.subject || "(no subject)"}`,
      `${data.email.from} added information to a case by email. Summary: ${storedSummary}`,
    );

    // --- Reply draft (L1, PRD §8.3): acknowledge a homeowner's filed email.
    // Only for homeowners-of-record, never for privileged content, and only
    // when the steward flag is on. A failed review skips silently — a reply
    // is optional, not owed.
    if (
      data.stewardEnabled &&
      data.senderPropertyId === propertyId &&
      (category === "violation" || category === "complaint" || category === "other")
    ) {
      const level = effectiveAutonomy("email_reply", data.stewardAutonomy);
      if (level !== "L0") {
        try {
          const result = await draftWithReview(ctx, {
            stewardSystem: REPLY_STEWARD_SYSTEM.replace("{HOA name}", data.hoa.name),
            reviewerSystem: REPLY_REVIEWER_SYSTEM,
            context:
              `HOA: ${data.hoa.name}\nHomeowner email subject: ${data.email.subject}\n` +
              `Filed summary: ${summary}\nCategory: ${category}`,
            precheck: (draft) => {
              const words = draft.body.trim().split(/\s+/).length;
              return words < 25 || words > 160 ? `body is ${words} words (expected 30-140)` : null;
            },
          });
          if (result.draft) {
            await ctx.runMutation(internal.stewardChase.recordProposal, {
              hoaId: data.hoa._id,
              actionType: "email_reply",
              duty: "triage",
              trigger: "email:intake",
              inboundEmailId: args.inboundEmailId,
              caseId: newCaseId,
              propertyId,
              autonomyLevel: level,
              draftSubject: result.draft.subject,
              draftBody: result.draft.body,
              contextSummary: `Reply to ${data.email.from} re: "${data.email.subject}"\nFiled summary: ${summary}`,
              reviewerVerdict: "approved",
              verdictReasons: result.reasons || undefined,
              attempts: result.attempts,
              needsHuman: false,
              model: result.model,
            });
          }
        } catch (e) {
          console.error("reply draft failed", e);
        }
      }
    }
    return null;
  },
});

const REPLY_STEWARD_SYSTEM = `You are the Steward, the operations agent for a volunteer HOA board.
A homeowner emailed the HOA and their message was filed. Draft a short acknowledgment reply.
Rules:
- Confirm their message was received and is on file with the board.
- Set the expectation that the board will follow up; do NOT promise outcomes, decisions, or dates.
- Use ONLY facts from the context. No legal language, no commitments, no apologies for the issue itself.
- Plain text. Greeting "Hi," and sign-off "Thank you,\nThe {HOA name} Board". 40–100 words.
Return STRICT JSON: {"subject": "...", "body": "..."}`;

const REPLY_REVIEWER_SYSTEM = `You are the Reviewer. Verify an acknowledgment reply to a homeowner before it may proceed. Reject unless ALL hold:
1. It only confirms receipt/filing and that the board will follow up — no outcomes, decisions, dates, or commitments.
2. Every factual claim appears in the context.
3. Courteous, professional; 30–140 words; plain text.
4. No legal language and no personal data beyond what the homeowner themselves raised.
Return STRICT JSON: {"verdict": "approve"|"reject", "reasons": ["..."]}`;

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
    category?: string;
  },
): Promise<Id<"cases">> {
  const email = await ctx.db.get(args.inboundEmailId);
  if (!email) throw new Error("Inbound email not found.");

  // Triage category drives the case type; unmapped categories stay violations
  // (the historical behavior). Privileged content never reaches summaries:
  // the event is redacted at write time so no future drafting context —
  // which reads caseEvents, never raw emails — can leak it (PRD §8.3).
  const privileged = args.category === "privileged";
  const caseType =
    args.category === "arc"
      ? ("architectural" as const)
      : args.category === "complaint"
        ? ("complaint" as const)
        : args.category === "vendor" || args.category === "financial"
          ? ("other" as const)
          : ("violation" as const);

  let caseId = args.caseId ?? null;
  if (caseId) {
    const caseDoc = await ctx.db.get(caseId);
    if (!caseDoc || caseDoc.hoaId !== args.hoaId) caseId = null;
  }
  if (!caseId && caseType === "architectural") {
    const open = await ctx.db
      .query("cases")
      .withIndex("by_hoa_property", (q) =>
        q.eq("hoaId", args.hoaId).eq("propertyId", args.propertyId),
      )
      .collect();
    caseId =
      open.find(
        (c) => c.caseType === "architectural" && c.status !== "resolved" && c.status !== "closed",
      )?._id ?? null;
  }
  if (!caseId && caseType !== "architectural") {
    const open = await findOpenViolationCase(ctx, args.propertyId);
    caseId = open?._id ?? null;
  }
  if (!caseId) {
    caseId = await openCaseInternal(ctx, {
      hoaId: args.hoaId,
      propertyId: args.propertyId,
      caseType,
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
    summary: privileged
      ? `Privileged correspondence from ${email.from} (content withheld — read the original)`
      : `Email from ${email.from}: ${args.summary}`,
    visibility: privileged ? "internal" : "shared",
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

const FINANCIAL_STEWARD_SYSTEM = `You are the Steward, the operations agent for a volunteer HOA board.
A financial email arrived (statement, invoice, accounting note). Draft the treasurer's clarification
email: SHORT, specific QUESTIONS about anything unclear, unusual, or unexplained in the message.
Rules:
- Questions only. No accusations, no conclusions, no numbers that don't appear in the source.
- If nothing needs asking, ask for confirmation of the one or two most consequential facts.
- Plain text. Greeting "Hi," sign-off "Thank you,\nThe Board". 30-180 words.
Return STRICT JSON: {"subject": "...", "body": "..."}`;

const FINANCIAL_REVIEWER_SYSTEM = `You are the Reviewer. Verify a treasurer's clarification email before it may proceed. Reject unless ALL hold:
1. It contains only questions or requests for confirmation — no accusations, judgments, or instructions to move money.
2. Every number or fact referenced appears in the context.
3. Courteous, professional; 30-200 words; plain text.
Return STRICT JSON: {"verdict": "approve"|"reject", "reasons": ["..."]}`;
