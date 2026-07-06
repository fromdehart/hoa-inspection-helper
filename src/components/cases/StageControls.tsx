import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Advance stage" + notices controls for a case. Options come from
 * cases.getStageOptions (same gate logic the mutation enforces), so disabled
 * entries show exactly why they're blocked.
 */
export function StageControls({ caseId }: { caseId: Id<"cases"> }) {
  const stageOptions = useQuery(api.cases.getStageOptions, { caseId });
  const notices = useQuery(api.notices.listForCase, { caseId });
  const transitionStage = useMutation(api.cases.transitionStage);
  const generateNotice = useMutation(api.notices.generateForStage);
  const sendNotice = useAction(api.notices.send);
  const [previewNoticeId, setPreviewNoticeId] = useState<Id<"notices"> | null>(null);
  const previewHtml = useQuery(
    api.notices.getHtml,
    previewNoticeId ? { noticeId: previewNoticeId } : "skip",
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doTransition = async (toStageKey: string) => {
    setBusy(toStageKey);
    setError(null);
    try {
      await transitionStage({ caseId, toStageKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change stage.");
    } finally {
      setBusy(null);
    }
  };

  const doGenerateNotice = async () => {
    setBusy("generate");
    setError(null);
    try {
      const noticeId = await generateNotice({ caseId });
      setPreviewNoticeId(noticeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate notice.");
    } finally {
      setBusy(null);
    }
  };

  const doSendNotice = async (noticeId: Id<"notices">) => {
    setBusy(noticeId);
    setError(null);
    try {
      const result = await sendNotice({ noticeId });
      if (!result.success) setError(result.error ?? "Send failed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send notice.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Stage</h3>
        {stageOptions === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ol className="space-y-1">
            {stageOptions.map((opt) => (
              <li key={opt.key} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span
                    className={
                      opt.isCurrent
                        ? "text-sm font-semibold text-slate-900"
                        : "text-sm text-slate-600"
                    }
                  >
                    {opt.isCurrent ? "▸ " : ""}
                    {opt.label}
                    {opt.dueInDays ? (
                      <span className="text-xs text-muted-foreground"> · {opt.dueInDays}d window</span>
                    ) : null}
                  </span>
                  {!opt.isCurrent && !opt.allowed && opt.unmetGates.length > 0 && (
                    <p className="text-xs text-amber-700">{opt.unmetGates.join("; ")}</p>
                  )}
                </div>
                {!opt.isCurrent && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!opt.allowed || busy !== null}
                    onClick={() => void doTransition(opt.key)}
                  >
                    {busy === opt.key ? "Moving…" : "Move here"}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Notices</h3>
          <Button size="sm" onClick={() => void doGenerateNotice()} disabled={busy !== null}>
            {busy === "generate" ? "Generating…" : "Generate notice"}
          </Button>
        </div>
        {notices === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : notices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notices yet for this case.</p>
        ) : (
          <ul className="space-y-1.5">
            {notices.map((n) => (
              <li key={n._id} className="flex items-center justify-between gap-2 text-sm">
                <div>
                  <span className="font-medium">{n.stageKey}</span>{" "}
                  <span
                    className={
                      n.deliveryStatus === "sent" || n.deliveryStatus === "delivered"
                        ? "text-green-700"
                        : n.deliveryStatus === "failed"
                          ? "text-red-600"
                          : "text-muted-foreground"
                    }
                  >
                    · {n.deliveryStatus}
                    {n.sentAt ? ` ${new Date(n.sentAt).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setPreviewNoticeId(n._id)}>
                    View
                  </Button>
                  {(n.deliveryStatus === "draft" || n.deliveryStatus === "failed") && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void doSendNotice(n._id)}
                    >
                      {busy === n._id ? "Sending…" : "Send"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <Dialog open={previewNoticeId !== null} onOpenChange={(o) => !o && setPreviewNoticeId(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Notice preview</DialogTitle>
          </DialogHeader>
          {previewHtml ? (
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: previewHtml.html }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
