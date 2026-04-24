import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { uploadPhoto } from "@/lib/uploadClient";

type Section = "front" | "side" | "back";

const SECTION_EMOJI: Record<Section, string> = {
  front: "🏠",
  side: "🏡",
  back: "🌳",
};

export default function PropertyCapture() {
  const navigate = useNavigate();
  const { propertyId } = useParams<{ propertyId: string }>();
  const pid = propertyId as Id<"properties">;

  const [currentSection, setCurrentSection] = useState<Section>("front");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [nextLoading, setNextLoading] = useState(false);
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
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

  const sectionPhotos = (photos ?? []).filter((p) => p.section === currentSection);

  const walkList = streetData?.properties ?? [];
  const currentIdx = walkList.findIndex((p) => p._id === pid);
  const nextProperty = currentIdx >= 0 ? walkList[currentIdx + 1] : undefined;

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress({ current: 0, total: files.length });
    let failed = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress({ current: i + 1, total: files.length });
        try {
          const result = await uploadPhoto(file, propertyId!, currentSection);
          await createPhoto({
            propertyId: pid,
            section: currentSection,
            filePath: result.filePath,
            publicUrl: result.publicUrl,
          });
        } catch (err) {
          failed++;
          console.error("Photo upload failed:", err);
        }
      }
      if (failed > 0) {
        alert(
          `Uploaded ${files.length - failed}/${files.length} photos. ${failed} failed — please retry those.`,
        );
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openViewerAt = (index: number) => {
    setSelectedPhotoIndex(index);
    setViewerOpen(true);
  };

  const selectedPhoto = sectionPhotos[selectedPhotoIndex];
  const canGoPrev = selectedPhotoIndex > 0;
  const canGoNext = selectedPhotoIndex < sectionPhotos.length - 1;

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

  const handleNextHouse = async () => {
    stopBrowserSpeech();
    if (noteAutosaveTimerRef.current) clearTimeout(noteAutosaveTimerRef.current);
    setNextLoading(true);
    try {
      await completeHouse({ id: pid, inspectorNotes: note });
      if (nextProperty) {
        navigate(`/inspector/property/${nextProperty._id}`);
      } else {
        navigate(`/inspector/street/${property?.streetId}`);
      }
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
      <div className="gradient-inspector px-4 pt-8 pb-4">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            className="text-sky-100 hover:text-white text-sm font-medium transition-colors"
            onClick={() => navigate(`/inspector/street/${property.streetId}`)}
          >
            ← Street
          </button>
          <h1 className="font-bold text-white text-sm truncate max-w-[200px]">{property.address}</h1>
          <div className="w-12" />
        </div>

        <div className="flex gap-2">
          {(["front", "side", "back"] as Section[]).map((sec) => (
            <button
              key={sec}
              type="button"
              className={`btn-bounce flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                currentSection === sec
                  ? "bg-white text-sky-700 shadow-sm"
                  : "bg-white/20 text-white/80 hover:bg-white/30"
              }`}
              onClick={() => setCurrentSection(sec)}
            >
              {SECTION_EMOJI[sec]} {sec.charAt(0).toUpperCase() + sec.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⏳</span>
              {uploadProgress ? `Uploading ${uploadProgress.current}/${uploadProgress.total}...` : "Uploading..."}
            </span>
          ) : (
            "📸 Take Photo"
          )}
        </button>

        {sectionPhotos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sectionPhotos.map((photo, idx) => (
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
            className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-sky-400 resize-none transition-colors"
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

      <div className="fixed bottom-0 left-0 right-0 p-3 bg-white/90 backdrop-blur border-t border-gray-100">
        <button
          type="button"
          className="btn-bounce w-full py-4 rounded-2xl font-bold text-lg gradient-success text-white shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={nextLoading}
          onClick={handleNextHouse}
        >
          {nextLoading
            ? "Saving…"
            : nextProperty
              ? "Next House → 🏠"
              : "Complete Street 🎉"}
        </button>
      </div>

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
              <p className="font-semibold capitalize">
                {currentSection} photo {selectedPhotoIndex + 1} / {sectionPhotos.length}
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
