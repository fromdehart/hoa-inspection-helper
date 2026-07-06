import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { CaseTimeline } from "@/components/cases/CaseTimeline";
import { StageControls } from "@/components/cases/StageControls";
import { HearingsFines } from "@/components/cases/HearingsFines";
import {
  CASE_STATUS_CONFIG,
  CASE_TYPE_LABEL,
  stageLabel,
  type CaseStatus,
  type CaseType,
} from "@/lib/caseUi";

/**
 * Case drawer: header (title, type, stage, status, deadline) + add-note form +
 * append-only timeline. Stage controls arrive in Phase 2.
 */
export function CaseDetail({
  caseId,
  open,
  onOpenChange,
}: {
  caseId: Id<"cases"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const caseDoc = useQuery(api.cases.get, caseId ? { caseId } : "skip");
  const addNote = useMutation(api.cases.addNote);
  const [noteText, setNoteText] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"shared" | "internal">("shared");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddNote = async () => {
    if (!caseId || !noteText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await addNote({ caseId, text: noteText.trim(), visibility: noteVisibility });
      setNoteText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add note.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {!caseDoc ? (
          <p className="mt-8 text-sm text-muted-foreground">Loading case…</p>
        ) : (
          <>
            <SheetHeader className="text-left">
              <SheetTitle>{caseDoc.title}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <StatusChip config={CASE_STATUS_CONFIG[caseDoc.status as CaseStatus]} />
                  <span className="text-xs text-muted-foreground">
                    {CASE_TYPE_LABEL[caseDoc.caseType as CaseType]} · Stage:{" "}
                    {stageLabel(caseDoc.stageKey)}
                  </span>
                  {caseDoc.actionDueAt && (
                    <span
                      className={
                        caseDoc.actionDueAt < Date.now()
                          ? "text-xs font-medium text-red-600"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      Due {new Date(caseDoc.actionDueAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </SheetDescription>
            </SheetHeader>

            {caseDoc.description && (
              <p className="mt-3 text-sm text-slate-600">{caseDoc.description}</p>
            )}

            <div className="mt-4 rounded-xl border bg-white p-3">
              <StageControls caseId={caseDoc._id} />
            </div>

            <div className="mt-4 rounded-xl border bg-white p-3">
              <HearingsFines caseId={caseDoc._id} />
            </div>

            <div className="mt-4 space-y-2 rounded-xl border bg-slate-50 p-3">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note to the case record…"
                rows={2}
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={noteVisibility === "internal"}
                    onChange={(e) => setNoteVisibility(e.target.checked ? "internal" : "shared")}
                  />
                  Internal only (hidden from homeowner)
                </label>
                <Button size="sm" onClick={handleAddNote} disabled={saving || !noteText.trim()}>
                  {saving ? "Adding…" : "Add note"}
                </Button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            <div className="mt-5">
              <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
              <CaseTimeline caseId={caseDoc._id} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
