import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { ONE_SHOT_VERSION } from "@/version";
import { api } from "../../convex/_generated/api";

const AUDIENCES = [
  {
    id: "for-hoas",
    emoji: "🏘️",
    title: "For HOAs & boards",
    tagline: "Buy it for your community",
    body: "Self-managed or board-run? Get the whole loop — inspections, cases, notices, hearings, and homeowner transparency — for one community, without hiring anyone or changing how you collect dues.",
    bullets: [
      "Run inspections and violations yourselves",
      "Every household gets a permanent, fair case record",
      "Homeowners see status, deadlines & history in their portal",
      "Board members get read-only oversight of every case",
    ],
  },
  {
    id: "for-managers",
    emoji: "🏢",
    title: "For management companies",
    tagline: "Enable it across your portfolio",
    body: "Run every community you manage from one command center. One work queue, one hearing calendar, one fairness check — and an AI copilot that drafts the paperwork your managers spend hours on.",
    bullets: [
      "Portfolio dashboard: every open case, deadline & hearing",
      "AI copilot plans each manager's day and drafts notices",
      "Enforcement-consistency guard flags selective-enforcement risk",
      "Drop into any community as its admin in one click",
    ],
  },
] as const;

const FEATURES = [
  {
    title: "Field inspections, offline",
    body: "Inspectors walk the streets and capture photos + notes with zero signal. Everything syncs when they're back in range.",
    emoji: "📸",
  },
  {
    title: "Case files & permanent timeline",
    body: "Every violation, request, or complaint becomes a case with an append-only history. Nothing is overwritten, ever.",
    emoji: "🗂️",
  },
  {
    title: "Due-process escalation",
    body: "Courtesy notice → cure period → hearing → fine, with server-enforced gates so no required step can be skipped. Configurable per state and community.",
    emoji: "⚖️",
  },
  {
    title: "Homeowner portal + AI chat",
    body: "Homeowners see their case status, upload fix photos, browse the rules, and get instant answers grounded in your community's own documents.",
    emoji: "🏡",
  },
  {
    title: "Email-in case building",
    body: "Cc the intake address and the record builds itself — the AI files the email onto the right case, with admins notified of every update.",
    emoji: "✉️",
  },
  {
    title: "AI copilot for managers",
    body: "A prioritized daily worklist, notice and hearing-packet drafts cited to your rules, and portfolio benchmarking — reviewed by a human before anything sends.",
    emoji: "🤖",
  },
] as const;

const HOA_STEPS = [
  { title: "Import", body: "Load your streets and properties from a CSV in minutes.", emoji: "📥" },
  { title: "Inspect", body: "Walk the community and capture findings — even offline.", emoji: "🔍" },
  { title: "Resolve", body: "Notices, fix photos, hearings & fines, all on one defensible timeline.", emoji: "✅" },
] as const;

const FIRM_STEPS = [
  { title: "Onboard", body: "Add your communities to the portfolio and invite your managers.", emoji: "🏢" },
  { title: "One queue", body: "Every deadline, hearing, and overdue case across all communities.", emoji: "📊" },
  { title: "Copilot", body: "AI plans the day, drafts the paperwork, and flags fairness risks.", emoji: "🤖" },
] as const;

const TRUST = [
  {
    title: "Audit trail by design",
    body: "The case timeline is append-only — every step is recorded permanently, so decisions hold up when challenged.",
    emoji: "🔒",
  },
  {
    title: "Due process, your rules",
    body: "Cure periods, hearing requirements, and fine schedules are configurable per community — because state law isn't one-size-fits-all.",
    emoji: "📜",
  },
  {
    title: "No payments handled",
    body: "Fines are assessed and tracked here; money stays in your existing accounting. Nothing to migrate, no co-mingled funds.",
    emoji: "🤝",
  },
] as const;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

export default function MarketingLanding() {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();
  const viewer = useQuery(api.tenancy.viewerContext, isLoaded && isSignedIn ? {} : "skip");
  const companyContext = useQuery(
    api.company.viewerCompanyContext,
    isLoaded && isSignedIn ? {} : "skip",
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  // Signed-in members shouldn't land on the marketing page — send them into the
  // app (inspectors to streets, admins to dashboard, board to cases, company
  // managers to their portfolio).
  useEffect(() => {
    if (!isLoaded || !isSignedIn || viewer === undefined || companyContext === undefined) return;
    if (viewer?.role === "inspector") navigate("/inspector/streets", { replace: true });
    else if (viewer?.role === "admin") navigate("/admin/properties", { replace: true });
    else if (viewer?.role === "board") navigate("/board/cases", { replace: true });
    else if (companyContext) navigate("/portfolio", { replace: true });
  }, [isLoaded, isSignedIn, viewer, companyContext, navigate]);

  return (
    <div className="min-h-screen gradient-hero flex flex-col">
      {!(isLoaded && isSignedIn) && (
        <div
          className="absolute right-4 z-[60] flex flex-wrap items-center justify-end gap-2 sm:right-6"
          style={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}
        >
          {installPrompt && !isStandalone && (
            <button
              type="button"
              onClick={() => void handleInstallClick()}
              className="rounded-full border border-emerald-400/50 bg-emerald-500/90 px-4 py-2 text-sm font-bold text-white shadow-md hover:bg-emerald-400 transition-colors"
            >
              Install app
            </button>
          )}
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
        <div
          className="sticky top-0 z-50 border-b border-white/15 bg-slate-900/80 px-4 pb-2 backdrop-blur-md"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
        >
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 text-sm text-white">
            <span className="font-medium text-white/90">You’re signed in.</span>
            <div className="flex flex-wrap gap-2">
              {viewer === undefined && (
                <span className="text-white/60 text-xs">Loading your access…</span>
              )}
              {viewer === null && !companyContext && (
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
                  onClick={() => navigate("/admin/properties")}
                >
                  Admin dashboard
                </button>
              )}
              {companyContext && (
                <button
                  type="button"
                  className="rounded-full border border-white/30 bg-white/10 px-3 py-1 font-semibold text-white hover:bg-white/20 transition-colors"
                  onClick={() => navigate("/portfolio")}
                >
                  Portfolio
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center px-6 py-12">
        {/* HERO */}
        <div className="text-center mb-10 max-w-2xl">
          <div className="text-6xl sm:text-7xl mb-4">🏘️</div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-3 tracking-tight">Happier Block</h1>
          <p className="text-blue-100 text-lg sm:text-xl font-medium leading-relaxed">
            The enforcement-and-resolution loop for community living — inspect, notify, resolve,
            and prove it — with a permanent record everyone can trust.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              href="#for-hoas"
              className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg hover:bg-blue-50 transition-colors"
            >
              For your HOA →
            </a>
            <a
              href="#for-managers"
              className="rounded-full border border-white/40 bg-white/10 px-5 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-white/20 transition-colors"
            >
              For management companies →
            </a>
          </div>
        </div>

        {/* AUDIENCES */}
        <section className="w-full max-w-4xl mb-14">
          <h2 className="text-center text-sm font-bold uppercase tracking-widest text-white/70 mb-6">
            Two ways to run it
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {AUDIENCES.map((a) => (
              <div
                key={a.id}
                id={a.id}
                className="rounded-2xl border border-white/15 bg-white/10 p-6 text-left shadow-lg backdrop-blur-sm scroll-mt-20"
              >
                <div className="text-3xl mb-2">{a.emoji}</div>
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">{a.tagline}</p>
                <h3 className="mt-1 text-xl font-bold text-white">{a.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-blue-100/90">{a.body}</p>
                <ul className="mt-4 space-y-1.5">
                  {a.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-blue-50/90">
                      <span aria-hidden className="mt-0.5 text-emerald-300">✓</span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* FEATURES */}
        <section className="w-full max-w-4xl mb-14">
          <h2 className="text-center text-sm font-bold uppercase tracking-widest text-white/70 mb-6">
            What's inside
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

        {/* HOW IT WORKS — per audience */}
        <section className="w-full max-w-4xl mb-14">
          <h2 className="text-center text-sm font-bold uppercase tracking-widest text-white/70 mb-6">
            How it works
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-center text-xs font-bold uppercase tracking-wide text-emerald-300">
                Your HOA
              </p>
              <div className="flex flex-col gap-3">
                {HOA_STEPS.map((s, i) => (
                  <div
                    key={s.title}
                    className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/5 px-4 py-4"
                  >
                    <span className="text-2xl">{s.emoji}</span>
                    <div>
                      <p className="text-xs font-bold text-white/50">Step {i + 1}</p>
                      <h3 className="text-base font-bold text-white">{s.title}</h3>
                      <p className="mt-1 text-xs text-blue-100/85 leading-relaxed">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-center text-xs font-bold uppercase tracking-wide text-sky-300">
                Your management company
              </p>
              <div className="flex flex-col gap-3">
                {FIRM_STEPS.map((s, i) => (
                  <div
                    key={s.title}
                    className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/5 px-4 py-4"
                  >
                    <span className="text-2xl">{s.emoji}</span>
                    <div>
                      <p className="text-xs font-bold text-white/50">Step {i + 1}</p>
                      <h3 className="text-base font-bold text-white">{s.title}</h3>
                      <p className="mt-1 text-xs text-blue-100/85 leading-relaxed">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* TRUST */}
        <section className="w-full max-w-4xl mb-14">
          <div className="grid gap-4 sm:grid-cols-3">
            {TRUST.map((t) => (
              <div
                key={t.title}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center"
              >
                <div className="text-2xl mb-1">{t.emoji}</div>
                <h3 className="text-sm font-bold text-white">{t.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-blue-100/80">{t.body}</p>
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
