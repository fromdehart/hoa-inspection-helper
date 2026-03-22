import { useState } from "react";
import { generateText } from "@/utils/ai";
import { sendEmail } from "@/utils/email";
import { trackEvent } from "@/utils/track";
import { ShareButtons } from "@/components/ShareButtons";

export default function Index() {
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailResult, setEmailResult] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);

  const handleTestAI = async () => {
    setLoading(true);
    setAiResult(null);
    trackEvent("test_ai_click", {});
    try {
      const { text } = await generateText({ prompt: "Say hello in one sentence." });
      setAiResult(text || "(no response)");
    } catch (e) {
      setAiResult("Error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  const handleTestEmail = async () => {
    const to = emailTo.trim();
    if (!to) {
      setEmailResult("Enter an email address to send a test to.");
      return;
    }
    setEmailLoading(true);
    setEmailResult(null);
    trackEvent("test_email_click", {});
    try {
      const result = await sendEmail(
        to,
        "One Shot – test email",
        "<p>If you got this, email is working.</p>"
      );
      if (result.success) {
        setEmailResult(`Sent! Check ${to} for the test email.`);
      } else {
        setEmailResult("Error: " + result.error);
      }
    } catch (e) {
      setEmailResult("Error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, var(--background) 0%, rgba(0,194,255,0.07) 40%, rgba(255,90,95,0.06) 70%, var(--background) 100%)",
      }}
    >
      {/* Small corner accent: keeps the vibe without covering text on any screen size */}
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

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-20 sm:py-28">
        <section className="text-center mb-20">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight mb-6">
            <span className="block">One Shot.</span>
            <span
              className="block mt-2 bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(135deg, var(--accent-coral), var(--accent-sky))",
              }}
            >
              Make it count.
            </span>
          </h1>
          <p className="text-xl sm:text-2xl text-gray-600 max-w-2xl mx-auto mb-12 leading-relaxed">
            A template for building AI-powered demos in one shot. Replace this with your challenge.
          </p>
          <button
            type="button"
            onClick={handleTestAI}
            disabled={loading}
            className="px-8 py-4 text-lg font-semibold rounded-2xl text-white shadow-lg hover:opacity-95 disabled:opacity-60 transition-opacity"
            style={{ backgroundColor: "var(--accent-coral)" }}
          >
            {loading ? "Calling AI…" : "Test AI"}
          </button>
        </section>

        <section className="mt-16 p-8 rounded-3xl border-2 border-gray-100 bg-white/80 backdrop-blur">
          <h2 className="text-2xl font-bold mb-4">Result</h2>
          {aiResult === null ? (
            <p className="text-gray-500">Click “Test AI” to see the model response here.</p>
          ) : (
            <p className="text-gray-800 leading-relaxed">{aiResult}</p>
          )}
        </section>

        <section className="mt-8 p-8 rounded-3xl border-2 border-gray-100 bg-white/80 backdrop-blur">
          <h2 className="text-2xl font-bold mb-4">Test email</h2>
          <p className="text-gray-600 mb-4">
            Send a test email to verify Resend is configured (set RESEND_API_KEY and RESEND_FROM in Convex env).
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex-1 min-w-[200px]">
              <span className="block text-sm font-medium text-gray-700 mb-1">To</span>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-[var(--accent-sky)] focus:border-transparent outline-none"
              />
            </label>
            <button
              type="button"
              onClick={handleTestEmail}
              disabled={emailLoading}
              className="px-6 py-2.5 font-semibold rounded-xl text-white shadow hover:opacity-95 disabled:opacity-60 transition-opacity"
              style={{ backgroundColor: "var(--accent-sky)" }}
            >
              {emailLoading ? "Sending…" : "Send test email"}
            </button>
          </div>
          {emailResult !== null && (
            <p className={`mt-4 ${emailResult.startsWith("Error") || emailResult.startsWith("Enter") ? "text-red-600" : "text-gray-800"}`}>
              {emailResult}
            </p>
          )}
        </section>

        <ShareButtons />

        <div className="mt-20 flex flex-wrap gap-4 justify-center">
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
