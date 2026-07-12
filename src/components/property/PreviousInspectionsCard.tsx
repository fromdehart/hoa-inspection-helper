import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { Textarea } from "@/components/ui/textarea";

type PropertyDoc = Doc<"properties">;

const READONLY_BLOCKS: Array<{ key: keyof PropertyDoc; label: string }> = [
  { key: "previousCitations2024", label: "Citations" },
  { key: "previousFrontObs", label: "Front observations" },
  { key: "previousBackObs", label: "Back observations" },
  { key: "previousInspectorComments", label: "Inspector comments" },
  { key: "priorCompletedWorkResponse", label: "Completed-work response" },
];

/**
 * The inspection record from prior seasons. Today's data holds exactly one
 * archive (the 2024 columns); a real seasons model is deliberately deferred.
 */
export function PreviousInspectionsCard({
  property,
  showToast,
}: {
  property: PropertyDoc;
  showToast: (msg: string) => void;
}) {
  const updateAdminPropertyFields = useMutation(api.properties.updateAdminPropertyFields);

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [letterDraft, setLetterDraft] = useState("");

  const readonlyBlocks = READONLY_BLOCKS.map((b) => ({
    ...b,
    value: (property[b.key] as string | undefined)?.trim() ?? "",
  })).filter((b) => b.value);
  const summary = property.previousInspectionSummary?.trim() ?? "";
  const priorLetter = property.priorOwnerLetterNotes2024?.trim() ?? "";

  const noteCount = readonlyBlocks.length + (summary ? 1 : 0);
  const teaser =
    noteCount === 0 && !priorLetter
      ? "all clear"
      : [noteCount > 0 ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : null, priorLetter ? "letter on file" : null]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="rounded-xl border bg-white">
      <button
        type="button"
        className="flex w-full items-baseline gap-2.5 px-4 py-3 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <h2 className="text-[13px] font-bold">Previous inspection (2024)</h2>
        <span className="text-xs text-ink-2">{teaser}</span>
        <span className="ml-auto text-xs font-semibold text-petrol">
          {expanded ? "hide" : "view ›"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-4 py-3">
          {readonlyBlocks.map((b) => (
            <div key={b.key as string}>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-2">{b.label}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{b.value}</p>
            </div>
          ))}

          <div>
            <div className="flex items-center gap-2">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
                Summary &amp; prior letter
              </p>
              {!editing ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-petrol hover:underline"
                  onClick={() => {
                    setSummaryDraft(summary);
                    setLetterDraft(priorLetter);
                    setEditing(true);
                  }}
                >
                  edit
                </button>
              ) : (
                <span className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-petrol hover:underline"
                    onClick={async () => {
                      await updateAdminPropertyFields({
                        id: property._id,
                        previousInspectionSummary: summaryDraft,
                        priorOwnerLetterNotes2024: letterDraft,
                      });
                      setEditing(false);
                      showToast("Previous-inspection record updated");
                    }}
                  >
                    save
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-ink-2 hover:underline"
                    onClick={() => setEditing(false)}
                  >
                    cancel
                  </button>
                </span>
              )}
            </div>
            {editing ? (
              <div className="mt-2 space-y-2">
                <Textarea
                  value={summaryDraft}
                  onChange={(e) => setSummaryDraft(e.target.value)}
                  rows={3}
                  placeholder="Previous inspection summary"
                  className="text-sm"
                />
                <Textarea
                  value={letterDraft}
                  onChange={(e) => setLetterDraft(e.target.value)}
                  rows={3}
                  placeholder="2024 letter text on file"
                  className="text-sm"
                />
              </div>
            ) : (
              <div className="mt-1 space-y-2 text-sm">
                <p className="whitespace-pre-wrap">{summary || <span className="text-ink-2">No summary on file.</span>}</p>
                {priorLetter && (
                  <p className="whitespace-pre-wrap border-t border-border/60 pt-2 text-ink-2">
                    {priorLetter}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
