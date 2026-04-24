import { getUserRoles } from "@/lib/auth";

const PREFIX = "[hoa-auth]";

type LooseUser = {
  id?: string;
  publicMetadata?: Record<string, unknown>;
} | null | undefined;

/** Safe fields only — no tokens, passwords, or email. */
export function authUserSnapshot(user: LooseUser) {
  if (!user?.id) {
    return { signedIn: false as const };
  }
  return {
    signedIn: true as const,
    clerkUserId: user.id,
    publicMetadataRole: user.publicMetadata?.role,
    publicMetadataRoles: user.publicMetadata?.roles,
    resolvedRoles: getUserRoles(user),
  };
}

/** Mask Clerk publishable key for logs (e.g. pk_test_abc…xyz). */
export function clerkPublishableKeyHint(key: string | undefined): string {
  if (!key) return "(missing)";
  const t = key.trim();
  if (t.length <= 16) return `${t.slice(0, 6)}…`;
  return `${t.slice(0, 12)}…${t.slice(-6)}`;
}

/**
 * Structured auth logs (browser console). Filter DevTools by `[hoa-auth]`.
 * Enable verbose Clerk session logs with: VITE_AUTH_DEBUG=1
 */
export function authLog(source: string, event: string, detail: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  const verbose = import.meta.env.VITE_AUTH_DEBUG === "1";
  const line = { ts, source, event, ...detail, ...(verbose ? { envMode: import.meta.env.MODE } : {}) };
  console.info(PREFIX, line);
}
