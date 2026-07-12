import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { Loader2, Trash2, ArrowRightLeft } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { enqueuePhoto, enqueueNote, listPendingPhotosForProperty } from "@/offline/outbox";
import { syncNow } from "@/offline/syncManager";
import { useCachedQuery } from "@/offline/hooks";
import { FieldCaseControls } from "@/components/cases/FieldCaseControls";
import { isOnline } from "@/native/network";
import { hasNativeCamera, takePhoto, pickPhotos } from "@/native/camera";
import {
  isNativeSpeechAvailable,
  startDictation,
  stopDictation as stopNativeDictation,
} from "@/native/speech";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MovePhotoDialog } from "@/components/MovePhotoDialog";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

/** Max parallel uploads per batch (mobile uplink is usually the bottleneck; 4 is a good balance). */
const UPLOAD_CONCURRENCY = 4;

type NoteSection = "front" | "side" | "back";

const SECTIONS: NoteSection[] = ["front", "side", "back"];
const SECTION_LABEL: Record<NoteSection, string> = { front: "Front", side: "Side", back: "Back" };

/** How the walk ends for this house — drives status + the case mirror. */
type LeaveChoice = "allClear" | "followUp" | "later";

const LEAVE_OPTIONS: Array<{
  key: LeaveChoice;
  dot: string;
  title: string;
  sub: string;
}> = [
  { key: "allClear", dot: "#4a8a66", title: "All clear", sub: "Nothing to follow up on" },
  {
    key: "followUp",
    dot: "#c9a53f",
    title: "Needs follow-up",
    sub: "Flag for admin review — your note travels with it",
  },
  { key: "later", dot: "#b0b6bf", title: "Come back later", sub: "Keeps it in progress" },
];

export default function PropertyCapture() {
  const navigate = useNavigate();
  const { propertyId } = useParams<{ propertyId: string }>();
  const pid = propertyId as Id<"properties">;

  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    fail: number;
    total: number;
  } | null>(null);
  /** One stable id per file in flight → spinner tiles stay keyed until that upload finishes. */
  const [pendingSlotIds, setPendingSlotIds] = useState<string[]>([]);
  const activeUploadBatchesRef = useRef(0);
  const uploadStatsRef = useRef({ started: 0, done: 0, fail: 0 });
  const [noteFront, setNoteFront] = useState("");
  const [noteSide, setNoteSide] = useState("");
  const [noteBack, setNoteBack] = useState("");
  const [activeSection, setActiveSection] = useState<NoteSection>("front");
  const [listening, setListening] = useState(false);
  const [nextLoading, setNextLoading] = useState(false);
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [leaveSheetOpen, setLeaveSheetOpen] = useState(false);
  const [leaveChoice, setLeaveChoice] = useState<LeaveChoice>("allClear");
  const [priorOpen, setPriorOpen] = useState(false);
  const [queuedPhotos, setQueuedPhotos] = useState<Array<{ id: string; section: string }>>([]);
  const [offline, setOffline] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: Id<"photos"> } | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** For native dictation: the field text captured when listening started (partials replace onto this base). */
  const dictationBaseRef = useRef<{ section: NoteSection; base: string } | null>(null);
  const noteAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteInitializedRef = useRef(false);
  const lastPersistedNotesRef = useRef({ front: "", side: "", back: "" });
  /** Avoid re-hydrating note from Convex on every refetch (causes textarea + status flash after autosave). */
  const noteHydratedForPropertyIdRef = useRef<Id<"properties"> | null>(null);

  const liveProperty = useQuery(api.properties.get, { id: pid });
  const { data: property } = useCachedQuery(`inspector.property.${pid}`, liveProperty);
  const viewer = useQuery(api.tenancy.viewerContext, {});
  const livePhotos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const { data: photos } = useCachedQuery(`inspector.photos.${pid}`, livePhotos);
  const liveStreetData = useQuery(
    api.streets.getWithProperties,
    property?.streetId ? { streetId: property.streetId } : "skip",
  );
  // Reuse the same cache key PropertyList writes, so the walk list is warm offline.
  const { data: streetData } = useCachedQuery(
    `inspector.street.${property?.streetId ?? "none"}`,
    liveStreetData,
  );

  const clerkIdsForDisplayNames = useMemo(() => {
    if (!property) return [] as string[];
    const ids = [
      property.inspectionNotesEnteredByClerkUserId,
      property.inspectionNotesLastUpdatedByClerkUserId,
      property.inspectionDetailsVerifiedByClerkUserId,
    ].filter((x): x is string => !!x);
    return [...new Set(ids)];
  }, [property]);

  const displayNames = useQuery(
    api.members.displayNamesByClerkIds,
    clerkIdsForDisplayNames.length > 0 ? { clerkUserIds: clerkIdsForDisplayNames } : "skip",
  );

  const removePhotoForInspector = useAction(api.photos.removeForInspector);
  const updateInspectorNotes = useMutation(api.properties.updateInspectorNotes);
  const setInspectionVerification = useMutation(api.properties.setInspectionVerification);
  const updatePropertyStatus = useMutation(api.properties.updateStatus);
  const completeHouse = useMutation(api.properties.completeHouseCapture);
  const setNoViolationsConfirmed = useMutation(api.properties.setNoViolationsConfirmed);

  useEffect(() => {
    noteHydratedForPropertyIdRef.current = null;
    noteInitializedRef.current = false;
    if (noteAutosaveTimerRef.current) {
      clearTimeout(noteAutosaveTimerRef.current);
      noteAutosaveTimerRef.current = null;
    }
    setActiveSection("front");
    setPriorOpen(false);
    setLeaveChoice("allClear");
  }, [pid]);

  useEffect(() => {
    if (!property || property._id !== pid) return;
    if (noteHydratedForPropertyIdRef.current === pid) return;

    noteHydratedForPropertyIdRef.current = pid;
    const anySection =
      (property.inspectorNotesFront?.length ?? 0) +
        (property.inspectorNotesSide?.length ?? 0) +
        (property.inspectorNotesBack?.length ?? 0) >
      0;
    let initialFront = property.inspectorNotesFront ?? "";
    const initialSide = property.inspectorNotesSide ?? "";
    const initialBack = property.inspectorNotesBack ?? "";
    if (!anySection && property.inspectorNotes?.trim()) {
      initialFront = property.inspectorNotes;
    }
    setNoteFront(initialFront);
    setNoteSide(initialSide);
    setNoteBack(initialBack);
    lastPersistedNotesRef.current = { front: initialFront, side: initialSide, back: initialBack };
    noteInitializedRef.current = true;
    setNoteSaveState("idle");
    setLastSavedAt(null);
  }, [pid, property]);

  useEffect(() => {
    return () => {
      if (noteAutosaveTimerRef.current) {
        clearTimeout(noteAutosaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!noteInitializedRef.current) return;
    const cur = { front: noteFront, side: noteSide, back: noteBack };
    const last = lastPersistedNotesRef.current;
    if (cur.front === last.front && cur.side === last.side && cur.back === last.back) return;

    if (noteAutosaveTimerRef.current) clearTimeout(noteAutosaveTimerRef.current);

    noteAutosaveTimerRef.current = setTimeout(async () => {
      try {
        setNoteSaveState("saving");
        if (isOnline()) {
          await updateInspectorNotes({
            id: pid,
            inspectorNotesFront: noteFront,
            inspectorNotesSide: noteSide,
            inspectorNotesBack: noteBack,
          });
        } else {
          // Offline: queue the draft; the sync manager flushes it on reconnect.
          await enqueueNote({
            propertyId: pid,
            front: noteFront,
            side: noteSide,
            back: noteBack,
          });
        }
        lastPersistedNotesRef.current = { front: noteFront, side: noteSide, back: noteBack };
        setLastSavedAt(Date.now());
        setNoteSaveState("saved");
      } catch (err) {
        console.error("Autosave failed:", err);
        setNoteSaveState("error");
      }
    }, 1200);
  }, [noteFront, noteSide, noteBack, pid, updateInspectorNotes]);

  // Queued-photo tiles + offline chip: poll the outbox (cheap Dexie read).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const rows = await listPendingPhotosForProperty(pid);
      if (!cancelled) {
        setQueuedPhotos(rows);
        setOffline(!isOnline());
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pid]);

  const propertyPhotos = photos ?? [];

  const walkList = streetData?.properties ?? [];
  const currentIdx = walkList.findIndex((p) => p._id === pid);
  const prevProperty = currentIdx > 0 ? walkList[currentIdx - 1] : undefined;
  const nextProperty = currentIdx >= 0 ? walkList[currentIdx + 1] : undefined;

  /**
   * Persist captured photos to the local outbox (fast, offline-safe). The sync
   * manager uploads (thumbnail-first + full, concurrency-limited) and registers
   * them in Convex in the background with retry — so capture never blocks on
   * connectivity and nothing is silently lost.
   */
  const enqueueFiles = async (files: File[]) => {
    if (files.length === 0 || !propertyId) return;

    const slotIds = files.map(() => crypto.randomUUID());
    activeUploadBatchesRef.current++;
    uploadStatsRef.current.started += files.length;
    setUploadProgress({
      done: uploadStatsRef.current.done,
      fail: uploadStatsRef.current.fail,
      total: uploadStatsRef.current.started,
    });
    setPendingSlotIds((prev) => [...prev, ...slotIds]);

    try {
      await Promise.all(
        files.map(async (file, i) => {
          try {
            await enqueuePhoto({ propertyId: pid, section: activeSection, file });
            uploadStatsRef.current.done++;
          } catch (err) {
            uploadStatsRef.current.fail++;
            console.error("Failed to queue photo:", err);
          } finally {
            setPendingSlotIds((prev) => prev.filter((id) => id !== slotIds[i]));
            setUploadProgress({
              done: uploadStatsRef.current.done,
              fail: uploadStatsRef.current.fail,
              total: uploadStatsRef.current.started,
            });
          }
        }),
      );
      // Attempt an immediate flush; if offline it no-ops and syncs on reconnect.
      void syncNow();
    } finally {
      activeUploadBatchesRef.current--;
      if (activeUploadBatchesRef.current === 0) {
        setUploadProgress(null);
        uploadStatsRef.current = { started: 0, done: 0, fail: 0 };
      }
    }
  };

  const handlePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    void enqueueFiles(files);
  };

  const handleNativeCamera = async () => {
    try {
      const file = await takePhoto();
      await enqueueFiles([file]);
    } catch (err) {
      console.error("Camera capture failed:", err);
    }
  };

  const handleNativeGallery = async () => {
    try {
      const files = await pickPhotos();
      await enqueueFiles(files);
    } catch (err) {
      console.error("Gallery pick failed:", err);
    }
  };

  const openViewerAt = (index: number) => {
    setSelectedPhotoIndex(index);
    setViewerOpen(true);
  };

  const handleConfirmDeletePhoto = () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    const n = propertyPhotos.length;
    const i = selectedPhotoIndex;
    setDeleteSubmitting(true);
    void removePhotoForInspector({ id, propertyId: pid })
      .then(() => {
        setDeleteTarget(null);
        if (n <= 1) {
          setViewerOpen(false);
        } else {
          setSelectedPhotoIndex(Math.min(i, n - 2));
        }
      })
      .catch((err) => {
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        alert(
          msg.includes("upload server")
            ? `Photo was removed from the inspection, but the file on the upload server could not be deleted: ${msg}`
            : msg || "Could not delete photo. Please try again.",
        );
      })
      .finally(() => setDeleteSubmitting(false));
  };

  const selectedPhoto = propertyPhotos[selectedPhotoIndex];
  const canGoPrev = selectedPhotoIndex > 0;
  const canGoNext = selectedPhotoIndex < propertyPhotos.length - 1;

  const sectionValue: Record<NoteSection, string> = {
    front: noteFront,
    side: noteSide,
    back: noteBack,
  };
  const setSectionText = (section: NoteSection, text: string) => {
    if (section === "front") setNoteFront(text);
    else if (section === "side") setNoteSide(text);
    else setNoteBack(text);
  };

  /**
   * On-device dictation only (iOS/Android SFSpeechRecognizer / SpeechRecognizer
   * via the Capacitor plugin) — free, offline, no cloud round-trip. On web the
   * mic isn't rendered and the note is a plain text field. Partial results are
   * the running transcript, so we replace onto the text captured at start.
   */
  const stopVoice = () => {
    if (dictationBaseRef.current) {
      void stopNativeDictation();
      dictationBaseRef.current = null;
    }
    setListening(false);
  };

  const handleMic = () => {
    if (listening) {
      stopVoice();
      return;
    }
    const section = activeSection;
    const base = sectionValue[section];
    dictationBaseRef.current = { section, base };
    setListening(true);
    void startDictation(
      (transcript) => {
        const b = dictationBaseRef.current;
        if (!b || b.section !== section) return;
        setSectionText(section, b.base ? `${b.base} ${transcript}`.trim() : transcript.trim());
      },
      () => setListening(false),
    ).then((ok) => {
      if (!ok) {
        dictationBaseRef.current = null;
        setListening(false);
      }
    });
  };

  const persistNotesIfDirty = async () => {
    stopVoice();
    if (noteAutosaveTimerRef.current) {
      clearTimeout(noteAutosaveTimerRef.current);
      noteAutosaveTimerRef.current = null;
    }
    const last = lastPersistedNotesRef.current;
    if (noteFront !== last.front || noteSide !== last.side || noteBack !== last.back) {
      await updateInspectorNotes({
        id: pid,
        inspectorNotesFront: noteFront,
        inspectorNotesSide: noteSide,
        inspectorNotesBack: noteBack,
      });
      lastPersistedNotesRef.current = { front: noteFront, side: noteSide, back: noteBack };
    }
  };

  const streetIdForNav = property?.streetId;

  const navigateAfterLeave = () => {
    if (nextProperty) {
      navigate(`/inspector/property/${nextProperty._id}`);
    } else if (streetIdForNav) {
      navigate(`/inspector/street/${streetIdForNav}`);
    }
  };

  const handleConfirmLeave = async () => {
    setNextLoading(true);
    setLeaveSheetOpen(false);
    try {
      await persistNotesIfDirty();
      if (leaveChoice === "allClear") {
        // Explicitly all clear: never auto-open a case from benign notes, and
        // flag the house so letters use the no-violations template.
        await completeHouse({ id: pid, openCase: false });
        await setNoViolationsConfirmed({ id: pid, confirmed: true });
      } else if (leaveChoice === "followUp") {
        // Opens/keeps the violation case when notes exist, then lands the
        // house in "Ready to review" for the admin regardless of verification.
        if (property?.noViolationsConfirmed === true) {
          await setNoViolationsConfirmed({ id: pid, confirmed: false });
        }
        await completeHouse({ id: pid, openCase: true });
        await updatePropertyStatus({ id: pid, status: "review" });
      } else {
        await updatePropertyStatus({ id: pid, status: "inProgress" });
      }
      navigateAfterLeave();
    } catch (err) {
      console.error(err);
      alert("Could not save and continue: " + String(err));
    } finally {
      setNextLoading(false);
    }
  };

  if (!property) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper">
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-petrol" aria-hidden />
        <p className="text-sm font-medium text-ink-2">Loading property…</p>
      </div>
    );
  }

  const priorBlocks: { label: string; text: string }[] = [];
  if (property.previousInspectionSummary?.trim()) {
    priorBlocks.push({ label: "", text: property.previousInspectionSummary });
  } else {
    if (property.previousCitations2024?.trim()) {
      priorBlocks.push({ label: "2024 citations", text: property.previousCitations2024 });
    }
    if (property.previousFrontObs?.trim()) {
      priorBlocks.push({ label: "Front (prior)", text: property.previousFrontObs });
    }
    if (property.previousBackObs?.trim()) {
      priorBlocks.push({ label: "Back (prior)", text: property.previousBackObs });
    }
    if (property.previousInspectorComments?.trim()) {
      priorBlocks.push({ label: "Prior comments", text: property.previousInspectorComments });
    }
    if (property.priorCompletedWorkResponse?.trim()) {
      priorBlocks.push({ label: "2024 completed-work / follow-up", text: property.priorCompletedWorkResponse });
    }
  }
  const hasPrior = priorBlocks.length > 0 || !!property.priorOwnerLetterNotes2024?.trim();

  const nameFor = (id?: string) => (!id ? "" : displayNames?.[id]?.trim() || "Team member");
  const hasAnyNote = !!(noteFront.trim() || noteSide.trim() || noteBack.trim());
  const isVerified = !!property.inspectionDetailsVerifiedByClerkUserId;
  const queuedCount = queuedPhotos.length;
  const streetName = streetData?.street?.name ?? "Street";

  return (
    <div className="flex min-h-screen flex-col bg-paper pb-24 text-ink">
      <div
        className="sticky top-0 z-50 shrink-0 border-b bg-white"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="px-4 pb-2.5 pt-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="min-w-0 truncate text-sm font-bold"
              onClick={() => navigate(`/inspector/street/${property.streetId}`)}
            >
              {streetName}
            </button>
            {currentIdx >= 0 && (
              <span className="font-mono text-xs text-ink-2">
                {currentIdx + 1}/{walkList.length}
              </span>
            )}
            <span className="ml-auto">
              {offline ? (
                <Chip tone="wait">Offline{queuedCount > 0 ? ` · ${queuedCount} queued` : ""}</Chip>
              ) : queuedCount > 0 ? (
                <Chip tone="wait">{queuedCount} queued</Chip>
              ) : null}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-1.5 text-sm font-bold text-ink-2 disabled:opacity-40"
              disabled={!prevProperty}
              aria-label="Previous house"
              onClick={() => prevProperty && navigate(`/inspector/property/${prevProperty._id}`)}
            >
              ‹
            </button>
            <h1 className="min-w-0 flex-1 truncate text-center text-base font-bold">
              {property.address}
            </h1>
            <button
              type="button"
              className="rounded-lg border bg-white px-3 py-1.5 text-sm font-bold text-ink-2 disabled:opacity-40"
              disabled={!nextProperty}
              aria-label="Next house"
              onClick={() => nextProperty && navigate(`/inspector/property/${nextProperty._id}`)}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="hidden"
          onChange={handlePhotoSelected}
        />

        <div className="flex items-stretch gap-2.5">
          <button
            type="button"
            className={cn(
              "btn-bounce flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-petrol px-3 py-6 font-bold text-white",
              pendingSlotIds.length > 0 && "ring-2 ring-petrol/40 ring-offset-1",
            )}
            disabled={!propertyId}
            onClick={() => (hasNativeCamera() ? void handleNativeCamera() : fileInputRef.current?.click())}
          >
            <span className="text-3xl leading-none" aria-hidden>
              📷
            </span>
            <span>Capture</span>
            {uploadProgress && (
              <span className="flex items-center gap-1.5 text-xs font-normal text-white/90">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                {uploadProgress.done + uploadProgress.fail}/{uploadProgress.total}
                {uploadProgress.fail > 0 ? ` (${uploadProgress.fail} failed)` : ""} · up to{" "}
                {UPLOAD_CONCURRENCY} at a time
              </span>
            )}
          </button>
          <div className="flex w-[88px] flex-none flex-col gap-1.5">
            {SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={cn(
                  "flex-1 rounded-xl border text-xs font-semibold transition-colors",
                  activeSection === s
                    ? "border-ink bg-ink text-white"
                    : "border-border bg-white text-ink-2 hover:bg-paper",
                )}
                onClick={() => setActiveSection(s)}
              >
                {SECTION_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {hasNativeCamera() && (
          <button
            type="button"
            className="w-full text-xs font-medium text-petrol hover:underline"
            disabled={!propertyId}
            onClick={() => void handleNativeGallery()}
          >
            or choose from gallery
          </button>
        )}

        {(propertyPhotos.length > 0 || pendingSlotIds.length > 0 || queuedPhotos.length > 0) && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {propertyPhotos.map((photo, idx) => (
              <button key={photo._id} type="button" className="relative shrink-0" onClick={() => openViewerAt(idx)}>
                <img
                  src={photo.publicUrl ?? photo.thumbnailPublicUrl ?? ""}
                  alt="section photo"
                  className="h-[62px] w-[62px] cursor-zoom-in rounded-[10px] border object-cover"
                />
              </button>
            ))}
            {queuedPhotos.map((q) => (
              <div
                key={q.id}
                role="status"
                aria-label="Photo queued for sync"
                className="relative flex h-[62px] w-[62px] shrink-0 flex-col items-center justify-center rounded-[10px] border bg-secondary"
              >
                <span className="text-sm" aria-hidden>
                  ↻
                </span>
                <span className="text-[9.5px] font-bold text-[#82631c]">queued</span>
              </div>
            ))}
            {pendingSlotIds.map((slotId) => (
              <div
                key={slotId}
                role="status"
                aria-label="Saving photo"
                className="relative flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-[10px] border-2 border-dashed bg-white"
              >
                <Loader2 className="h-6 w-6 animate-spin text-petrol" aria-hidden />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-xl border bg-white px-3 py-2.5">
          <textarea
            value={sectionValue[activeSection]}
            onChange={(e) => setSectionText(activeSection, e.target.value)}
            rows={3}
            placeholder={`${SECTION_LABEL[activeSection]} note — ${
              isNativeSpeechAvailable() ? "type or talk…" : "type here…"
            }`}
            className="min-h-[4.5rem] flex-1 resize-none border-0 bg-transparent text-base focus:outline-none"
          />
          {isNativeSpeechAvailable() && (
            <button
              type="button"
              aria-label={listening ? "Stop dictation" : "Dictate note"}
              className={cn(
                "flex h-10 w-10 flex-none items-center justify-center rounded-full text-base text-white transition-colors",
                listening ? "animate-pulse bg-overdue" : "bg-petrol",
              )}
              onClick={handleMic}
            >
              {listening ? "■" : "🎙"}
            </button>
          )}
        </div>
        <div className="min-h-4 px-1 text-xs text-ink-2">
          {noteSaveState === "saving" && "Saving note…"}
          {noteSaveState === "saved" &&
            `Saved${lastSavedAt ? ` at ${new Date(lastSavedAt).toLocaleTimeString()}` : ""}`}
          {noteSaveState === "error" && "Autosave failed. Your note still saves on Next house."}
        </div>

        <div className="rounded-xl border bg-white px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-bold">Verify details</span>
            {!isVerified ? (
              <button
                type="button"
                className="ml-auto rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                disabled={!hasAnyNote}
                onClick={async () => {
                  try {
                    await persistNotesIfDirty();
                    await setInspectionVerification({ propertyId: pid, verified: true });
                  } catch (err) {
                    console.error(err);
                    alert(err instanceof Error ? err.message : "Could not update verification.");
                  }
                }}
              >
                Mark verified ✓
              </button>
            ) : (
              <button
                type="button"
                className="ml-auto text-xs font-semibold text-petrol hover:underline"
                onClick={async () => {
                  try {
                    await setInspectionVerification({ propertyId: pid, verified: false });
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Could not update verification.");
                  }
                }}
              >
                verified ✓ · clear
              </button>
            )}
          </div>
          <div className="mt-2 space-y-0.5 text-[11.5px] leading-relaxed text-ink-2">
            {property.inspectionNotesEnteredByClerkUserId && (
              <p>
                📝 Notes added — <b className="text-ink">{nameFor(property.inspectionNotesEnteredByClerkUserId)}</b>
                {property.inspectionNotesEnteredAt != null &&
                  ` · ${new Date(property.inspectionNotesEnteredAt).toLocaleDateString()}`}
              </p>
            )}
            {property.inspectionNotesLastUpdatedByClerkUserId && (
              <p>
                📝 Notes updated —{" "}
                <b className="text-ink">{nameFor(property.inspectionNotesLastUpdatedByClerkUserId)}</b>
                {property.inspectionNotesLastUpdatedAt != null &&
                  ` · ${new Date(property.inspectionNotesLastUpdatedAt).toLocaleDateString()}`}
              </p>
            )}
            {isVerified && property.inspectionDetailsVerifiedByClerkUserId ? (
              <p>
                ✓ Verified — <b className="text-ink">{nameFor(property.inspectionDetailsVerifiedByClerkUserId)}</b>
                {property.inspectionDetailsVerifiedAt != null &&
                  ` · ${new Date(property.inspectionDetailsVerifiedAt).toLocaleDateString()}`}
              </p>
            ) : (
              !property.inspectionNotesEnteredByClerkUserId &&
              !property.inspectionNotesLastUpdatedByClerkUserId && (
                <p>No activity on this house yet this season.</p>
              )
            )}
          </div>
        </div>

        {hasPrior && (
          <div className="rounded-xl border bg-white px-3.5 py-3">
            <button
              type="button"
              className="flex w-full items-center gap-2"
              onClick={() => setPriorOpen((o) => !o)}
            >
              <span className="text-[12.5px] font-semibold">📋 Previous inspection (2024)</span>
              <span className="ml-auto text-xs text-ink-2">{priorOpen ? "hide" : "view ›"}</span>
            </button>
            {priorOpen && (
              <div className="mt-2 space-y-2 border-t pt-2">
                {property.priorOwnerLetterNotes2024?.trim() && (
                  <div className="rounded-lg bg-paper p-2.5">
                    <p className="mb-1 text-xs font-semibold text-ink-2">2024 letter text on file</p>
                    <p className="whitespace-pre-wrap text-sm">{property.priorOwnerLetterNotes2024}</p>
                  </div>
                )}
                {priorBlocks.map((b, i) => (
                  <div key={`${b.label}-${i}`}>
                    {b.label ? <p className="text-xs font-semibold text-ink-2">{b.label}</p> : null}
                    <p className={`whitespace-pre-wrap text-sm ${b.label ? "mt-0.5" : ""}`}>{b.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {viewer?.features?.includes("cases") && <FieldCaseControls propertyId={pid} />}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white/95 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            className="btn-bounce w-full rounded-2xl bg-petrol px-3 py-3.5 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={nextLoading}
            onClick={() => setLeaveSheetOpen(true)}
          >
            {nextLoading ? "Saving…" : nextProperty ? "Next house ▸" : "Complete street ✓"}
          </button>
        </div>
      </div>

      <Sheet open={leaveSheetOpen} onOpenChange={setLeaveSheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="text-left">
            <SheetTitle>How did {property.address} go?</SheetTitle>
            <SheetDescription>Saves your photos &amp; note, then moves on.</SheetDescription>
          </SheetHeader>
          <div className="mt-3 flex flex-col gap-2">
            {LEAVE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-white px-3.5 py-3 text-left transition-colors",
                  leaveChoice === opt.key ? "border-2 border-petrol" : "border-border hover:bg-paper",
                )}
                onClick={() => setLeaveChoice(opt.key)}
              >
                <span
                  className="h-2.5 w-2.5 flex-none rounded-full"
                  style={{ background: opt.dot }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{opt.title}</span>
                  <span className="block text-xs text-ink-2">{opt.sub}</span>
                </span>
                {leaveChoice === opt.key && <span className="font-bold text-petrol">✓</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-bounce mt-3.5 w-full rounded-2xl bg-petrol px-3 py-3.5 text-base font-bold text-white disabled:opacity-60"
            disabled={nextLoading}
            onClick={() => void handleConfirmLeave()}
          >
            {nextProperty ? "Save & next house ▸" : "Save & complete street ✓"}
          </button>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="z-[100] max-w-[min(92vw,22rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              It will be removed from this inspection. Linked violation notes stay, but will no longer show this
              image. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogCancel className="w-full sm:w-full" disabled={deleteSubmitting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="w-full bg-red-600 text-white hover:bg-red-700 focus:ring-red-600 sm:w-full"
              disabled={deleteSubmitting}
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDeletePhoto();
              }}
            >
              {deleteSubmitting ? "Deleting…" : "Delete photo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {viewerOpen && selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewerOpen(false)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-white/20 bg-black/40 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-white">
              <p className="font-semibold">
                Photo {selectedPhotoIndex + 1} / {propertyPhotos.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-petrol px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                  onClick={() => setMoveDialogOpen(true)}
                >
                  <ArrowRightLeft className="h-4 w-4 shrink-0" aria-hidden />
                  Move
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                  onClick={() => setDeleteTarget({ id: selectedPhoto._id })}
                >
                  <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                  Delete
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-white/10 px-3 py-1 transition-colors hover:bg-white/20"
                  onClick={() => setViewerOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="relative">
              {!selectedPhoto.publicUrl && selectedPhoto.thumbnailPublicUrl ? (
                <p className="mb-2 text-center text-sm text-amber-200">
                  Full resolution still uploading — showing preview. Open again in a moment for the original file.
                </p>
              ) : null}
              <img
                src={selectedPhoto.publicUrl ?? selectedPhoto.thumbnailPublicUrl ?? ""}
                alt="full size section photo"
                className="max-h-[75vh] w-full rounded-xl bg-black object-contain"
              />
              <button
                type="button"
                disabled={!canGoPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg bg-black/50 px-3 py-2 text-white disabled:opacity-30"
                onClick={() => canGoPrev && setSelectedPhotoIndex((i) => i - 1)}
              >
                ←
              </button>
              <button
                type="button"
                disabled={!canGoNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-black/50 px-3 py-2 text-white disabled:opacity-30"
                onClick={() => canGoNext && setSelectedPhotoIndex((i) => i + 1)}
              >
                →
              </button>
            </div>
          </div>
        </div>
      )}

      {property?.streetId && (
        <MovePhotoDialog
          open={moveDialogOpen}
          onOpenChange={setMoveDialogOpen}
          photo={selectedPhoto ?? null}
          fromPropertyId={pid}
          currentStreetId={property.streetId}
          onMoved={() => {
            setMoveDialogOpen(false);
            setViewerOpen(false);
          }}
        />
      )}
    </div>
  );
}
