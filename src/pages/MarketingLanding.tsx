import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { ONE_SHOT_VERSION } from "@/version";
import { api } from "../../convex/_generated/api";

const FEATURES = [
  {
    title: "Admin dashboard",
    body: "Track every property with status filters, letter workflow (needs generation, generated, sent), search, and CSV import.",
    emoji: "📋",
  },
  {
    title: "Letters & exports",
    body: "Upload and edit letter templates, export homeowner PDFs in bulk, and download inspector photo ZIPs for records.",
    emoji: "📄",
  },
  {
    title: "Team members",
    body: "Admins can add other admins and inspectors for your community from one place.",
    emoji: "👥",
  },
  {
    title: "Inspector mode",
    body: "Walk streets, open each address, and capture front, side, and back photos with notes—built for mobile.",
    emoji: "🚶",
  },
  {
    title: "AI letter support",
    body: "Optional AI-assisted bullet lists and inspection helpers where configured for your HOA.",
    emoji: "✨",
  },
] as const;

const STEPS = [
  { title: "Import", body: "Load your property list and streets from a simple CSV.", emoji: "📥" },
  { title: "Inspect", body: "Admins review progress; inspectors capture photos in the field.", emoji: "🔍" },
  { title: "Notify", body: "Generate letters and track what’s been sent to homeowners.", emoji: "📬" },
] as const;

export default function MarketingLanding() {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();
  const viewer = useQuery(api.tenancy.viewerContext, isLoaded && isSignedIn ? {} : "skip");

  return (
    <div className="min-h-screen gradient-hero flex flex-col">
      {!(isLoaded && isSignedIn) && (
        <div className="absolute top-4 right-4 z-[60] sm:top-6 sm:right-6">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="rounded-full border border-white/35 bg-white/15 px-4 py-2 text-sm font-bold text-white shadow-md hover:bg-white/25 transition-colors"
          >
            Sign in
          </button>
        </div>
      )}

      {isLoaded && isSignedIn && (
        <div className="sticky top-0 z-50 border-b border-white/15 bg-slate-900/80 px-4 py-2 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 text-sm text-white">
            <span className="font-medium text-white/90">You’re signed in.</span>
            <div className="flex flex-wrap gap-2">
              {viewer === undefined && (
                <span className="text-white/60 text-xs">Loading your access…</span>
              )}
              {viewer === null && (
                <span className="text-amber-200/90 text-xs">No community membership on file. Ask an admin to assign your account.</span>
              )}
              {viewer && (viewer.role === "admin" || viewer.role === "inspector") && (
                <button
                  type="button"
                  className="rounded-full border border-white/30 bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20 transition-colors"
                  onClick={() => navigate("/inspector/streets")}
                >
                  Inspector
                </button>
              )}
              {viewer?.role === "admin" && (
                <button
                  type="button"
                  className="rounded-full border border-white/30 bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20 transition-colors"
                  onClick={() => navigate("/admin/dashboard")}
                >
                  Admin dashboard
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center px-6 py-12">
        <div className="text-center mb-10 max-w-2xl">
          <div className="text-6xl sm:text-7xl mb-4">🏘️</div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-3 tracking-tight">Happier Block</h1>
          <p className="text-blue-100 text-lg sm:text-xl font-medium leading-relaxed">
            HOA exterior inspections made clearer—from the first import to the last letter.
          </p>
        </div>

        <section className="w-full max-w-4xl mb-14">
          <h2 className="text-center text-sm font-bold uppercase tracking-widest text-white/70 mb-6">Features</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-white/15 bg-white/10 p-5 text-left shadow-lg backdrop-blur-sm"
              >
                <div className="text-3xl mb-2">{f.emoji}</div>
                <h3 className="text-lg font-bold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-blue-100/90">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="w-full max-w-3xl mb-14">
          <h2 className="text-center text-sm font-bold uppercase tracking-widest text-white/70 mb-6">How it works</h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center sm:gap-6">
            {STEPS.map((s, i) => (
              <div
                key={s.title}
                className="flex flex-1 flex-col items-center rounded-2xl border border-white/15 bg-white/5 px-4 py-6 text-center"
              >
                <span className="text-3xl mb-2">{s.emoji}</span>
                <span className="text-xs font-bold text-white/50 mb-1">Step {i + 1}</span>
                <h3 className="text-base font-bold text-white">{s.title}</h3>
                <p className="mt-2 text-xs text-blue-100/85 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-auto w-full max-w-3xl border-t border-white/10 pt-8 text-center">
          {!(isLoaded && isSignedIn) && (
            <button
              type="button"
              className="text-sm font-semibold text-white/85 underline-offset-4 hover:text-white hover:underline"
              onClick={() => navigate("/login")}
            >
              Sign in
            </button>
          )}
          <p className="mt-6 text-white/25 text-xs">Happier Block v{ONE_SHOT_VERSION}</p>
          <p className="mt-2 text-white/20 text-xs">© {new Date().getFullYear()} Happier Block</p>
        </footer>
      </div>
    </div>
  );
}
