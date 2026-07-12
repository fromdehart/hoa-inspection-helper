import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type HearingOutcome = "upheld" | "dismissed" | "continued" | "resolved";

const OUTCOMES: Array<{ value: HearingOutcome; label: string }> = [
  { value: "upheld", label: "Violation upheld" },
  { value: "dismissed", label: "Dismissed" },
  { value: "continued", label: "Continued" },
  { value: "resolved", label: "Resolved" },
];

/** Hearing scheduling/decisions + fine assessment/tracking for a case (no payments). */
export function HearingsFines({ caseId }: { caseId: Id<"cases"> }) {
  const hearings = useQuery(api.hearings.listForCase, { caseId });
  const fines = useQuery(api.fines.listForCase, { caseId });
  const schedule = useMutation(api.hearings.schedule);
  const recordDecision = useMutation(api.hearings.recordDecision);
  const assessFine = useMutation(api.fines.assess);
  const waiveFine = useMutation(api.fines.waive);
  const satisfyFine = useMutation(api.fines.markSatisfied);

  const [showSchedule, setShowSchedule] = useState(false);
  const [hearingDate, setHearingDate] = useState("");
  const [hearingLocation, setHearingLocation] = useState("");
  const [decidingId, setDecidingId] = useState<Id<"hearings"> | null>(null);
  const [outcome, setOutcome] = useState<HearingOutcome>("upheld");
  const [decisionText, setDecisionText] = useState("");
  const [showFineForm, setShowFineForm] = useState(false);
  const [fineAmount, setFineAmount] = useState("");
  const [fineReason, setFineReason] = useState("");
  const [fineRule, setFineRule] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const decidedHearingExists = (hearings ?? []).some((h) => h.decidedAt);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Hearings</h3>
          <Button size="sm" variant="outline" onClick={() => setShowSchedule((s) => !s)}>
            {showSchedule ? "Cancel" : "Schedule hearing"}
          </Button>
        </div>

        {showSchedule && (
          <div className="mb-3 space-y-2 rounded-lg border bg-slate-50 p-3">
            <div className="flex flex-wrap gap-2">
              <Input
                type="datetime-local"
                className="w-56 bg-white"
                value={hearingDate}
                onChange={(e) => setHearingDate(e.target.value)}
              />
              <Input
                className="flex-1 min-w-40 bg-white"
                placeholder="Location or video link (optional)"
                value={hearingLocation}
                onChange={(e) => setHearingLocation(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={busy || !hearingDate}
              onClick={() =>
                void run(async () => {
                  await schedule({
                    caseId,
                    scheduledFor: new Date(hearingDate).getTime(),
                    location: hearingLocation || undefined,
                  });
                  setShowSchedule(false);
                  setHearingDate("");
                  setHearingLocation("");
                })
              }
            >
              {busy ? "Scheduling…" : "Schedule"}
            </Button>
          </div>
        )}

        {hearings === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : hearings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hearings for this case.</p>
        ) : (
          <ul className="space-y-2">
            {hearings.map((h) => (
              <li key={h._id} className="rounded-lg border bg-white p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">
                      {new Date(h.scheduledFor).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    {h.location && <span className="text-muted-foreground"> · {h.location}</span>}
                  </div>
                  {h.decidedAt ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize">
                      {h.outcome}
                    </span>
                  ) : decidingId === h._id ? null : (
                    <Button size="sm" variant="outline" onClick={() => setDecidingId(h._id)}>
                      Record decision
                    </Button>
                  )}
                </div>
                {h.decisionText && (
                  <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{h.decisionText}</p>
                )}
                {decidingId === h._id && !h.decidedAt && (
                  <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2.5">
                    <Select value={outcome} onValueChange={(v) => setOutcome(v as HearingOutcome)}>
                      <SelectTrigger className="w-52 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OUTCOMES.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      className="bg-white"
                      rows={2}
                      placeholder="Written decision (required — this is the homeowner-visible record)"
                      value={decisionText}
                      onChange={(e) => setDecisionText(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy || !decisionText.trim()}
                        onClick={() =>
                          void run(async () => {
                            await recordDecision({
                              hearingId: h._id,
                              outcome,
                              decisionText: decisionText.trim(),
                            });
                            setDecidingId(null);
                            setDecisionText("");
                          })
                        }
                      >
                        {busy ? "Saving…" : "Save decision"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDecidingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Fines</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={!decidedHearingExists}
            title={decidedHearingExists ? undefined : "A hearing decision is required first"}
            onClick={() => setShowFineForm((s) => !s)}
          >
            {showFineForm ? "Cancel" : "Assess fine"}
          </Button>
        </div>
        {!decidedHearingExists && (
          <p className="mb-2 text-xs text-amber-700">
            Due process: a fine can only be assessed after a recorded hearing decision.
          </p>
        )}

        {showFineForm && decidedHearingExists && (
          <div className="mb-3 space-y-2 rounded-lg border bg-slate-50 p-3">
            <div className="flex flex-wrap gap-2">
              <Input
                type="number"
                className="w-28 bg-white"
                placeholder="Amount"
                value={fineAmount}
                onChange={(e) => setFineAmount(e.target.value)}
              />
              <Input
                className="flex-1 min-w-40 bg-white"
                placeholder="Reason (required)"
                value={fineReason}
                onChange={(e) => setFineReason(e.target.value)}
              />
            </div>
            <Input
              className="bg-white"
              placeholder="Rule reference, e.g. CC&R §4.2 (recommended for defensibility)"
              value={fineRule}
              onChange={(e) => setFineRule(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || !fineReason.trim()}
              onClick={() =>
                void run(async () => {
                  await assessFine({
                    caseId,
                    amount: fineAmount ? Number(fineAmount) : undefined,
                    reason: fineReason.trim(),
                    ruleReference: fineRule || undefined,
                  });
                  setShowFineForm(false);
                  setFineAmount("");
                  setFineReason("");
                  setFineRule("");
                })
              }
            >
              {busy ? "Assessing…" : "Assess"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Tracking only — payments are handled outside this system.
            </p>
          </div>
        )}

        {fines === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : fines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fines on this case.</p>
        ) : (
          <ul className="space-y-1.5">
            {fines.map((f) => (
              <li key={f._id} className="flex items-center justify-between gap-2 rounded-lg border bg-white p-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-semibold">${f.amount.toFixed(2)}</span>{" "}
                  <span className="text-slate-600">— {f.reason}</span>
                  {f.ruleReference && (
                    <span className="text-xs text-muted-foreground"> ({f.ruleReference})</span>
                  )}
                </div>
                {f.status === "assessed" ? (
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(() => satisfyFine({ fineId: f._id }))}
                    >
                      Mark satisfied
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-amber-700"
                      disabled={busy}
                      onClick={() => void run(() => waiveFine({ fineId: f._id }))}
                    >
                      Waive
                    </Button>
                  </div>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize">
                    {f.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
