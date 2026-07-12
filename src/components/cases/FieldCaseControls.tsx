import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCachedQuery } from "@/offline/hooks";
import { enqueueCaseEvent } from "@/offline/outbox";
import { syncNow } from "@/offline/syncManager";
import { Chip } from "@/components/ui/chip";
import { CASE_STATUS_CHIP, stageDisplay, type CaseStatus } from "@/lib/caseUi";

/**
 * Inspector field controls: open a case / add an observation from the walk.
 * Writes go through the offline outbox (never straight to the server) so
 * capture works with no signal; the sync manager drains case events before
 * photos. Case list is cached for offline browsing.
 */
export function FieldCaseControls({ propertyId }: { propertyId: Id<"properties"> }) {
  const liveCases = useQuery(api.cases.listForProperty, { propertyId });
  const { data: cases } = useCachedQuery(`inspector.cases.${propertyId}`, liveCases);

  const [mode, setMode] = useState<"idle" | "open" | "note">("idle");
  const [title, setTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteCaseId, setNoteCaseId] = useState<string>("");
  const [flash, setFlash] = useState<string | null>(null);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  const openCases = (cases ?? []).filter(
    (c) => c.status === "open" || c.status === "awaitingHomeowner" || c.status === "escalated",
  );

  const handleOpenCase = async () => {
    if (!title.trim()) return;
    await enqueueCaseEvent({
      propertyId,
      action: "openCase",
      payload: { caseType: "violation", title: title.trim() },
    });
    setTitle("");
    setMode("idle");
    showFlash("Case queued — it syncs when you're online.");
    void syncNow();
  };

  const handleAddNote = async () => {
    const targetCaseId = noteCaseId || openCases[0]?._id;
    if (!noteText.trim() || !targetCaseId) return;
    await enqueueCaseEvent({
      propertyId,
      action: "addNote",
      payload: { caseId: targetCaseId, text: noteText.trim(), visibility: "shared" },
    });
    setNoteText("");
    setMode("idle");
    showFlash("Observation queued — it syncs when you're online.");
    void syncNow();
  };

  return (
    <div className="space-y-3 rounded-xl border bg-white px-3.5 py-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[12.5px] font-bold">Open items</h2>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={mode === "open" ? "outline" : "default"}
            onClick={() => setMode(mode === "open" ? "idle" : "open")}
          >
            {mode === "open" ? "Cancel" : "Open case"}
          </Button>
          {openCases.length > 0 && (
            <Button
              size="sm"
              variant={mode === "note" ? "outline" : "secondary"}
              onClick={() => setMode(mode === "note" ? "idle" : "note")}
            >
              {mode === "note" ? "Cancel" : "Add observation"}
            </Button>
          )}
        </div>
      </div>

      {flash && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-xs font-medium text-green-800">{flash}</p>
      )}

      {mode === "open" && (
        <div className="space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What did you find? (e.g. Fence needs staining)"
          />
          <Button size="sm" onClick={() => void handleOpenCase()} disabled={!title.trim()}>
            Queue case
          </Button>
        </div>
      )}

      {mode === "note" && (
        <div className="space-y-2">
          {openCases.length > 1 && (
            <select
              value={noteCaseId || openCases[0]?._id}
              onChange={(e) => setNoteCaseId(e.target.value)}
              className="w-full rounded-lg border px-2.5 py-2 text-sm"
            >
              {openCases.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Observation…"
            rows={2}
          />
          <Button size="sm" onClick={() => void handleAddNote()} disabled={!noteText.trim()}>
            Queue observation
          </Button>
        </div>
      )}

      {(cases ?? []).length > 0 ? (
        <ul>
          {(cases ?? []).map((c) => (
            <li
              key={c._id}
              className="flex items-center gap-2.5 border-t border-border/60 py-2 text-sm first:border-0"
            >
              <Chip tone={CASE_STATUS_CHIP[c.status as CaseStatus].tone}>
                {CASE_STATUS_CHIP[c.status as CaseStatus].label}
              </Chip>
              <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{c.title}</p>
              <p className="text-xs text-ink-2">{stageDisplay(c.stageKey)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-2">Nothing on file for this household.</p>
      )}
    </div>
  );
}
