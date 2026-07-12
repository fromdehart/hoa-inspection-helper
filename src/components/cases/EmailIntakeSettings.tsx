import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Email-intake settings: the HOA's intake address + the approved-senders
 * allowlist. Staff/homeowner emails are implicitly approved; anything else
 * quarantines unless listed here.
 */
export function EmailIntakeSettings({ hoaSlug }: { hoaSlug: string }) {
  const senders = useQuery(api.emailIntake.listApprovedSenders, {});
  const approveSender = useMutation(api.emailIntake.approveSender);
  const removeSender = useMutation(api.emailIntake.removeSender);

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Display-only; the canonical domain lives in Convex env (INBOUND_EMAIL_DOMAIN).
  const intakeAddress = `cases-${hoaSlug}@in.happierblock.com`;

  const handleAdd = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await approveSender({ email: email.trim(), label: label.trim() || undefined });
      setEmail("");
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add sender.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3">
        <p className="text-xs text-muted-foreground">Intake address (cc or forward emails here)</p>
        <p className="mt-0.5 font-mono text-sm font-semibold text-gray-800">{intakeAddress}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Emails can only <strong>add information</strong> to a case — they can never advance a
          stage, send a notice, or assess a fine. Unknown senders are quarantined for your review,
          and admins + board members are notified of every email-driven update.
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-semibold text-gray-800">Approved senders</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Staff, board, and homeowner-of-record emails are approved automatically. Add extra
          senders (e.g. a landscaping vendor or an attorney) here.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            className="w-64"
            type="email"
            placeholder="sender@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            className="w-44"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button size="sm" onClick={() => void handleAdd()} disabled={busy || !email.trim()}>
            {busy ? "Adding…" : "Approve sender"}
          </Button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

        <ul className="mt-3 space-y-1">
          {(senders ?? []).map((s) => (
            <li key={s._id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{s.email}</span>
                {s.label && <span className="text-muted-foreground"> · {s.label}</span>}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() => void removeSender({ id: s._id })}
              >
                Remove
              </Button>
            </li>
          ))}
          {senders !== undefined && senders.length === 0 && (
            <li className="text-xs text-muted-foreground">No extra approved senders.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
