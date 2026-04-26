import { type AuthConfig } from "convex/server";

/**
 * Clerk JWT validation for Convex `ctx.auth.getUserIdentity()`.
 * Set `CLERK_JWT_ISSUER_DOMAIN` on the Convex deployment and in `.env.local` (same value as Clerk “Frontend API” URL).
 * @see https://docs.convex.dev/auth/clerk
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
