/** React Router `location.state` when redirecting to `/sign-in`. */
export type SignInRedirectState = { from?: string };

const SESSION_RETURN_KEY = "hoa_auth_sign_in_return";

export function isSafeInternalAppPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.startsWith("/sign-in")) return false;
  return true;
}

/** Call when sending the user to `/sign-in` so return path survives Clerk MFA / URL steps. */
export function persistSignInReturnPath(path: string): void {
  if (typeof window === "undefined" || !isSafeInternalAppPath(path)) return;
  try {
    window.sessionStorage.setItem(SESSION_RETURN_KEY, path);
  } catch {
    // private mode, quota, etc.
  }
}

export function clearSignInReturnPath(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_RETURN_KEY);
  } catch {
    // ignore
  }
}

function readStoredReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(SESSION_RETURN_KEY);
    if (typeof v === "string" && isSafeInternalAppPath(v)) return v;
    return null;
  } catch {
    return null;
  }
}

/** Where to send the user after Clerk sign-in completes (same-origin paths only). */
export function resolvePostSignInRedirect(state: unknown): string {
  const from = (state as SignInRedirectState | null)?.from;
  if (typeof from === "string" && isSafeInternalAppPath(from)) return from;
  const stored = readStoredReturnPath();
  if (stored) return stored;
  return "/";
}
