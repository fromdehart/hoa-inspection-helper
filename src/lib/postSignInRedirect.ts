/** React Router `location.state` when redirecting to `/sign-in`. */
export type SignInRedirectState = { from?: string };

export function isSafeInternalAppPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.startsWith("/sign-in")) return false;
  return true;
}

/** Where to send the user after Clerk sign-in completes (same-origin paths only). */
export function resolvePostSignInRedirect(state: unknown): string {
  const from = (state as SignInRedirectState | null)?.from;
  if (typeof from === "string" && isSafeInternalAppPath(from)) return from;
  return "/";
}
