"use node";

import { createClerkClient } from "@clerk/backend";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function assertValidEmail(email: string) {
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid email address.");
  }
}

export const assignHoaAdmin = action({
  args: {
    hoaId: v.id("hoas"),
    email: v.string(),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) throw new Error("Authentication required.");

    const isAdmin = await ctx.runQuery(internal.platform.isPlatformAdminInternal, {
      clerkUserId: identity.subject,
    });
    if (!isAdmin) throw new Error("Platform admin access required.");

    const email = normalizeEmail(args.email);
    const fullName = args.fullName?.trim();
    assertValidEmail(email);

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Missing CLERK_SECRET_KEY in Convex environment.");
    }
    const clerk = createClerkClient({ secretKey });

    const [firstName, ...lastNameParts] = (fullName ?? "").split(" ").filter(Boolean);
    const maybeLastName = lastNameParts.join(" ") || undefined;

    const existingUsers = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
    let clerkUser = existingUsers.data[0];

    if (!clerkUser) {
      clerkUser = await clerk.users.createUser({
        emailAddress: [email],
        firstName: firstName || undefined,
        lastName: maybeLastName,
        skipPasswordChecks: true,
        skipPasswordRequirement: true,
      });
    }

    const result = await ctx.runMutation(internal.members.upsertMembershipInternal, {
      clerkUserId: clerkUser.id,
      hoaId: args.hoaId,
      role: "admin",
      email,
      fullName,
      invitedByClerkUserId: identity.subject,
    });

    return {
      ...result,
      clerkUserId: clerkUser.id,
      role: "admin" as const,
      email,
      fullName: fullName ?? "",
    };
  },
});
