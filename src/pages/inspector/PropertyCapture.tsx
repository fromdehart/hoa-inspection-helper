import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { buildInspectorThumbnailJpeg } from "@/lib/thumbnailImage";
import { uploadPhoto } from "@/lib/uploadClient";
import { runPool } from "@/lib/runPool";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Max parallel uploads per batch (mobile uplink is usually the bottleneck; 4 is a good balance). */
const UPLOAD_CONCURRENCY = 4;

/** Single bucket for new uploads; legacy side/back photos still list with property photos. */
const UPLOAD_SECTION = "front" as const;

type PropertyStatus = "notStarted" | "inProgress" | "review" | "complete";

type NoteSection = "front" | "side" | "back";

/** Dot on header trigger + small swatch in menu rows. */
const STATUS_DOT: Record<PropertyStatus, string> = {
  notStarted: "bg-slate-300 shadow-inner ring-1 ring-slate-500/35",
  /** Amber reads clearly on the cyan inspector header (avoids blue-on-blue). */
  inProgress: "bg-amber-300 shadow-inner ring-1 ring-amber-600/40",
  review: "bg-violet-400 shadow-inner ring-1 ring-violet-700/35",
  complete: "bg-emerald-400 shadow-inner ring-1 ring-emerald-700/35",
};

/** Dropdown row backgrounds (warm middle step matches yellow/amber, not sky blue). */
const STATUS_THEME: Record<PropertyStatus, { full: string; menuBtn: string }> = {
  notStarted: {
    full: "Not started",
    menuBtn:
      "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold bg-slate-100 text-slate-900 hover:bg-slate-200/90 active:bg-slate-200 transition-colors",
  },
  inProgress: {
    full: "In progress",
    menuBtn:
      "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold bg-amber-100 text-amber-950 hover:bg-amber-200/90 active:bg-amber-200 transition-colors",
  },
  review: {
    full: "Review",
    menuBtn:
      "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold bg-violet-100 text-violet-950 hover:bg-violet-200/90 active:bg-violet-200 transition-colors",
  },
  complete: {
    full: "Complete",
    menuBtn:
      "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold bg-emerald-100 text-emerald-950 hover:bg-emerald-200/90 active:bg-emerald-200 transition-colors",
  },
};

const STATUS_ORDER: PropertyStatus[] = ["notStarted", "inProgress", "review", "complete"];

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
  const [listeningSection, setListeningSection] = useState<NoteSection | null>(null);
  const [aiSectionOpen, setAiSectionOpen] = useState(false);
  const [nextLoading, setNextLoading] = useState(false);
  const [aiBulletsBusy, setAiBulletsBusy] = useState(false);
  const [aiBulletsDraft, setAiBulletsDraft] = useState("");
  const [aiBulletsSaveState, setAiBulletsSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiBulletsLastSavedAt, setAiBulletsLastSavedAt] = useState<number | null>(null);
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [nextHouseModalOpen, setNextHouseModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: Id<"photos"> } | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const noteAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiBulletsAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteInitializedRef = useRef(false);
  const lastPersistedNotesRef = useRef({ front: "", side: "", back: "" });
  const aiBulletsInitializedRef = useRef(false);
  const lastPersistedAiBulletsRef = useRef("");
  /** Avoid re-hydrating note from Convex on every refetch (causes textarea + status flash after autosave). */
  const noteHydratedForPropertyIdRef = useRef<Id<"properties"> | null>(null);
  const aiBulletsHydratedForPropertyIdRef = useRef<Id<"properties"> | null>(null);

  const property = useQuery(api.properties.get, { id: pid });
  const viewer = useQuery(api.tenancy.viewerContext, {});
  const photos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const streetData = useQuery(
    api.streets.getWithProperties,
    property?.streetId ? { streetId: property.streetId } : "skip",
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

  const createPhoto = useMutation(api.photos.create);
  const setFullImage = useMutation(api.photos.setFullImage);
  const removePhotoForInspector = useAction(api.photos.removeForInspector);
  const updateInspectorNotes = useMutation(api.properties.updateInspectorNotes);
  const setInspectionVerification = useMutation(api.properties.setInspectionVerification);
  const updateAiLetterBullets = useMutation(api.properties.updateAiLetterBullets);
  const updatePropertyStatus = useMutation(api.properties.updateStatus);
  const completeHouse = useMutation(api.properties.completeHouseCapture);
  const generateAiLetterBullets = useAction(api.inspectionBullets.generateFromInspectorNotes);

  useEffect(() => {
    noteHydratedForPropertyIdRef.current = null;
    noteInitializedRef.current = false;
    if (noteAutosaveTimerRef.current) {
      clearTimeout(noteAutosaveTimerRef.current);
      noteAutosaveTimerRef.current = null;
    }
    aiBulletsHydratedForPropertyIdRef.current = null;
    aiBulletsInitializedRef.current = false;
    if (aiBulletsAutosaveTimerRef.current) {
      clearTimeout(aiBulletsAutosaveTimerRef.current);
      aiBulletsAutosaveTimerRef.current = null;
    }
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
    let initialSide = property.inspectorNotesSide ?? "";
    let initialBack = property.inspectorNotesBack ?? "";
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
    if (!property || property._id !== pid) return;
    if (aiBulletsHydratedForPropertyIdRef.current === pid) return;

    aiBulletsHydratedForPropertyIdRef.current = pid;
    const initialBullets = property.aiLetterBullets ?? "";
    setAiBulletsDraft(initialBullets);
    lastPersistedAiBulletsRef.current = initialBullets;
    aiBulletsInitializedRef.current = true;
    setAiBulletsSaveState("idle");
    setAiBulletsLastSavedAt(property.aiLetterBulletsAt ?? null);
  }, [pid, property]);

  useEffect(() => {
    if (!property || property._id !== pid) return;
    if (!aiBulletsInitializedRef.current) return;
    const serverBullets = property.aiLetterBullets ?? "";
    const localIsDirty = aiBulletsDraft !== lastPersistedAiBulletsRef.current;
    if (!localIsDirty && serverBullets !== lastPersistedAiBulletsRef.current) {
      setAiBulletsDraft(serverBullets);
      lastPersistedAiBulletsRef.current = serverBullets;
      setAiBulletsLastSavedAt(property.aiLetterBulletsAt ?? Date.now());
      setAiBulletsSaveState("saved");
    }
  }, [pid, property?._id, property?.aiLetterBullets, property?.aiLetterBulletsAt, aiBulletsDraft]);

  useEffect(() => {
    return () => {
      if (noteAutosaveTimerRef.current) {
        clearTimeout(noteAutosaveTimerRef.current);
      }
      if (aiBulletsAutosaveTimerRef.current) {
        clearTimeout(aiBulletsAutosaveTimerRef.current);
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
        await updateInspectorNotes({
          id: pid,
          inspectorNotesFront: noteFront,
          inspectorNotesSide: noteSide,
          inspectorNotesBack: noteBack,
        });
        lastPersistedNotesRef.current = { front: noteFront, side: noteSide, back: noteBack };
        setLastSavedAt(Date.now());
        setNoteSaveState("saved");
      } catch (err) {
        console.error("Autosave failed:", err);
        setNoteSaveState("error");
      }
    }, 1200);
  }, [noteFront, noteSide, noteBack, pid, updateInspectorNotes]);

  useEffect(() => {
    if (!aiBulletsInitializedRef.current) return;
    if (aiBulletsDraft === lastPersistedAiBulletsRef.current) return;

    if (aiBulletsAutosaveTimerRef.current) clearTimeout(aiBulletsAutosaveTimerRef.current);
    aiBulletsAutosaveTimerRef.current = setTimeout(async () => {
      try {
        setAiBulletsSaveState("saving");
        await updateAiLetterBullets({ id: pid, aiLetterBullets: aiBulletsDraft });
        lastPersistedAiBulletsRef.current = aiBulletsDraft;
        setAiBulletsLastSavedAt(Date.now());
        setAiBulletsSaveState("saved");
      } catch (err) {
        console.error("AI bullets autosave failed:", err);
        setAiBulletsSaveState("error");
      }
    }, 1200);
  }, [aiBulletsDraft, pid, updateAiLetterBullets]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [statusMenuOpen]);

  const propertyPhotos = photos ?? [];

  const walkList = streetData?.properties ?? [];
  const currentIdx = walkList.findIndex((p) => p._id === pid);
  const nextProperty = currentIdx >= 0 ? walkList[currentIdx + 1] : undefined;

  const handlePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0 || !propertyId) return;

    const slotIds = files.map(() => crypto.randomUUID());
    const batchTotal = files.length;
    let batchDone = 0;
    let batchFail = 0;

    activeUploadBatchesRef.current++;
    uploadStatsRef.current.started += batchTotal;
    setUploadProgress({
      done: uploadStatsRef.current.done,
      fail: uploadStatsRef.current.fail,
      total: uploadStatsRef.current.started,
    });
    setPendingSlotIds((prev) => [...prev, ...slotIds]);

    void (async () => {
      try {
        await runPool(files, UPLOAD_CONCURRENCY, async (file, index) => {
          const slotId = slotIds[index];
          try {
            let photoId: Id<"photos">;
            let queuedFullUpload = false;
            try {
              const thumbFile = await buildInspectorThumbnailJpeg(file);
              const thumbResult = await uploadPhoto(thumbFile, propertyId, UPLOAD_SECTION);
              photoId = await createPhoto({
                propertyId: pid,
                section: UPLOAD_SECTION,
                thumbnailFilePath: thumbResult.filePath,
                thumbnailPublicUrl: thumbResult.publicUrl,
              });
              queuedFullUpload = true;
            } catch (thumbErr) {
              console.warn("Thumbnail path failed, uploading full image only:", thumbErr);
              const fullOnly = await uploadPhoto(file, propertyId, UPLOAD_SECTION);
              photoId = await createPhoto({
                propertyId: pid,
                section: UPLOAD_SECTION,
                filePath: fullOnly.filePath,
                publicUrl: fullOnly.publicUrl,
              });
            }

            uploadStatsRef.current.done++;
            batchDone++;

            if (queuedFullUpload) {
              void (async () => {
                try {
                  const fullResult = await uploadPhoto(file, propertyId, UPLOAD_SECTION);
                  await setFullImage({
                    id: photoId,
                    propertyId: pid,
                    filePath: fullResult.filePath,
                    publicUrl: fullResult.publicUrl,
                  });
                } catch (fullErr) {
                  console.error("Full-size background upload failed:", fullErr);
                }
              })();
            }
          } catch (err) {
            uploadStatsRef.current.fail++;
            batchFail++;
            console.error("Photo upload failed:", err);
          } finally {
            setPendingSlotIds((prev) => prev.filter((id) => id !== slotId));
            setUploadProgress({
              done: uploadStatsRef.current.done,
              fail: uploadStatsRef.current.fail,
              total: uploadStatsRef.current.started,
            });
          }
        });

        if (batchFail > 0) {
          alert(
            `Finished ${batchTotal} uploads: ${batchDone} saved, ${batchFail} failed — please retry the failed ones.`,
          );
        }
      } finally {
        activeUploadBatchesRef.current--;
        if (activeUploadBatchesRef.current === 0) {
          setUploadProgress(null);
          uploadStatsRef.current = { started: 0, done: 0, fail: 0 };
        }
      }
    })();
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

  const stopBrowserSpeech = () => {
    try {
      recognitionRef.current?.stop?.();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setListeningSection(null);
  };

  const appendToSection = (section: NoteSection, chunk: string) => {
    const t = chunk.trim();
    if (!t) return;
    if (section === "front") setNoteFront((prev) => (prev ? `${prev} ${t}` : t).trim());
    if (section === "side") setNoteSide((prev) => (prev ? `${prev} ${t}` : t).trim());
    if (section === "back") setNoteBack((prev) => (prev ? `${prev} ${t}` : t).trim());
  };

  const handleMic = (section: NoteSection) => {
    if (listeningSection === section) {
      stopBrowserSpeech();
      return;
    }
    stopBrowserSpeech();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      alert("Speech recognition is not supported in this browser. Try Chrome.");
      return;
    }
    setListeningSection(section);
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
      }
      if (finalChunk) appendToSection(section, finalChunk);
    };
    recognition.onerror = () => stopBrowserSpeech();
    recognition.onend = () => setListeningSection(null);
    recognition.start();
  };

  const persistNotesIfDirty = async () => {
    stopBrowserSpeech();
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

  const handleNextHouseFinished = async () => {
    setNextLoading(true);
    setNextHouseModalOpen(false);
    try {
      await persistNotesIfDirty();
      await completeHouse({ id: pid });
      navigateAfterLeave();
    } catch (err) {
      console.error(err);
      alert("Could not save and continue: " + String(err));
    } finally {
      setNextLoading(false);
    }
  };

  const handleNextHouseMoreTodo = async () => {
    setNextLoading(true);
    setNextHouseModalOpen(false);
    try {
      await persistNotesIfDirty();
      await updatePropertyStatus({ id: pid, status: "inProgress" });
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
      <div className="flex flex-col items-center justify-center min-h-screen gradient-hero">
        <div className="text-5xl animate-spin mb-4">🔄</div>
        <p className="text-white font-medium">Loading property...</p>
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

  const nameFor = (id?: string) => (!id ? "" : displayNames?.[id]?.trim() || "Team member");
  const hasAnyNote = !!(noteFront.trim() || noteSide.trim() || noteBack.trim());
  const lastSaverId = property.inspectionNotesLastUpdatedByClerkUserId;
  const viewerId = viewer?.clerkUserId;
  const cannotVerifyOwnNotes =
    !!lastSaverId && !!viewerId && viewerId === lastSaverId;
  const isVerified = !!property.inspectionDetailsVerifiedByClerkUserId;
  const verifyCheckboxDisabled = !isVerified && (!hasAnyNote || cannotVerifyOwnNotes);

  return (
    <div className="min-h-screen bg-[#f8f7ff] pb-24 flex flex-col">
      <div className="gradient-inspector sticky top-0 z-50 shrink-0 border-b border-white/15 shadow-md">
        <div className="px-4 pt-8 pb-4">
          <div className="relative" ref={statusMenuRef}>
            <div className="flex items-center gap-2 pb-1">
              <button
                type="button"
                className="relative z-[1] shrink-0 text-sky-100 hover:text-white text-sm font-medium transition-colors"
                onClick={() => navigate(`/inspector/street/${property.streetId}`)}
              >
                ← Street
              </button>
              <h1 className="relative z-[1] min-w-0 flex-1 font-bold text-white text-sm text-center truncate px-1">
                {property.address}
              </h1>
              <button
                type="button"
                className="relative z-[1] flex shrink-0 items-center gap-1 rounded-full border border-white/30 bg-white/15 py-1.5 pl-1.5 pr-1 hover:bg-white/25 transition-colors"
                aria-expanded={statusMenuOpen}
                aria-haspopup="listbox"
                aria-label={`House status: ${STATUS_THEME[property.status].full}. Tap to change.`}
                onClick={() => setStatusMenuOpen((o) => !o)}
              >
                <span
                  className={`h-3.5 w-3.5 shrink-0 rounded-full ${STATUS_DOT[property.status]}`}
                  aria-hidden
                />
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-white/90 transition-transform ${statusMenuOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>
            {statusMenuOpen ? (
              <ul
                className="absolute left-0 right-0 top-full z-[60] mt-1.5 space-y-2 rounded-xl border border-white/50 bg-white/98 p-2 shadow-xl backdrop-blur-md sm:left-auto sm:right-0 sm:mt-2 sm:min-w-[12.5rem] sm:w-max sm:max-w-[min(12.5rem,calc(100vw-2rem))]"
                role="listbox"
                aria-label="House status"
              >
                {STATUS_ORDER.map((value) => (
                  <li key={value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={property.status === value}
                      className={`${STATUS_THEME[value].menuBtn} ${property.status === value ? "ring-2 ring-gray-900/20 ring-offset-2 ring-offset-white" : ""}`}
                      onClick={async () => {
                        if (property.status === value) {
                          setStatusMenuOpen(false);
                          return;
                        }
                        try {
                          await updatePropertyStatus({ id: pid, status: value });
                          setStatusMenuOpen(false);
                        } catch (err) {
                          console.error(err);
                          alert("Could not update status.");
                        }
                      }}
                    >
                      <span className={`h-3 w-3 shrink-0 rounded-full ${STATUS_DOT[value]}`} aria-hidden />
                      <span>{STATUS_THEME[value].full}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>

      <div className="relative z-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="hidden"
          onChange={handlePhotoSelected}
        />
        <button
          type="button"
          className={`btn-bounce w-full py-4 rounded-2xl font-bold text-lg shadow-sm border-2 transition-all bg-white border-dashed border-sky-300 text-sky-600 hover:bg-sky-50 ${
            pendingSlotIds.length > 0 ? "ring-2 ring-sky-200 ring-offset-1" : ""
          }`}
          disabled={!propertyId}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="flex flex-col items-center justify-center gap-1">
            <span>📸 Take Photo</span>
            {(pendingSlotIds.length > 0 || uploadProgress !== null) && uploadProgress ? (
              <span className="text-sm font-normal text-sky-800 flex flex-col items-center gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                  <span>
                    {uploadProgress.done + uploadProgress.fail}/{uploadProgress.total}
                    {uploadProgress.fail > 0 ? ` (${uploadProgress.fail} failed)` : ""}
                  </span>
                </span>
                <span className="text-xs font-normal opacity-90">Up to {UPLOAD_CONCURRENCY} at a time</span>
              </span>
            ) : null}
          </span>
        </button>

        {(propertyPhotos.length > 0 || pendingSlotIds.length > 0) && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {propertyPhotos.map((photo, idx) => (
              <button
                key={photo._id}
                type="button"
                className="relative shrink-0"
                onClick={() => openViewerAt(idx)}
              >
                <img
                  src={photo.publicUrl ?? photo.thumbnailPublicUrl ?? ""}
                  alt="section photo"
                  className="w-20 h-20 object-cover rounded-xl border-2 border-white shadow-sm hover:border-sky-300 transition-colors cursor-zoom-in"
                />
              </button>
            ))}
            {pendingSlotIds.map((slotId) => (
              <div
                key={slotId}
                role="status"
                aria-label="Uploading photo"
                className="relative shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-sky-200 bg-sky-50 flex items-center justify-center shadow-sm"
              >
                <Loader2 className="h-7 w-7 text-sky-500 animate-spin" aria-hidden />
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
          <h2 className="font-bold text-gray-800">📝 Inspection notes</h2>

          <Tabs defaultValue="front" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-muted/90 p-1">
              <TabsTrigger value="front" className="rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm">
                Front
              </TabsTrigger>
              <TabsTrigger value="side" className="rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm">
                Side
              </TabsTrigger>
              <TabsTrigger value="back" className="rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm">
                Back
              </TabsTrigger>
            </TabsList>
            {(["front", "side", "back"] as const).map((section) => {
              const label = section === "front" ? "Front" : section === "side" ? "Side" : "Back";
              const value = section === "front" ? noteFront : section === "side" ? noteSide : noteBack;
              const setValue = section === "front" ? setNoteFront : section === "side" ? setNoteSide : setNoteBack;
              const micOn = listeningSection === section;
              return (
                <TabsContent key={section} value={section} className="mt-1.5 space-y-1.5 focus-visible:ring-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-700">{label}</p>
                    <button
                      type="button"
                      className={`btn-bounce inline-flex items-center shrink-0 gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        micOn
                          ? "bg-red-100 text-red-700 border-2 border-red-400"
                          : "bg-sky-100 text-sky-800 border-2 border-transparent hover:bg-sky-200"
                      }`}
                      onClick={() => handleMic(section)}
                    >
                      {micOn ? (
                        "Stop"
                      ) : (
                        <>
                          <span aria-hidden>🎤</span>
                          <span>Record</span>
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    rows={6}
                    className="w-full min-h-[6.25rem] text-base px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-sky-400 resize-none transition-colors"
                  />
                </TabsContent>
              );
            })}
          </Tabs>

          {(noteSaveState !== "idle" ||
            property.inspectionNotesEnteredByClerkUserId ||
            property.inspectionNotesLastUpdatedByClerkUserId) && (
            <div className="mt-1 space-y-0.5">
              {noteSaveState !== "idle" && (
                <div className="text-xs text-gray-500">
                  {noteSaveState === "saving" && "Saving notes..."}
                  {noteSaveState === "saved" &&
                    `Saved${lastSavedAt ? ` at ${new Date(lastSavedAt).toLocaleTimeString()}` : ""}`}
                  {noteSaveState === "error" && "Autosave failed. Your notes will still save on Next House."}
                </div>
              )}

              {(property.inspectionNotesEnteredByClerkUserId ||
                property.inspectionNotesLastUpdatedByClerkUserId) && (
                <div className="text-xs text-gray-600 space-y-0.5">
                  {property.inspectionNotesEnteredByClerkUserId ? (
                    <p>
                      Added by{" "}
                      <span className="font-medium">{nameFor(property.inspectionNotesEnteredByClerkUserId)}</span>
                      {property.inspectionNotesEnteredAt != null && (
                        <span className="text-gray-400">
                          {" "}
                          · {new Date(property.inspectionNotesEnteredAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                  ) : null}
                  {property.inspectionNotesLastUpdatedByClerkUserId ? (
                    <p>
                      Last updated by{" "}
                      <span className="font-medium">{nameFor(property.inspectionNotesLastUpdatedByClerkUserId)}</span>
                      {property.inspectionNotesLastUpdatedAt != null && (
                        <span className="text-gray-400">
                          {" "}
                          · {new Date(property.inspectionNotesLastUpdatedAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          )}

          <div className="pt-3">
            <label
              className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
                verifyCheckboxDisabled
                  ? "cursor-not-allowed border-gray-200 bg-gray-100/70 opacity-[0.72]"
                  : "cursor-pointer border-gray-100 bg-gray-50/80"
              }`}
              aria-disabled={verifyCheckboxDisabled || undefined}
            >
            <input
              type="checkbox"
              className={`mt-1 h-4 w-4 shrink-0 rounded border-gray-300 ${verifyCheckboxDisabled ? "cursor-not-allowed opacity-60" : ""}`}
              checked={isVerified}
              disabled={verifyCheckboxDisabled}
              onChange={async (e) => {
                try {
                  if (e.target.checked) {
                    await persistNotesIfDirty();
                  }
                  await setInspectionVerification({ propertyId: pid, verified: e.target.checked });
                } catch (err) {
                  console.error(err);
                  alert(err instanceof Error ? err.message : "Could not update verification.");
                }
              }}
            />
            <span
              className={`text-sm ${verifyCheckboxDisabled ? "pointer-events-none text-gray-500" : "text-gray-800"}`}
            >
              <span className="font-semibold">Verify inspection details</span>
              <span className={`block text-xs mt-0.5 ${verifyCheckboxDisabled ? "text-gray-400" : "text-gray-500"}`}>
                Another inspector must confirm. You cannot verify if you last edited these notes.
              </span>
              {isVerified && property.inspectionDetailsVerifiedByClerkUserId ? (
                <span className="block text-xs text-gray-500 mt-1">
                  Verified by {nameFor(property.inspectionDetailsVerifiedByClerkUserId)}
                  {property.inspectionDetailsVerifiedAt != null &&
                    ` · ${new Date(property.inspectionDetailsVerifiedAt).toLocaleString()}`}
                </span>
              ) : null}
            </span>
            </label>
          </div>

          <div className="rounded-xl border border-violet-100 bg-violet-50/60 overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left hover:bg-violet-100/50 transition-colors"
              onClick={() => setAiSectionOpen((o) => !o)}
            >
              <span className="text-sm font-semibold text-gray-800">Generate Standardized Notes</span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-violet-700 transition-transform ${aiSectionOpen ? "rotate-180" : ""}`} />
            </button>
            {aiSectionOpen ? (
              <div className="px-3 pb-3 pt-0 space-y-2 border-t border-violet-100/80">
                <div className="flex flex-wrap items-center justify-start gap-2 pt-2">
                  <button
                    type="button"
                    disabled={aiBulletsBusy || !hasAnyNote}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-violet-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-violet-700 transition-colors"
                    onClick={async () => {
                      setAiBulletsBusy(true);
                      try {
                        await updateInspectorNotes({
                          id: pid,
                          inspectorNotesFront: noteFront,
                          inspectorNotesSide: noteSide,
                          inspectorNotesBack: noteBack,
                        });
                        lastPersistedNotesRef.current = { front: noteFront, side: noteSide, back: noteBack };
                        const r = await generateAiLetterBullets({ propertyId: pid });
                        if (!r.ok) alert("error" in r ? r.error : "Could not generate inspection notes.");
                      } catch (e) {
                        console.error(e);
                        alert("Could not generate inspection notes.");
                      } finally {
                        setAiBulletsBusy(false);
                      }
                    }}
                  >
                    {aiBulletsBusy ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Generating…
                      </span>
                    ) : property?.aiLetterBullets?.trim() ? (
                      "Regenerate"
                    ) : (
                      "Generate"
                    )}
                  </button>
                </div>
                <textarea
                  value={aiBulletsDraft}
                  onChange={(e) => setAiBulletsDraft(e.target.value)}
                  rows={5}
                  className="w-full text-base px-3 py-2 rounded-xl border border-violet-200 focus:outline-none focus:border-violet-400 resize-y bg-white text-gray-700 transition-colors"
                  placeholder="Optional standardized bullet list for letters."
                />
                {property?.aiLetterBulletsAt != null ? (
                  <p className="text-xs text-gray-500">
                    Updated {new Date(property.aiLetterBulletsAt).toLocaleString()}
                  </p>
                ) : null}
                <div className="text-xs text-gray-500 min-h-[1rem]">
                  {aiBulletsSaveState === "saving" && "Saving summarized notes..."}
                  {aiBulletsSaveState === "saved" &&
                    `Saved${aiBulletsLastSavedAt ? ` at ${new Date(aiBulletsLastSavedAt).toLocaleString()}` : ""}`}
                  {aiBulletsSaveState === "error" && "Autosave failed. Try editing again."}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {(priorBlocks.length > 0 || property.priorOwnerLetterNotes2024?.trim()) && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">📋 Last inspection</h2>
            {property.priorOwnerLetterNotes2024?.trim() && (
              <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                <p className="text-xs font-semibold text-amber-900/80 mb-1">2024 letter text on file</p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{property.priorOwnerLetterNotes2024}</p>
              </div>
            )}
            {priorBlocks.map((b, i) => (
              <div key={`${b.label}-${i}`}>
                {b.label ? (
                  <p className="text-xs font-semibold text-gray-500">{b.label}</p>
                ) : null}
                <p className={`text-sm text-gray-700 whitespace-pre-wrap ${b.label ? "mt-0.5" : ""}`}>{b.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-white/95 backdrop-blur border-t border-gray-100">
        <div className="max-w-lg mx-auto">
          <button
            type="button"
            className="btn-bounce w-full py-3.5 px-3 rounded-2xl font-bold text-base sm:text-lg gradient-success text-white shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={nextLoading}
            onClick={() => setNextHouseModalOpen(true)}
          >
            {nextLoading
              ? "Saving…"
              : nextProperty
                ? "Next House → 🏠"
                : "Complete Street 🎉"}
          </button>
        </div>
      </div>

      <Dialog open={nextHouseModalOpen} onOpenChange={setNextHouseModalOpen}>
        <DialogContent className="max-w-[min(92vw,22rem)] gap-3 border-gray-200 p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">Leaving this house?</DialogTitle>
            <DialogDescription className="text-left text-sm text-muted-foreground">
              Is this inspection finished here, or do you still have more to do on this home? Your notes will be
              saved either way.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              className="btn-bounce w-full rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-white shadow-md hover:bg-emerald-600 disabled:opacity-50"
              disabled={nextLoading}
              onClick={() => void handleNextHouseFinished()}
            >
              All done — mark complete
            </button>
            <button
              type="button"
              className="btn-bounce w-full rounded-xl border-2 border-sky-300 bg-sky-50 py-3.5 text-base font-bold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
              disabled={nextLoading}
              onClick={() => void handleNextHouseMoreTodo()}
            >
              More to do — save & continue
            </button>
            <button
              type="button"
              className="text-sm font-medium text-gray-500 hover:text-gray-800 py-1"
              disabled={nextLoading}
              onClick={() => setNextHouseModalOpen(false)}
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-[min(92vw,22rem)] z-[100] border-gray-200">
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
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setViewerOpen(false)}
        >
          <div
            className="w-full max-w-4xl bg-black/40 rounded-2xl border border-white/20 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-white text-sm mb-2">
              <p className="font-semibold">
                Photo {selectedPhotoIndex + 1} / {propertyPhotos.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/90 hover:bg-red-600 text-white text-sm font-semibold transition-colors"
                  onClick={() => setDeleteTarget({ id: selectedPhoto._id })}
                >
                  <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                  Delete
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  onClick={() => setViewerOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="relative">
              {!selectedPhoto.publicUrl && selectedPhoto.thumbnailPublicUrl ? (
                <p className="text-center text-amber-200 text-sm mb-2">
                  Full resolution still uploading — showing preview. Open again in a moment for the original file.
                </p>
              ) : null}
              <img
                src={selectedPhoto.publicUrl ?? selectedPhoto.thumbnailPublicUrl ?? ""}
                alt="full size section photo"
                className="w-full max-h-[75vh] object-contain rounded-xl bg-black"
              />
              <button
                type="button"
                disabled={!canGoPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 px-3 py-2 rounded-lg bg-black/50 text-white disabled:opacity-30"
                onClick={() => canGoPrev && setSelectedPhotoIndex((i) => i - 1)}
              >
                ←
              </button>
              <button
                type="button"
                disabled={!canGoNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-2 rounded-lg bg-black/50 text-white disabled:opacity-30"
                onClick={() => canGoNext && setSelectedPhotoIndex((i) => i + 1)}
              >
                →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
