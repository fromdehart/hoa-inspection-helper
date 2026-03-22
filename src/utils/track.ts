import { convex } from "@/lib/convexClient";
import { api } from "../../convex/_generated/api";

let sessionId: string | null = null;

export function getSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    if (!sessionId) sessionId = crypto.randomUUID();
    return sessionId;
  }
  if (!sessionId) sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return sessionId;
}

export function trackEvent(
  eventName: string,
  metadata: Record<string, unknown> = {}
): void {
  (async () => {
    try {
      const challengeId = import.meta.env.VITE_CHALLENGE_ID ?? "";
      await convex.mutation(api.tracking.trackEvent, {
        eventName,
        metadata,
        challengeId,
        sessionId: getSessionId(),
      });
    } catch (_) {
      // swallow silently
    }
  })();
}
