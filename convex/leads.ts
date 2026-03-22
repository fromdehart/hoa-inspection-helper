import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export const insertLead = internalMutation({
  args: {
    challengeId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const emailTrimmed = args.email.trim().toLowerCase();
    if (!isValidEmail(emailTrimmed)) {
      throw new Error("Invalid email format");
    }
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_challenge_and_email", (q) =>
        q.eq("challengeId", args.challengeId).eq("email", emailTrimmed)
      )
      .first();
    if (existing) {
      return { success: true as const, accessGranted: true as const };
    }
    await ctx.db.insert("leads", {
      challengeId: args.challengeId,
      email: emailTrimmed,
      createdAt: Date.now(),
    });
    return { success: true as const, accessGranted: true as const };
  },
});

export const submitLead = action({
  args: {
    challengeId: v.string(),
    email: v.string(),
    recaptchaToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (secret) {
      if (!args.recaptchaToken) {
        throw new Error("ReCAPTCHA required");
      }
      const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(args.recaptchaToken)}`,
      });
      const data = (await res.json()) as { success?: boolean };
      if (!data.success) {
        throw new Error("ReCAPTCHA verification failed");
      }
    }
    return await ctx.runMutation(internal.leads.insertLead, {
      challengeId: args.challengeId,
      email: args.email,
    });
  },
});
