import { useState, useEffect } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { trackEvent } from "@/utils/track";

const GATE_STORAGE_KEY = "one-shot-gate";

function getStorageKey(challengeId: string): string {
  return `${GATE_STORAGE_KEY}-${challengeId || "default"}`;
}

export function GateScreen({
  challengeId,
  onAccessGranted,
}: {
  challengeId: string;
  onAccessGranted: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const submitLead = useAction(api.leads.submitLead);

  const title = import.meta.env.VITE_GATE_TITLE ?? "One Shot.";
  const subtitle = import.meta.env.VITE_GATE_SUBTITLE ?? "Make it count.";
  const description =
    import.meta.env.VITE_GATE_DESCRIPTION ??
    "Enter your email to try the demo.";
  const videoUrl = import.meta.env.VITE_VEED_VIDEO_URL;
  const videoId = import.meta.env.VITE_VEED_VIDEO_ID;

  useEffect(() => {
    const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
    if (!siteKey || typeof document === "undefined") return;
    if (document.querySelector('script[src*="recaptcha"]')) return;
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setStatus("error");
      setErrorMessage("Please enter your email.");
      return;
    }
    setStatus("loading");
    setErrorMessage("");
    trackEvent("gate_submit", {});
    try {
      const recaptchaToken = await getRecaptchaToken();
      const result = await submitLead({
        challengeId: challengeId || "default",
        email: trimmed,
        recaptchaToken: recaptchaToken ?? undefined,
      });
      if (result.success && result.accessGranted) {
        localStorage.setItem(getStorageKey(challengeId), "true");
        onAccessGranted();
      } else {
        setStatus("error");
        setErrorMessage("Something went wrong. Please try again.");
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <div
      className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center px-6 py-20"
      style={{
        background:
          "linear-gradient(135deg, var(--background) 0%, rgba(0,194,255,0.07) 40%, rgba(255,90,95,0.06) 70%, var(--background) 100%)",
      }}
    >
      <div
        className="absolute top-0 right-0 w-24 sm:w-40 h-40 sm:h-64 rounded-bl-[3rem] opacity-80"
        style={{ backgroundColor: "var(--accent-coral)" }}
        aria-hidden
      />
      <div
        className="absolute bottom-0 left-0 w-32 sm:w-48 h-24 sm:h-40 rounded-tr-[3rem] opacity-70"
        style={{ backgroundColor: "var(--accent-sky)" }}
        aria-hidden
      />

      <main className="relative z-10 max-w-xl w-full text-center">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-2">
          <span className="block">{title}</span>
          <span
            className="block mt-2 bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent-coral), var(--accent-sky))",
            }}
          >
            {subtitle}
          </span>
        </h1>

        {(videoId || videoUrl) && (
          <div className="mt-10 mb-10 rounded-2xl overflow-hidden border-2 border-gray-100 bg-black/5 aspect-video">
            {videoId ? (
              <iframe
                title="Explainer"
                src={`https://www.veed.io/embed/${videoId}`}
                className="w-full h-full"
                allowFullScreen
              />
            ) : (
              <iframe
                title="Explainer"
                src={videoUrl}
                className="w-full h-full"
                allowFullScreen
              />
            )}
          </div>
        )}

        <p className="text-lg text-gray-600 mb-10">{description}</p>

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-end">
          <label className="flex-1 min-w-0">
            <span className="sr-only">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={status === "loading"}
              className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 focus:ring-2 focus:ring-[var(--accent-sky)] focus:border-transparent outline-none disabled:opacity-70"
              autoComplete="email"
            />
          </label>
          <button
            type="submit"
            disabled={status === "loading"}
            className="px-8 py-3 font-semibold rounded-xl text-white shadow-lg hover:opacity-95 disabled:opacity-60 transition-opacity whitespace-nowrap"
            style={{ backgroundColor: "var(--accent-coral)" }}
          >
            {status === "loading" ? "Getting access…" : "Continue"}
          </button>
        </form>

        {status === "error" && errorMessage && (
          <p className="mt-4 text-red-600 text-sm">{errorMessage}</p>
        )}

        <div className="mt-16 flex flex-wrap gap-4 justify-center">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: "var(--accent-coral)" }}
            aria-hidden
          />
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: "#8b5cf6" }}
            aria-hidden
          />
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: "var(--accent-sky)" }}
            aria-hidden
          />
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: "#f59e0b" }}
            aria-hidden
          />
        </div>
      </main>
    </div>
  );
}

async function getRecaptchaToken(): Promise<string | null> {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (!siteKey || typeof window === "undefined" || !window.grecaptcha?.ready) {
    return null;
  }
  return new Promise((resolve) => {
    window.grecaptcha.ready(() => {
      window.grecaptcha
        .execute(siteKey, { action: "gate_submit" })
        .then((token: string) => resolve(token))
        .catch(() => resolve(null));
    });
  });
}

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}
