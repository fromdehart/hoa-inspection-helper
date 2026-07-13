import { action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireViewerRole } from "./lib/tenantAuth";
import { requireFeature } from "./lib/featureFlags";

/**
 * "Ask the record" (Phase 4c): institutional memory over the board's own
 * structured record — decisions (with votes and dates), the compliance
 * calendar, agenda history, workflow ladders, and the HOA's guideline text.
 * The costliest lost knowledge in the corpus was DECISIONS, not documents
 * (OM §2.5) — and decisions are already structured data. Read-only: no
 * Reviewer gate, but every ask is logged.
 */

const MAX_CORPUS_CHARS = 24_000;

export const internalRecordCorpus = internalQuery({
  args: { hoaId: v.id("hoas") },
  handler: async (ctx, args) => {
    const sections: string[] = [];

    const motions = await ctx.db
      .query("motions")
      .withIndex("by_hoa", (q) => q.eq("hoaId", args.hoaId))
      .order("desc")
      .take(100);
    sections.push(
      "## Decision log (motions)\n" +
        (motions.length > 0
          ? motions
              .map((m) => {
                const votes = m.votes.map((entry) => entry.vote).join(",") || "no votes";
                const when = new Date(m.closedAt ?? m.createdAt).toLocaleDateString();
                return `- "${m.title}" — ${m.status} ${when} (${votes}; quorum ${m.quorumRequired}; ${m.method})${m.context ? ` — ${m.context}` : ""}${m.ratifiedNote ? ` [${m.ratifiedNote}]` : ""}`;
              })
              .join("\n")
          : "(no motions recorded)"),
    );

    const deadlines = await ctx.db
      .query("deadlines")
      .withIndex("by_hoa_due", (q) => q.eq("hoaId", args.hoaId))
      .collect();
    sections.push(
      "## Compliance calendar\n" +
        (deadlines.length > 0
          ? deadlines
              .map(
                (d) =>
                  `- "${d.title}" due ${new Date(d.dueAt).toLocaleDateString()} — ${d.verificationState}${d.evidenceNote ? ` (evidence: ${d.evidenceNote})` : ""}`,
              )
              .join("\n")
          : "(empty)"),
    );

    const agenda = [];
    for (const status of ["open", "scheduled", "done"] as const) {
      const rows = await ctx.db
        .query("agendaItems")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", args.hoaId).eq("status", status))
        .take(60);
      agenda.push(...rows.map((it) => `- [${status}] ${it.title}`));
    }
    sections.push("## Agenda items\n" + (agenda.length > 0 ? agenda.join("\n") : "(none)"));

    const workflows = await ctx.db
      .query("caseWorkflows")
      .withIndex("by_hoa", (q) => q.eq("hoaId", args.hoaId))
      .collect()
      .catch(() => []);
    if (workflows.length > 0) {
      sections.push(
        "## Case workflow ladders\n" +
          workflows
            .map(
              (w) =>
                `- ${w.caseType}: ${w.stages.map((s) => `${s.label}${s.dueInDays ? ` (${s.dueInDays}d)` : ""}`).join(" → ")}`,
            )
            .join("\n"),
      );
    }

    const aiConfig = await ctx.db
      .query("aiConfig")
      .withIndex("by_hoa", (q) => q.eq("hoaId", args.hoaId))
      .collect()
      .catch(() => []);
    for (const cfg of aiConfig) {
      if (cfg.value?.trim()) sections.push(`## Guidelines (${cfg.key})\n${cfg.value.slice(0, 4000)}`);
    }

    let corpus = "";
    for (const s of sections) {
      if (corpus.length + s.length + 2 > MAX_CORPUS_CHARS) break;
      corpus += (corpus ? "\n\n" : "") + s;
    }
    return corpus;
  },
});

export const logAsk = internalMutation({
  args: { hoaId: v.id("hoas"), question: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const runId = await ctx.db.insert("agentRuns", {
      hoaId: args.hoaId,
      agent: "steward",
      duty: "recall",
      trigger: "user:ask-record",
      status: "ok",
      startedAt: now,
      endedAt: now,
      actionsCount: 1,
    });
    await ctx.db.insert("agentActions", {
      hoaId: args.hoaId,
      runId,
      toolName: "ask_record",
      argsSummary: `Q: ${args.question.slice(0, 120)}`,
      autonomyLevel: "L0",
      reviewerVerdict: "exempt",
      outcome: "executed",
      createdAt: now,
    });
  },
});

export const ask = action({
  args: { question: v.string() },
  handler: async (ctx, args): Promise<{ answer: string }> => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    await requireFeature(ctx, viewer.hoaId, "steward");
    const question = args.question.trim().slice(0, 500);
    if (!question) return { answer: "" };

    const corpus = await ctx.runQuery(internal.askRecord.internalRecordCorpus, {
      hoaId: viewer.hoaId,
    });
    await ctx.runMutation(internal.askRecord.logAsk, { hoaId: viewer.hoaId, question });

    const { text } = await ctx.runAction(internal.llm.generateText, {
      role: "copilot",
      systemPrompt:
        "You answer a volunteer HOA board member's questions using ONLY the board record provided. " +
        "Cite what you rely on (motion title + date, deadline name, guideline section). " +
        "If the record doesn't contain the answer, say so plainly and suggest where it might live " +
        "(meeting minutes, the management company, legal counsel). Never guess. Be concise.",
      prompt: `THE BOARD RECORD:\n${corpus}\n\nQUESTION: ${question}`,
      temperature: 0.1,
    });
    return { answer: text.trim() || "The record doesn't contain an answer to that." };
  },
});
