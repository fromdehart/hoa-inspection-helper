import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/ui/chip";
import { PROPERTY_STATUS_CHIP, parseFindings } from "@/lib/propertyUi";

type PropertyDoc = Doc<"properties">;
type PhotoDoc = Doc<"photos">;

function initialNoteDrafts(property: PropertyDoc) {
  const hasSectionFields =
    property.inspectorNotesFront !== undefined ||
    property.inspectorNotesSide !== undefined ||
    property.inspectorNotesBack !== undefined;
  const anySectionText = !!(
    property.inspectorNotesFront?.trim() ||
    property.inspectorNotesSide?.trim() ||
    property.inspectorNotesBack?.trim()
  );
  if (hasSectionFields || anySectionText) {
    return {
      front: property.inspectorNotesFront ?? "",
      side: property.inspectorNotesSide ?? "",
      back: property.inspectorNotesBack ?? "",
    };
  }
  if (property.inspectorNotes?.trim()) {
    return { front: property.inspectorNotes, side: "", back: "" };
  }
  return { front: "", side: "", back: "" };
}

/**
 * The current-season inspection: photos, AI findings first (raw field notes
 * one click behind), verify, and the letter compose step. The core loop.
 */
export function InspectionCard({
  property,
  photos,
  nameFor,
  onOpenPhoto,
  onOpenLetter,
  showToast,
}: {
  property: PropertyDoc;
  photos: PhotoDoc[];
  nameFor: (clerkUserId?: string) => string;
  onOpenPhoto: (index: number) => void;
  onOpenLetter: () => void;
  showToast: (msg: string) => void;
}) {
  const pid = property._id as Id<"properties">;

  const updateInspectorNotes = useMutation(api.properties.updateInspectorNotes);
  const setInspectionVerification = useMutation(api.properties.setInspectionVerification);
  const updateAiLetterBullets = useMutation(api.properties.updateAiLetterBullets);
  const setNoViolationsConfirmed = useMutation(api.properties.setNoViolationsConfirmed);
  const generateAiLetterBullets = useAction(api.inspectionBullets.generateFromInspectorNotes);

  const [showRawNotes, setShowRawNotes] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState({ front: "", side: "", back: "" });
  const [editingFindings, setEditingFindings] = useState(false);
  const [summarizeBusy, setSummarizeBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [noViolationsBusy, setNoViolationsBusy] = useState(false);

  // --- AI findings draft with debounced autosave (carried over from the old page) ---
  const [bulletsDraft, setBulletsDraft] = useState("");
  const [bulletsSaveState, setBulletsSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedForRef = useRef<Id<"properties"> | null>(null);
  const lastPersistedRef = useRef("");

  useEffect(() => {
    if (hydratedForRef.current === pid) return;
    hydratedForRef.current = pid;
    const initial = property.aiLetterBullets ?? "";
    setBulletsDraft(initial);
    lastPersistedRef.current = initial;
    setBulletsSaveState("idle");
    setNoteDrafts(initialNoteDrafts(property));
    setEditingNotes(false);
    setEditingFindings(false);
  }, [pid, property]);

  // Adopt server-side changes (e.g. a fresh AI summary) when the draft is clean.
  useEffect(() => {
    if (hydratedForRef.current !== pid) return;
    const server = property.aiLetterBullets ?? "";
    if (bulletsDraft === lastPersistedRef.current && server !== lastPersistedRef.current) {
      setBulletsDraft(server);
      lastPersistedRef.current = server;
      setBulletsSaveState("saved");
    }
  }, [pid, property.aiLetterBullets, bulletsDraft]);

  useEffect(() => {
    if (hydratedForRef.current !== pid) return;
    if (bulletsDraft === lastPersistedRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        setBulletsSaveState("saving");
        await updateAiLetterBullets({ id: pid, aiLetterBullets: bulletsDraft });
        lastPersistedRef.current = bulletsDraft;
        setBulletsSaveState("saved");
      } catch {
        setBulletsSaveState("error");
      }
    }, 1200);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [bulletsDraft, pid, updateAiLetterBullets]);

  const findings = parseFindings(property.aiLetterBullets);
  const hasFindings = findings.length > 0 || bulletsDraft.trim().length > 0;
  const hasAnyNote = !!(
    property.inspectorNotesFront?.trim() ||
    property.inspectorNotesSide?.trim() ||
    property.inspectorNotesBack?.trim() ||
    property.inspectorNotes?.trim()
  );
  const isVerified = !!property.inspectionDetailsVerifiedByClerkUserId;
  const noViolations = property.noViolationsConfirmed === true;
  const statusChip = PROPERTY_STATUS_CHIP[property.status];
  const walkedBy = nameFor(
    property.inspectionNotesLastUpdatedByClerkUserId ?? property.inspectionNotesEnteredByClerkUserId,
  );
  const walkedAt = property.inspectionNotesLastUpdatedAt ?? property.inspectionNotesEnteredAt;

  const handleSummarize = async () => {
    setSummarizeBusy(true);
    try {
      const r = await generateAiLetterBullets({ propertyId: pid });
      if (r.ok) showToast("Findings summarized from the field notes");
      else showToast("error" in r ? r.error : "Could not summarize the notes");
    } catch {
      showToast("Could not summarize the notes");
    } finally {
      setSummarizeBusy(false);
    }
  };

  const rawNotesBlock = (
    <div className="mt-2 rounded-lg border bg-paper p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
          Raw field notes
        </p>
        {!editingNotes ? (
          <button
            type="button"
            className="text-xs font-semibold text-petrol hover:underline"
            onClick={() => {
              setNoteDrafts(initialNoteDrafts(property));
              setEditingNotes(true);
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
                await updateInspectorNotes({
                  id: pid,
                  inspectorNotesFront: noteDrafts.front,
                  inspectorNotesSide: noteDrafts.side,
                  inspectorNotesBack: noteDrafts.back,
                });
                setEditingNotes(false);
                showToast("Field notes updated");
              }}
            >
              save
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-ink-2 hover:underline"
              onClick={() => setEditingNotes(false)}
            >
              cancel
            </button>
          </span>
        )}
      </div>
      {(["front", "side", "back"] as const).map((key) => (
        <div key={key} className="flex gap-3 border-t border-border/60 py-2 first:border-0">
          <span className="w-11 flex-none text-xs font-bold capitalize text-ink-2">{key}</span>
          {editingNotes ? (
            <Textarea
              value={noteDrafts[key]}
              onChange={(e) => setNoteDrafts((d) => ({ ...d, [key]: e.target.value }))}
              rows={2}
              className="text-sm"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm">
              {(key === "front"
                ? (property.inspectorNotesFront ?? property.inspectorNotes)
                : key === "side"
                  ? property.inspectorNotesSide
                  : property.inspectorNotesBack
              )?.trim() || <span className="text-ink-2">—</span>}
            </p>
          )}
        </div>
      ))}
      {(property.inspectionNotesEnteredByClerkUserId ||
        property.inspectionNotesLastUpdatedByClerkUserId) && (
        <p className="border-t border-border/60 pt-2 text-xs text-ink-2">
          {property.inspectionNotesEnteredByClerkUserId && (
            <>
              Added by <b className="text-ink">{nameFor(property.inspectionNotesEnteredByClerkUserId)}</b>
              {property.inspectionNotesEnteredAt != null &&
                ` · ${new Date(property.inspectionNotesEnteredAt).toLocaleDateString()}`}
            </>
          )}
          {property.inspectionNotesLastUpdatedByClerkUserId && (
            <>
              {" · last updated by "}
              <b className="text-ink">{nameFor(property.inspectionNotesLastUpdatedByClerkUserId)}</b>
              {property.inspectionNotesLastUpdatedAt != null &&
                ` · ${new Date(property.inspectionNotesLastUpdatedAt).toLocaleDateString()}`}
            </>
          )}
        </p>
      )}
    </div>
  );

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-[15px] font-bold">{new Date().getFullYear()} inspection</h2>
        <Chip tone={statusChip.tone}>{statusChip.label}</Chip>
        {walkedAt != null && (
          <span className="ml-auto text-xs text-ink-2">
            walked {new Date(walkedAt).toLocaleDateString()}
            {walkedBy && ` · ${walkedBy}`}
          </span>
        )}
      </div>

      {photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {photos.map((photo, idx) => (
            <button
              key={photo._id}
              type="button"
              className="h-[58px] w-[58px] overflow-hidden rounded-lg border transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenPhoto(idx)}
            >
              <img
                src={photo.publicUrl ?? photo.thumbnailPublicUrl ?? ""}
                alt={`Inspection photo ${idx + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 border-t pt-3">
        {hasFindings ? (
          <>
            <div className="flex items-baseline gap-2">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
                Findings — AI summarized, yours to edit
              </p>
              <span className="ml-auto flex gap-3">
                {!editingFindings ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-petrol hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={noViolations}
                    onClick={() => setEditingFindings(true)}
                  >
                    edit
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-semibold text-petrol hover:underline"
                    onClick={() => setEditingFindings(false)}
                  >
                    done
                  </button>
                )}
                <button
                  type="button"
                  className="text-xs font-semibold text-petrol hover:underline"
                  onClick={() => setShowRawNotes((s) => !s)}
                >
                  {showRawNotes ? "hide raw notes" : "view raw notes ›"}
                </button>
              </span>
            </div>
            {editingFindings ? (
              <>
                <Textarea
                  value={bulletsDraft}
                  onChange={(e) => setBulletsDraft(e.target.value)}
                  rows={5}
                  className="mt-2 text-sm"
                  placeholder="One finding per line."
                />
                <p className="mt-1 min-h-4 text-xs text-ink-2">
                  {bulletsSaveState === "saving" && "Saving…"}
                  {bulletsSaveState === "saved" && "Saved"}
                  {bulletsSaveState === "error" && "Autosave failed — keep editing to retry."}
                </p>
              </>
            ) : (
              <ul className="mt-1">
                {parseFindings(bulletsDraft || property.aiLetterBullets).map((f, i) => (
                  <li
                    key={i}
                    className="flex gap-2.5 border-b border-border/60 py-1.5 text-[13px] last:border-0"
                  >
                    <span className="flex-none text-petrol">•</span>
                    {f}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                className="text-xs text-ink-2 hover:text-ink hover:underline"
                disabled={summarizeBusy || !hasAnyNote || noViolations}
                onClick={handleSummarize}
              >
                {summarizeBusy ? "Re-summarizing…" : "↻ Re-summarize from notes"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
                Field notes
              </p>
              {hasAnyNote && (
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={summarizeBusy || noViolations}
                  onClick={handleSummarize}
                >
                  {summarizeBusy ? "Summarizing…" : "Summarize with AI"}
                </Button>
              )}
            </div>
            {hasAnyNote ? (
              rawNotesBlock
            ) : (
              <p className="mt-2 text-sm text-ink-2">
                No notes from the field yet — this house hasn't been walked this season.
              </p>
            )}
          </>
        )}
        {hasFindings && showRawNotes && rawNotesBlock}
      </div>

      <div className="mt-3 border-t pt-3">
        <label className="flex items-start gap-2 rounded-lg border bg-paper px-3 py-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
            checked={noViolations}
            disabled={noViolationsBusy}
            onChange={async (e) => {
              setNoViolationsBusy(true);
              try {
                await setNoViolationsConfirmed({ id: pid, confirmed: e.target.checked });
                showToast(
                  e.target.checked
                    ? "Marked as no violations — the no-violations letter template will be used"
                    : "No-violations flag cleared",
                );
              } catch (err) {
                showToast(
                  err instanceof Error ? err.message : "Could not update no-violations flag",
                );
              } finally {
                setNoViolationsBusy(false);
              }
            }}
          />
          <span className="text-sm font-semibold">No violations</span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onOpenLetter}>
          {property.letterSentAt
            ? "Inspection letter ▸"
            : property.generatedLetterAt
              ? "Review letter draft ▸"
              : "Generate inspection letter ▸"}
        </Button>
        {!isVerified ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!hasAnyNote || verifyBusy}
            title={hasAnyNote ? undefined : "Add field notes before verifying"}
            onClick={async () => {
              setVerifyBusy(true);
              try {
                await setInspectionVerification({ propertyId: pid, verified: true });
                showToast("Inspection marked verified");
              } catch (err) {
                showToast(err instanceof Error ? err.message : "Could not verify");
              } finally {
                setVerifyBusy(false);
              }
            }}
          >
            Mark verified ✓
          </Button>
        ) : (
          <span className="text-xs text-ink-2">
            Verified by <b className="text-ink">{nameFor(property.inspectionDetailsVerifiedByClerkUserId)}</b>
            {property.inspectionDetailsVerifiedAt != null &&
              ` · ${new Date(property.inspectionDetailsVerifiedAt).toLocaleDateString()}`}
            <button
              type="button"
              className="ml-2 font-semibold text-petrol hover:underline"
              onClick={async () => {
                await setInspectionVerification({ propertyId: pid, verified: false });
                showToast("Verification cleared");
              }}
            >
              clear
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
