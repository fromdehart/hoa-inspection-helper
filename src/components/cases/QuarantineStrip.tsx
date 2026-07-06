import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "Needs filing": quarantined intake emails (unknown sender or no confident
 * property match). Admin files them onto a property — the only path a
 * quarantined email has into the record — or rejects them.
 */
export function QuarantineStrip() {
  const quarantined = useQuery(api.emailIntake.listQuarantined, {});
  const properties = useQuery(api.properties.list, {});
  const fileQuarantined = useMutation(api.emailIntake.fileQuarantined);
  const rejectQuarantined = useMutation(api.emailIntake.rejectQuarantined);

  const [filing, setFiling] = useState<{
    id: Id<"inboundEmails">;
    from: string;
    subject: string;
    body: string;
  } | null>(null);
  const [propertyId, setPropertyId] = useState<string>("");
  const [approveSender, setApproveSender] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!quarantined || quarantined.length === 0) return null;

  const handleFile = async () => {
    if (!filing || !propertyId) return;
    setBusy(true);
    setError(null);
    try {
      await fileQuarantined({
        inboundEmailId: filing.id,
        propertyId: propertyId as Id<"properties">,
        alsoApproveSender: approveSender || undefined,
      });
      setFiling(null);
      setPropertyId("");
      setApproveSender(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not file email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-amber-800">
        ✉️ Needs filing ({quarantined.length})
      </h2>
      <ul className="space-y-1.5">
        {quarantined.map((q) => (
          <li key={q._id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <span className="font-semibold text-amber-900">{q.subject || "(no subject)"}</span>{" "}
              <span className="text-amber-700">from {q.from}</span>
              {q.aiSummary && <p className="text-xs text-amber-700">{q.aiSummary}</p>}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setFiling({ id: q._id, from: q.from, subject: q.subject, body: q.textBody })
                }
              >
                File
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() => void rejectQuarantined({ inboundEmailId: q._id })}
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={filing !== null} onOpenChange={(o) => !o && setFiling(null)}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>File email to a property</DialogTitle>
          </DialogHeader>
          {filing && (
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-sm font-semibold">{filing.subject || "(no subject)"}</p>
                <p className="text-xs text-muted-foreground">from {filing.from}</p>
                <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-600">
                  {filing.body}
                </p>
              </div>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="w-full rounded-lg border px-2.5 py-2 text-sm"
              >
                <option value="">Choose property…</option>
                {(properties ?? []).map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.address}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={approveSender}
                  onChange={(e) => setApproveSender(e.target.checked)}
                />
                Also approve {filing.from} for future emails
              </label>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => void handleFile()} disabled={busy || !propertyId}>
              {busy ? "Filing…" : "File to case record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
