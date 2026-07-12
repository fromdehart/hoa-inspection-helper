import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerRole } from "./lib/tenantAuth";

/**
 * Board-facing surface over the findings queue (see convex/steward.ts for
 * the pipeline). The Desk reads the open queue; humans may dismiss a finding
 * ("known, not acting") — a dismissed finding stays quiet while its condition
 * persists and auto-resolves when the condition clears, so a later
 * recurrence fires fresh.
 */

const OPEN_STATUSES = ["new", "awaiting_agent", "awaiting_human"] as const;

export const listOpen = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const rows = [];
    for (const status of OPEN_STATUSES) {
      const batch = await ctx.db
        .query("findings")
        .withIndex("by_hoa_status", (q) => q.eq("hoaId", viewer.hoaId).eq("status", status))
        .collect();
      rows.push(...batch);
    }
    return rows.sort((a, b) => b.detectedAt - a.detectedAt);
  },
});

export const dismiss = mutation({
  args: { findingId: v.id("findings") },
  handler: async (ctx, args) => {
    const viewer = await requireViewerRole(ctx, ["admin", "board"]);
    const finding = await ctx.db.get(args.findingId);
    if (!finding || finding.hoaId !== viewer.hoaId) throw new Error("Finding not found.");
    if (finding.status === "resolved" || finding.status === "dismissed") return;
    await ctx.db.patch(args.findingId, {
      status: "dismissed",
      dismissedByClerkUserId: viewer.clerkUserId,
    });
  },
});
