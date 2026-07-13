import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

/**
 * Meetings assistant v1 (Phase 3b): an agenda is a LIST ASSEMBLY, not prose —
 * both artifacts here are fully deterministic reads over the record the
 * board already keeps (agenda items, motions, findings). Humans add the
 * words; the record supplies the facts. No LLM, no Reviewer, nothing to
 * hallucinate.
 */

const OPEN_FINDING_STATUSES = ["new", "awaiting_agent", "awaiting_human"] as const;

export const assembleAgenda = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const hoaId = viewer.hoaId;

    const items = await ctx.db
      .query("agendaItems")
      .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoaId).eq("status", "open"))
      .collect();
    const passed = await ctx.db
      .query("motions")
      .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoaId).eq("status", "passed"))
      .collect();
    const ratifications = passed.filter((m) => m.method !== "meeting" && !m.ratifiedNote);
    const openMotions = await ctx.db
      .query("motions")
      .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoaId).eq("status", "open"))
      .collect();

    const findingCounts: Record<string, number> = {};
    for (const status of OPEN_FINDING_STATUSES) {
      const rows = await ctx.db
        .query("findings")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", hoaId).eq("status", status))
        .collect();
      for (const f of rows) findingCounts[f.kind] = (findingCounts[f.kind] ?? 0) + 1;
    }

    const date = new Date().toLocaleDateString();
    const lines: string[] = [
      `# Board Meeting Agenda — ${viewer.hoaName}`,
      `_Assembled ${date} from the board record._`,
      "",
      "## 1. Call to order",
      "",
      "## 2. Ratification of decisions made between meetings",
      ...(ratifications.length > 0
        ? ratifications.map((m) => {
            const yes = m.votes.filter((entry) => entry.vote === "yes").length;
            return `- Ratify: **${m.title}** (passed ${new Date(m.closedAt ?? m.createdAt).toLocaleDateString()}, ${yes}/${m.quorumRequired} concurrences, ${m.method.replace("_", " ")})`;
          })
        : ["- _None pending._"]),
      "",
      "## 3. Open votes needing the meeting",
      ...(openMotions.length > 0
        ? openMotions.map(
            (m) => `- **${m.title}** (${m.votes.length}/${m.quorumRequired} votes so far)`,
          )
        : ["- _None._"]),
      "",
      "## 4. Business",
      ...(items.length > 0
        ? items.map((it) => `- ${it.title}${it.detail ? ` — ${it.detail}` : ""}`)
        : ["- _No topics gathered._"]),
      "",
      "## 5. The Steward's report",
      ...(Object.keys(findingCounts).length > 0
        ? Object.entries(findingCounts).map(([kind, n]) => `- ${kind.replace(/_/g, " ")}: ${n} open`)
        : ["- _Queue is clear._"]),
      "",
      "## 6. Adjourn",
    ];
    return { markdown: lines.join("\n"), counts: { items: items.length, ratifications: ratifications.length } };
  },
});

export const draftMinutesScaffold = query({
  args: { sinceDaysAgo: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const since = Date.now() - (args.sinceDaysAgo ?? 60) * 24 * 60 * 60 * 1000;

    const all = await ctx.db
      .query("motions")
      .withIndex("by_hoa", (q) => q.eq("hoaId", viewer.hoaId))
      .collect();
    const decided = all
      .filter((m) => m.status !== "open" && (m.closedAt ?? m.createdAt) >= since)
      .sort((a, b) => (a.closedAt ?? a.createdAt) - (b.closedAt ?? b.createdAt));
    const doneItems = (
      await ctx.db
        .query("agendaItems")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", "done"))
        .collect()
    ).filter((it) => it.createdAt >= since);

    const lines: string[] = [
      `# Board Meeting Minutes — ${viewer.hoaName} (DRAFT SCAFFOLD)`,
      `_Facts prefilled from the decision log; write the discussion._`,
      "",
      "**Date:** ____  **Present:** ____  **Called to order:** ____",
      "",
      "## Decisions on the record",
      ...(decided.length > 0
        ? decided.map((m) => {
            const votes = m.votes
              .map((entry) => `${entry.vote}`)
              .join(", ");
            return `- **${m.title}** — ${m.status.toUpperCase()} ${new Date(m.closedAt ?? m.createdAt).toLocaleDateString()} (votes: ${votes || "none recorded"}; method: ${m.method.replace("_", " ")})${m.ratifiedNote ? ` — ${m.ratifiedNote}` : ""}`;
          })
        : ["- _No motions decided in this period._"]),
      "",
      "## Business handled",
      ...(doneItems.length > 0
        ? doneItems.map((it) => `- ${it.title}`)
        : ["- _(none marked done)_"]),
      "",
      "## Discussion",
      "____",
      "",
      "**Adjourned:** ____  **Minutes by:** ____",
    ];
    return { markdown: lines.join("\n") };
  },
});
