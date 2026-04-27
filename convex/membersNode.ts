"use node";

import { createClerkClient } from "@clerk/backend";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const ROLE_VALIDATOR = v.union(v.literal("admin"), v.literal("inspector"));
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function assertValidEmail(email: string) {
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Enter a valid email address.");
  }
}

export const createOrAttachMember = action({
  args: {
    email: v.string(),
    fullName: v.optional(v.string()),
    role: ROLE_VALIDATOR,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) throw new Error("Authentication required.");
    const viewerMembership = await ctx.runQuery(internal.members.listMembershipByClerkUserInternal, {
      clerkUserId: identity.subject,
    });
    if (!viewerMembership || viewerMembership.role !== "admin") throw new Error("Only admins can add members.");

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

    const existingMembership = await ctx.runQuery(internal.members.listMembershipByClerkUserInternal, {
      clerkUserId: clerkUser.id,
    });
    if (existingMembership && existingMembership.hoaId !== viewerMembership.hoaId) {
      throw new Error("This user is already assigned to a different HOA.");
    }

    const result = await ctx.runMutation(internal.members.upsertMembershipInternal, {
      clerkUserId: clerkUser.id,
      hoaId: viewerMembership.hoaId,
      role: args.role,
      email,
      fullName,
      invitedByClerkUserId: identity.subject,
    });

    return {
      ...result,
      clerkUserId: clerkUser.id,
      role: args.role,
      email,
      fullName: fullName ?? "",
      status: clerkUser.lastSignInAt ? "active" : "provisioned",
    };
  },
});
