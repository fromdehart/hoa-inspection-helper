import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import type { ArcReviewFeedback } from "../../../convex/lib/arcReviewJson";
import { uploadArcApplicationFile } from "@/lib/uploadClient";
import { extractPdfTextWithOcrFallback, fileToBase64 } from "@/lib/extractPdfText";
import { Button } from "@/components/ui/button";

type ArcPendingFile = {
  fileName: string;
  fileType: "pdf" | "docx";
  sourcePublicUrl: string;
  sourceFilePath: string;
  parsedText: string;
};

export const VERDICT_LABEL: Record<NonNullable<ArcReviewFeedback["verdict"]>, string> = {
  likelyApproved: "Likely approvable",
  needsMoreInformation: "Needs more information",
  likelyDenied: "Likely conflicts with stated rules",
  uncertain: "Uncertain / needs staff review",
};

export function parseStoredFeedback(json: string | undefined): ArcReviewFeedback | null {
  if (!json?.trim()) return null;
  try {
    const parsed = JSON.parse(json) as Partial<ArcReviewFeedback> & { missingInformation?: unknown };
    const mustHaveNow = Array.isArray(parsed.mustHaveNow)
      ? parsed.mustHaveNow.filter((x): x is string => typeof x === "string")
      : Array.isArray(parsed.missingInformation)
        ? parsed.missingInformation.filter((x): x is string => typeof x === "string")
        : [];
    const helpfulButOptional = Array.isArray(parsed.helpfulButOptional)
      ? parsed.helpfulButOptional.filter((x): x is string => typeof x === "string")
      : [];
    const citationsToRules = Array.isArray(parsed.citationsToRules)
      ? parsed.citationsToRules.filter((x): x is string => typeof x === "string")
      : [];
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";
    const verdict = parsed.verdict;
    if (!verdict || !VERDICT_LABEL[verdict]) return null;
    return { verdict, mustHaveNow, helpfulButOptional, rationale, citationsToRules };
  } catch {
    return null;
  }
}

/**
 * ARC application upload + AI-review flow, extracted unchanged from the old
 * PropertyReview page. Rendered from the property page's Requests area.
 */
export function ArcApplicationsSection({
  propertyId,
  showToast,
}: {
  propertyId: Id<"properties">;
  showToast: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const pid = propertyId;

  const [arcPendingFiles, setArcPendingFiles] = useState<ArcPendingFile[]>([]);
  const [arcUploadBusy, setArcUploadBusy] = useState(false);
  const [arcCreateBusy, setArcCreateBusy] = useState(false);
  const [arcReviewBusyId, setArcReviewBusyId] = useState<Id<"arcApplicationSubmissions"> | null>(null);

  const arcRefDocs = useQuery(api.arcReferenceDocs.list, {});
  const arcSubmissions = useQuery(api.arcApplications.listByProperty, { propertyId: pid });
  const createArcSubmission = useMutation(api.arcApplications.createSubmission);
  const removeArcSubmission = useMutation(api.arcApplications.removeSubmission);
  const parseDocxBase64 = useAction(api.arcDocIngest.parseDocxBase64);
  const runArcReview = useAction(api.arcApplicationReview.runReview);

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-2">
        HOA reference library: <strong>{arcRefDocs?.length ?? "…"}</strong> document
        {(arcRefDocs?.length ?? 0) === 1 ? "" : "s"}. Add or manage files in{" "}
        <button
          type="button"
          className="font-medium text-petrol hover:underline"
          onClick={() => navigate("/admin/settings")}
        >
          Settings
        </button>
        .
      </p>
      <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
        AI assist is informational only. It does not replace the committee, legal counsel, or
        recorded decisions.
      </p>

      <div className="space-y-2 rounded border p-3">
        <p className="text-sm font-medium">New submission — add files</p>
        <p className="text-xs text-ink-2">
          PDF or DOCX. Text-based PDFs extract quickly; scanned PDFs run automatic OCR (slower,
          first use downloads the OCR engine). Add one or more files, then save as one submission.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={arcUploadBusy} asChild>
            <label className="cursor-pointer">
              {arcUploadBusy ? "Processing…" : "Add files"}
              <input
                type="file"
                multiple
                accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={async (e) => {
                  const list = e.target.files;
                  if (!list?.length) return;
                  // Copy before clearing input — clearing `value` empties the live FileList in browsers.
                  const files = Array.from(list);
                  e.target.value = "";
                  setArcUploadBusy(true);
                  try {
                    const next: ArcPendingFile[] = [...arcPendingFiles];
                    for (const file of files) {
                      const up = await uploadArcApplicationFile(String(pid), file);
                      const fileType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
                      let parsedText = "";
                      if (fileType === "pdf") {
                        try {
                          const { text } = await extractPdfTextWithOcrFallback(file);
                          parsedText = text;
                        } catch (err) {
                          showToast(`Skipped ${file.name}: ${String(err)}`);
                          continue;
                        }
                      } else {
                        const b64 = await fileToBase64(file);
                        const parsed = await parseDocxBase64({ fileBase64: b64 });
                        if (parsed.error || !parsed.text.trim()) {
                          showToast(`Skipped ${file.name}: ${parsed.error ?? "empty DOCX"}`);
                          continue;
                        }
                        parsedText = parsed.text;
                      }
                      next.push({
                        fileName: file.name,
                        fileType,
                        sourcePublicUrl: up.publicUrl,
                        sourceFilePath: up.filePath,
                        parsedText,
                      });
                    }
                    setArcPendingFiles(next);
                    if (next.length > arcPendingFiles.length) showToast("Files added to package");
                  } catch {
                    showToast("Failed to add files");
                  } finally {
                    setArcUploadBusy(false);
                  }
                }}
              />
            </label>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={arcPendingFiles.length === 0 || arcCreateBusy}
            onClick={async () => {
              if (arcPendingFiles.length === 0) return;
              setArcCreateBusy(true);
              try {
                await createArcSubmission({ propertyId: pid, files: arcPendingFiles });
                setArcPendingFiles([]);
                showToast("ARC submission saved");
              } catch (err) {
                showToast(String(err));
              } finally {
                setArcCreateBusy(false);
              }
            }}
          >
            {arcCreateBusy ? "Saving…" : "Save submission"}
          </Button>
          {arcPendingFiles.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setArcPendingFiles([])}>
              Clear package
            </Button>
          )}
        </div>
        {arcPendingFiles.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-2">
            {arcPendingFiles.map((f, i) => (
              <li key={`${f.fileName}-${i}`}>{f.fileName}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 rounded border p-3">
        <p className="text-sm font-medium">Submissions</p>
        {!arcSubmissions?.length ? (
          <p className="text-xs text-ink-2">No submissions yet.</p>
        ) : (
          <ul className="space-y-3">
            {arcSubmissions.map((sub) => {
              const fb = parseStoredFeedback(sub.aiFeedbackJson);
              const busy = arcReviewBusyId === sub._id;
              return (
                <li key={sub._id} className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="text-xs text-ink-2">
                      {new Date(sub.createdAt).toLocaleString()} · {sub.status}
                      {sub.verdict ? ` · ${VERDICT_LABEL[sub.verdict]}` : ""}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={
                          busy || sub.status === "reviewing" || !sub.files.some((f) => f.parsedText.trim())
                        }
                        onClick={async () => {
                          setArcReviewBusyId(sub._id);
                          try {
                            const r = await runArcReview({ submissionId: sub._id });
                            if (r.ok) showToast("AI review complete");
                            else showToast("error" in r ? r.error : "Review failed");
                          } catch {
                            showToast("Review failed");
                          } finally {
                            setArcReviewBusyId(null);
                          }
                        }}
                      >
                        {busy || sub.status === "reviewing" ? "Reviewing…" : "Run AI review"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => removeArcSubmission({ id: sub._id })}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {sub.promptHadTruncation && (
                    <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      Some reference or application text was truncated before sending to the model.
                    </p>
                  )}
                  {sub.status === "error" && sub.aiError && (
                    <p className="text-xs text-red-600">{sub.aiError}</p>
                  )}
                  {fb && (
                    <div className="mt-1 space-y-2 border-t pt-2 text-xs">
                      <p>
                        <span className="font-semibold">Verdict:</span> {VERDICT_LABEL[fb.verdict]}
                      </p>
                      {fb.mustHaveNow.length > 0 && (
                        <div>
                          <p className="font-semibold">Must-have now</p>
                          <ul className="list-disc pl-4">
                            {fb.mustHaveNow.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {fb.helpfulButOptional.length > 0 && (
                        <div>
                          <p className="font-semibold">Helpful but optional</p>
                          <ul className="list-disc pl-4">
                            {fb.helpfulButOptional.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {fb.citationsToRules.length > 0 && (
                        <div>
                          <p className="font-semibold">Rule references</p>
                          <ul className="list-disc pl-4">
                            {fb.citationsToRules.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">
                        <span className="font-semibold">Rationale:</span> {fb.rationale}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
