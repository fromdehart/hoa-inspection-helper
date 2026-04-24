import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { uploadPhoto } from "@/lib/uploadClient";
import { runPool } from "@/lib/runPool";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Max parallel uploads per batch (mobile uplink is usually the bottleneck; 4 is a good balance). */
const UPLOAD_CONCURRENCY = 4;

/** Single bucket for new uploads; legacy side/back photos still list with property photos. */
const UPLOAD_SECTION = "front" as const;

type PropertyStatus = "notStarted" | "inProgress" | "complete";

/** Dot on header trigger + small swatch in menu rows. */
const STATUS_DOT: Record<PropertyStatus, string> = {
  notStarted: "bg-slate-300 shadow-inner ring-1 ring-slate-500/35",
  /** Amber reads clearly on the cyan inspector header (avoids blue-on-blue). */
  inProgress: "bg-amber-300 shadow-inner ring-1 ring-amber-600/40",
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
  complete: {
    full: "Complete",
    menuBtn:
      "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold bg-emerald-100 text-emerald-950 hover:bg-emerald-200/90 active:bg-emerald-200 transition-colors",
  },
};

const STATUS_ORDER: PropertyStatus[] = ["notStarted", "inProgress", "complete"];

export default function PropertyCapture() {
  const navigate = useNavigate();
  const { propertyId } = useParams<{ propertyId: string }>();
  const pid = propertyId as Id<"properties">;

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    fail: number;
    total: number;
  } | null>(null);
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [nextLoading, setNextLoading] = useState(false);
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [nextHouseModalOpen, setNextHouseModalOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const noteAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteInitializedRef = useRef(false);
  const lastPersistedNoteRef = useRef("");
  /** Avoid re-hydrating note from Convex on every refetch (causes textarea + status flash after autosave). */
  const noteHydratedForPropertyIdRef = useRef<Id<"properties"> | null>(null);

  const property = useQuery(api.properties.get, { id: pid });
  const photos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const streetData = useQuery(
    api.streets.getWithProperties,
    property?.streetId ? { streetId: property.streetId } : "skip",
  );

  const createPhoto = useMutation(api.photos.create);
  const updateInspectorNotes = useMutation(api.properties.updateInspectorNotes);
  const updatePropertyStatus = useMutation(api.properties.updateStatus);
  const completeHouse = useMutation(api.properties.completeHouseCapture);

  useEffect(() => {
    noteHydratedForPropertyIdRef.current = null;
    noteInitializedRef.current = false;
    if (noteAutosaveTimerRef.current) {
      clearTimeout(noteAutosaveTimerRef.current);
      noteAutosaveTimerRef.current = null;
    }
  }, [pid]);

  useEffect(() => {
    if (!property || property._id !== pid) return;
    if (noteHydratedForPropertyIdRef.current === pid) return;

    noteHydratedForPropertyIdRef.current = pid;
    const initialNote = property.inspectorNotes ?? "";
    setNote(initialNote);
    lastPersistedNoteRef.current = initialNote;
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
    if (note === lastPersistedNoteRef.current) return;

    if (noteAutosaveTimerRef.current) clearTimeout(noteAutosaveTimerRef.current);

    noteAutosaveTimerRef.current = setTimeout(async () => {
      try {
        setNoteSaveState("saving");
        await updateInspectorNotes({ id: pid, inspectorNotes: note });
        lastPersistedNoteRef.current = note;
        setLastSavedAt(Date.now());
        setNoteSaveState("saved");
      } catch (err) {
        console.error("Autosave failed:", err);
        setNoteSaveState("error");
      }
    }, 1200);
  }, [note, pid, updateInspectorNotes]);

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

    setUploading(true);
    setUploadProgress({ done: 0, fail: 0, total: files.length });

    void (async () => {
      let done = 0;
      let fail = 0;
      const bump = () => {
        setUploadProgress({ done, fail, total: files.length });
      };

      try {
        await runPool(files, UPLOAD_CONCURRENCY, async (file) => {
          try {
            const result = await uploadPhoto(file, propertyId, UPLOAD_SECTION);
            await createPhoto({
              propertyId: pid,
              section: UPLOAD_SECTION,
              filePath: result.filePath,
              publicUrl: result.publicUrl,
            });
            done++;
          } catch (err) {
            fail++;
            console.error("Photo upload failed:", err);
          }
          bump();
        });

        if (fail > 0) {
          alert(
            `Finished ${files.length} uploads: ${done} saved, ${fail} failed — please retry the failed ones.`,
          );
        }
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
    })();
  };

  const openViewerAt = (index: number) => {
    setSelectedPhotoIndex(index);
    setViewerOpen(true);
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
    setListening(false);
  };

  const handleMic = () => {
    if (listening) {
      stopBrowserSpeech();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      alert("Speech recognition is not supported in this browser. Try Chrome.");
      return;
    }
    setListening(true);
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
      if (finalChunk) setNote((prev) => (prev ? `${prev} ${finalChunk}` : finalChunk).trim());
    };
    recognition.onerror = () => stopBrowserSpeech();
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const persistNotesIfDirty = async () => {
    stopBrowserSpeech();
    if (noteAutosaveTimerRef.current) {
      clearTimeout(noteAutosaveTimerRef.current);
      noteAutosaveTimerRef.current = null;
    }
    if (note !== lastPersistedNoteRef.current) {
      await updateInspectorNotes({ id: pid, inspectorNotes: note });
      lastPersistedNoteRef.current = note;
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
      await completeHouse({ id: pid, inspectorNotes: note });
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
          className={`btn-bounce w-full py-4 rounded-2xl font-bold text-lg shadow-sm border-2 transition-all ${
            uploading
              ? "bg-gray-100 border-gray-200 text-gray-400"
              : "bg-white border-dashed border-sky-300 text-sky-600 hover:bg-sky-50"
          }`}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <span className="flex flex-col items-center justify-center gap-0.5 sm:flex-row sm:gap-2">
              <span className="flex items-center gap-2">
                <span className="animate-spin">⏳</span>
                {uploadProgress ? (
                  <span>
                    Uploading {uploadProgress.done + uploadProgress.fail}/{uploadProgress.total}
                    {uploadProgress.fail > 0 ? ` (${uploadProgress.fail} failed)` : ""}
                  </span>
                ) : (
                  <span>Uploading…</span>
                )}
              </span>
              <span className="text-xs font-normal opacity-90">Up to {UPLOAD_CONCURRENCY} at a time</span>
            </span>
          ) : (
            "📸 Take Photo"
          )}
        </button>

        {propertyPhotos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {propertyPhotos.map((photo, idx) => (
              <button
                key={photo._id}
                type="button"
                className="relative shrink-0"
                onClick={() => openViewerAt(idx)}
              >
                <img
                  src={photo.publicUrl}
                  alt="section photo"
                  className="w-20 h-20 object-cover rounded-xl border-2 border-white shadow-sm hover:border-sky-300 transition-colors cursor-zoom-in"
                />
              </button>
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <h2 className="font-bold text-gray-800 mb-2">📝 Inspection notes</h2>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            className="w-full text-base px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-sky-400 resize-none transition-colors"
          />
          <div className="mt-2 text-xs text-gray-500 min-h-[1rem]">
            {noteSaveState === "saving" && "Saving notes..."}
            {noteSaveState === "saved" &&
              `Saved${lastSavedAt ? ` at ${new Date(lastSavedAt).toLocaleTimeString()}` : ""}`}
            {noteSaveState === "error" && "Autosave failed. Your notes will still save on Next House."}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              className={`btn-bounce px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                listening
                  ? "bg-red-100 text-red-700 border-2 border-red-400"
                  : "bg-sky-100 text-sky-800 border-2 border-transparent hover:bg-sky-200"
              }`}
              onClick={handleMic}
            >
              {listening ? "Stop mic" : "🎤 Record Notes"}
            </button>
          </div>
        </div>

        {priorBlocks.length > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">📋 Last inspection</h2>
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

      {viewerOpen && selectedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setViewerOpen(false)}
        >
          <div
            className="w-full max-w-4xl bg-black/40 rounded-2xl border border-white/20 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-white text-sm mb-2">
              <p className="font-semibold">
                Photo {selectedPhotoIndex + 1} / {propertyPhotos.length}
              </p>
              <button
                type="button"
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                onClick={() => setViewerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="relative">
              <img
                src={selectedPhoto.publicUrl}
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
