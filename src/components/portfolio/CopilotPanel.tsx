import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type WorklistItem = {
  caseId: string;
  title: string;
  hoaName: string;
  address: string;
  reason: string;
};

/**
 * Manager copilot: "Your day" prioritizer, per-case notice drafting, hearing
 * packet, and the selective-enforcement consistency guard. All drafts are
 * review-before-use — the copilot never sends anything itself.
 */
export function CopilotPanel() {
  const prioritizeDay = useAction(api.copilot.prioritizeDay);
  const draftStageNotice = useAction(api.copilot.draftStageNotice);
  const draftHearingPacket = useAction(api.copilot.draftHearingPacket);
  const enforcementConsistency = useAction(api.copilot.enforcementConsistency);

  const [worklist, setWorklist] = useState<WorklistItem[] | null>(null);
  const [consistencyReport, setConsistencyReport] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const handlePrioritize = () =>
    run("day", async () => {
      const result = await prioritizeDay({});
      if (!result.ok) throw new Error(result.error);
      setWorklist(result.items);
    });

  const handleConsistency = () =>
    run("consistency", async () => {
      const result = await enforcementConsistency({});
      if (!result.ok) throw new Error(result.error);
      setConsistencyReport(result.report);
    });

  const handleDraftNotice = (caseId: string, title: string) =>
    run(caseId, async () => {
      const result = await draftStageNotice({ caseId: caseId as Id<"cases"> });
      if (!result.ok) throw new Error(result.error);
      setDraft({ title: `Notice draft — ${title}`, text: result.draft });
    });

  const handleDraftPacket = (caseId: string, title: string) =>
    run(`packet-${caseId}`, async () => {
      const result = await draftHearingPacket({
        caseId: caseId as Id<"cases">,
        kind: "packet",
      });
      if (!result.ok) throw new Error(result.error);
      setDraft({ title: `Hearing packet — ${title}`, text: result.draft });
    });

  const copyDraft = async () => {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-sky-900">🤖 Copilot</h2>
          <p className="text-xs text-sky-700">
            Drafts are for your review — nothing is sent automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void handlePrioritize()} disabled={busy !== null}>
            {busy === "day" ? "Thinking…" : "Plan my day"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleConsistency()}
            disabled={busy !== null}
          >
            {busy === "consistency" ? "Auditing…" : "Fairness check"}
          </Button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {worklist && (
        <div className="mt-3">
          {worklist.length === 0 ? (
            <p className="text-sm text-sky-800">No open cases in the portfolio. Enjoy the quiet.</p>
          ) : (
            <ol className="space-y-2">
              {worklist.map((item, idx) => (
                <li key={item.caseId} className="rounded-lg border border-sky-100 bg-white p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {idx + 1}. {item.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.hoaName} · {item.address}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-sky-800">{item.reason}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void handleDraftNotice(item.caseId, item.title)}
                      >
                        {busy === item.caseId ? "Drafting…" : "Draft notice"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => void handleDraftPacket(item.caseId, item.title)}
                      >
                        {busy === `packet-${item.caseId}` ? "Drafting…" : "Hearing packet"}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {consistencyReport && (
        <div className="mt-3 rounded-lg border border-sky-100 bg-white p-3">
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-sky-800">
            Enforcement consistency
          </h3>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{consistencyReport}</p>
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.title}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-800">
            {draft?.text}
          </pre>
          <Button size="sm" onClick={() => void copyDraft()}>
            {copied ? "Copied ✓" : "Copy to clipboard"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
