"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const getConfig = () => ({
  apiKey: process.env.RESEND_API_KEY!,
  from: process.env.RESEND_FROM ?? "",
});

const VOTE_MILESTONE_TO = "mdehart1@gmail.com";

export const sendEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
  },
  handler: async (_ctx, args) => {
    const { apiKey, from } = getConfig();
    if (!apiKey || !from) {
      return { success: false as const, error: "Missing RESEND_API_KEY or RESEND_FROM" };
    }
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
      });
      if (error) {
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false as const, error: message };
    }
  },
});

export const sendVoteTractionEmail = action({
  args: {
    challengeId: v.string(),
    count: v.number(),
  },
  handler: async (_ctx, args) => {
    const { apiKey, from } = getConfig();
    if (!apiKey || !from) {
      return { success: false as const, error: "Missing RESEND_API_KEY or RESEND_FROM" };
    }
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from,
        to: VOTE_MILESTONE_TO,
        subject: "One Shot getting traction — 25 votes!",
        html: `<p>Challenge <strong>${escapeHtml(args.challengeId)}</strong> hit <strong>${args.count}</strong> votes and is getting traction!</p>`,
      });
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false as const, error: message };
    }
  },
});

export const sendVoteMilestoneEmail = action({
  args: {
    challengeId: v.string(),
    count: v.number(),
  },
  handler: async (_ctx, args) => {
    const { apiKey, from } = getConfig();
    if (!apiKey || !from) {
      return { success: false as const, error: "Missing RESEND_API_KEY or RESEND_FROM" };
    }
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from,
        to: VOTE_MILESTONE_TO,
        subject: "🚀 One Shot hit 250 votes!",
        html: `<p>Challenge <strong>${escapeHtml(args.challengeId)}</strong> hit 250 votes! Final count: <strong>${args.count}</strong>.</p>`,
      });
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false as const, error: message };
    }
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
