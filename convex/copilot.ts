import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireCompanyMember } from "./lib/companyAuth";
import { checkAndBumpCompanyRateLimit } from "./lib/companyRateLimit";
import { stageLabelFromWorkflow } from "./lib/copilotFormat";

/**
 * Manager AI copilot. Follows the chat.ts triad: public action → auth via
 * internal query → rate-limit mutation → internal.llm.generateText →
 * persist/return. All grounding comes from the manager's own portfolio data +
 * that HOA's parsed governing docs — never from unscoped inputs.
 */

const RATE_LIMIT = { limit: 40, windowMs: 60 * 60 * 1000, label: "copilot" };
const MAX_DOC_CHARS = 24_000;

export const internalCheckRateLimit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) throw new Error("Authentication required.");
    await checkAndBumpCompanyRateLimit(ctx, identity.subject, RATE_LIMIT);
  },
});

/** Portfolio worklist input for the prioritizer (auth enforced inside). */
export const internalWorklistInput = internalQuery({
  args: {},
  handler: async (ctx) => {
    const company = await requireCompanyMember(ctx);
    const hoas = await ctx.db
      .query("hoas")
      .withIndex("by_company", (q) => q.eq("managementCompanyId", company.companyId))
      .collect();
    const activeHoas = hoas.filter((h) => h.status === "active");

    const openStatuses = new Set(["open", "awaitingHomeowner", "escalated"]);
    const rows: Array<{
      caseId: Id<"cases">;
      title: string;
      hoaName: string;
      address: string;
      stageKey: string;
      status: string;
      severity?: string;
      actionDueAt?: number;
      assignedToMe: boolean;
      updatedAt: number;
    }> = [];
    for (const hoa of activeHoas) {
      const cases = await ctx.db
        .query("cases")
        .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
        .collect();
      for (const c of cases) {
        if (!openStatuses.has(c.status)) continue;
        const property = await ctx.db.get(c.propertyId);
        rows.push({
          caseId: c._id,
          title: c.title,
          hoaName: hoa.name,
          address: property?.address ?? "",
          stageKey: c.stageKey,
          status: c.status,
          severity: c.severity,
          actionDueAt: c.actionDueAt,
          assignedToMe: c.assignedToClerkUserId === company.clerkUserId,
          updatedAt: c.updatedAt,
        });
      }
    }
    return rows;
  },
});

/**
 * "Your day": deterministic pre-rank (deadline × severity × assignment), then
 * the LLM writes a one-line "why now" for the top items. Ranking never depends
 * on the model — it only explains.
 */
export const prioritizeDay = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    | { ok: true; items: Array<{ caseId: string; title: string; hoaName: string; address: string; reason: string }> }
    | { ok: false; error: string }
  > => {
    try {
      await ctx.runMutation(internal.copilot.internalCheckRateLimit, {});
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Rate limit reached." };
    }

    const rows = await ctx.runQuery(internal.copilot.internalWorklistInput, {});
    if (rows.length === 0) {
      return { ok: true, items: [] };
    }

    const now = Date.now();
    const severityWeight = (s?: string) => (s === "high" ? 3 : s === "medium" ? 2 : 1);
    const ranked = [...rows]
      .sort((a, b) => {
        const aOverdue = a.actionDueAt !== undefined && a.actionDueAt < now ? 1 : 0;
        const bOverdue = b.actionDueAt !== undefined && b.actionDueAt < now ? 1 : 0;
        if (aOverdue !== bOverdue) return bOverdue - aOverdue;
        const aScore =
          severityWeight(a.severity) + (a.assignedToMe ? 2 : 0) - (a.actionDueAt ?? Infinity) / 1e15;
        const bScore =
          severityWeight(b.severity) + (b.assignedToMe ? 2 : 0) - (b.actionDueAt ?? Infinity) / 1e15;
        if (aScore !== bScore) return bScore - aScore;
        return (a.actionDueAt ?? Infinity) - (b.actionDueAt ?? Infinity);
      })
      .slice(0, 8);

    const listing = ranked
      .map(
        (r, i) =>
          `${i + 1}. [${r.caseId}] "${r.title}" — ${r.hoaName}, ${r.address}; stage ${r.stageKey}; status ${r.status}; severity ${r.severity ?? "unset"}; due ${
            r.actionDueAt ? new Date(r.actionDueAt).toISOString().slice(0, 10) : "none"
          }${r.actionDueAt && r.actionDueAt < now ? " (OVERDUE)" : ""}${r.assignedToMe ? "; assigned to this manager" : ""}`,
      )
      .join("\n");

    const { text } = await ctx.runAction(internal.llm.generateText, {
      systemPrompt:
        "You write one-line action reasons for a community manager's prioritized worklist. " +
        'Return STRICT JSON: {"reasons": [{"caseId": "...", "reason": "..."}]} with one entry per input item, same order. ' +
        "Each reason ≤ 15 words, concrete (mention deadline/severity/stage), no fluff.",
      prompt: `Today is ${new Date(now).toISOString().slice(0, 10)}. Cases, already ranked:\n${listing}`,
      role: "copilot",
      temperature: 0.2,
      textFormatJsonObject: true,
    });

    let reasons = new Map<string, string>();
    try {
      const parsed = JSON.parse(text) as { reasons?: Array<{ caseId?: string; reason?: string }> };
      reasons = new Map(
        (parsed.reasons ?? [])
          .filter((r): r is { caseId: string; reason: string } => !!r.caseId && !!r.reason)
          .map((r) => [r.caseId, r.reason]),
      );
    } catch {
      // fall through — deterministic fallback reasons below
    }

    return {
      ok: true,
      items: ranked.map((r) => ({
        caseId: r.caseId,
        title: r.title,
        hoaName: r.hoaName,
        address: r.address,
        reason:
          reasons.get(r.caseId) ??
          (r.actionDueAt && r.actionDueAt < now
            ? "Past its deadline — act today."
            : r.assignedToMe
              ? "Assigned to you and still open."
              : "Open case needing attention."),
      })),
    };
  },
});

/** Case context for drafting, scope-checked to the manager's portfolio. */
export const internalCaseContext = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    const company = await requireCompanyMember(ctx);
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) throw new Error("Case not found.");
    const hoa = await ctx.db.get(caseDoc.hoaId);
    if (!hoa || hoa.managementCompanyId !== company.companyId) {
      throw new Error("That case is not in your portfolio.");
    }
    const property = await ctx.db.get(caseDoc.propertyId);
    const events = await ctx.db
      .query("caseEvents")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
    const workflow = await ctx.db
      .query("caseWorkflows")
      .withIndex("by_hoa_type", (q) =>
        q.eq("hoaId", caseDoc.hoaId).eq("caseType", caseDoc.caseType),
      )
      .first();
    const docs = await ctx.db
      .query("arcReferenceDocs")
      .withIndex("by_hoa", (q) => q.eq("hoaId", caseDoc.hoaId))
      .collect();

    let docCorpus = "";
    for (const doc of docs) {
      if (docCorpus.length >= MAX_DOC_CHARS) break;
      docCorpus += `\n--- ${doc.title} ---\n${doc.parsedText.slice(0, MAX_DOC_CHARS - docCorpus.length)}`;
    }

    return {
      hoaName: hoa.name,
      caseTitle: caseDoc.title,
      caseType: caseDoc.caseType,
      stageKey: caseDoc.stageKey,
      stageLabel: stageLabelFromWorkflow(workflow, caseDoc.stageKey),
      address: property?.address ?? "",
      homeownerNames: property?.homeownerNames ?? "",
      timeline: events
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(
          (e) =>
            `${new Date(e.createdAt).toISOString().slice(0, 10)} [${e.type}${e.visibility === "internal" ? ", internal" : ""}] ${e.summary}`,
        )
        .join("\n"),
      docCorpus,
    };
  },
});

/** Draft the next stage notice, grounded in the case timeline + the HOA's own rules. */
export const draftStageNotice = action({
  args: { caseId: v.id("cases") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; draft: string } | { ok: false; error: string }> => {
    try {
      await ctx.runMutation(internal.copilot.internalCheckRateLimit, {});
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Rate limit reached." };
    }
    const context = await ctx.runQuery(internal.copilot.internalCaseContext, {
      caseId: args.caseId,
    });

    const { text } = await ctx.runAction(internal.llm.generateText, {
      systemPrompt:
        "You draft HOA notice letters for a community manager to review before sending. " +
        "Professional, firm but neighborly tone. Ground every rule reference in the provided governing documents and cite the section when possible. " +
        "Never invent fines, deadlines, or rules not present in the input. Output plain text (no HTML), ready to paste.",
      prompt:
        `HOA: ${context.hoaName}\nProperty: ${context.address} (${context.homeownerNames || "Homeowner"})\n` +
        `Case: ${context.caseTitle} (${context.caseType}), current step: ${context.stageLabel}\n\n` +
        `Case history:\n${context.timeline}\n\n` +
        `Governing documents (excerpts):\n${context.docCorpus || "(none on file)"}\n\n` +
        `Draft the ${context.stageLabel} notice for this case.`,
      role: "copilot",
      temperature: 0.3,
    });
    if (!text) return { ok: false, error: "Drafting failed. Try again." };
    return { ok: true, draft: text };
  },
});

/** Assemble a board-ready hearing packet (or decision letter) from the timeline. */
export const draftHearingPacket = action({
  args: {
    caseId: v.id("cases"),
    kind: v.union(v.literal("packet"), v.literal("decisionLetter")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; draft: string } | { ok: false; error: string }> => {
    try {
      await ctx.runMutation(internal.copilot.internalCheckRateLimit, {});
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Rate limit reached." };
    }
    const context = await ctx.runQuery(internal.copilot.internalCaseContext, {
      caseId: args.caseId,
    });

    const instruction =
      args.kind === "packet"
        ? "Assemble a concise board hearing packet in markdown: 1) Case summary, 2) Chronology (from the history), 3) Relevant rules (cited from the documents), 4) Questions for the board. Facts only — no recommendation of outcome."
        : "Draft the written hearing decision letter (plain text). Include the case chronology in brief, the rule basis, and a placeholder [DECISION] where the board's outcome goes. The manager fills in the outcome.";

    const { text } = await ctx.runAction(internal.llm.generateText, {
      systemPrompt:
        "You prepare due-process hearing materials for an HOA. Accuracy over persuasion; never invent facts, rules, or outcomes.",
      prompt:
        `HOA: ${context.hoaName}\nProperty: ${context.address}\nCase: ${context.caseTitle}\n\n` +
        `Case history:\n${context.timeline}\n\n` +
        `Governing documents (excerpts):\n${context.docCorpus || "(none on file)"}\n\n${instruction}`,
      role: "copilot",
      temperature: 0.2,
    });
    if (!text) return { ok: false, error: "Drafting failed. Try again." };
    return { ok: true, draft: text };
  },
});

/** Aggregated enforcement data per HOA+category for the consistency guard. */
export const internalConsistencyInput = internalQuery({
  args: {},
  handler: async (ctx) => {
    const company = await requireCompanyMember(ctx);
    const hoas = await ctx.db
      .query("hoas")
      .withIndex("by_company", (q) => q.eq("managementCompanyId", company.companyId))
      .collect();

    const summaries: string[] = [];
    for (const hoa of hoas.filter((h) => h.status === "active")) {
      const cases = await ctx.db
        .query("cases")
        .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
        .collect();
      const violations = cases.filter((c) => c.caseType === "violation");
      if (violations.length < 2) continue;

      for (const c of violations) {
        const fines = await ctx.db
          .query("fines")
          .withIndex("by_case", (q) => q.eq("caseId", c._id))
          .collect();
        const ageDays = Math.round(((c.closedAt ?? Date.now()) - c.openedAt) / 86_400_000);
        summaries.push(
          `${hoa.name} | ${c.category ?? "uncategorized"} | "${c.title}" | stage ${c.stageKey} | status ${c.status} | ${ageDays}d old | fines: ${
            fines.length > 0 ? fines.map((f) => `$${f.amount} (${f.status})`).join(", ") : "none"
          }`,
        );
      }
    }
    return summaries;
  },
});

/**
 * Selective-enforcement guard: flags similar violations being handled
 * inconsistently within a community (a real legal exposure for HOAs).
 */
export const enforcementConsistency = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ ok: true; report: string } | { ok: false; error: string }> => {
    try {
      await ctx.runMutation(internal.copilot.internalCheckRateLimit, {});
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Rate limit reached." };
    }
    const rows = await ctx.runQuery(internal.copilot.internalConsistencyInput, {});
    if (rows.length < 2) {
      return { ok: true, report: "Not enough violation cases yet to compare enforcement." };
    }

    const { text } = await ctx.runAction(internal.llm.generateText, {
      systemPrompt:
        "You audit HOA enforcement consistency (selective enforcement is a legal risk). " +
        "Compare cases of the same community + category: similar violations should progress and be fined similarly. " +
        "Output short markdown: a bullet per potential inconsistency (name the cases and why), or 'No notable inconsistencies found.' Do not invent cases.",
      prompt: `One case per line (community | category | title | stage | status | age | fines):\n${rows.join("\n")}`,
      role: "copilot",
      temperature: 0.2,
    });
    if (!text) return { ok: false, error: "Analysis failed. Try again." };
    return { ok: true, report: text };
  },
});
