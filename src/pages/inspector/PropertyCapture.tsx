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
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [nextLoading, setNextLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    if (localStorage.getItem("hoa_inspector") !== "true") {
      navigate("/inspector");
    }
  }, [navigate]);

  const property = useQuery(api.properties.get, { id: pid });
  const photos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const streetData = useQuery(
    api.streets.getWithProperties,
    property?.streetId ? { streetId: property.streetId } : "skip",
  );

  const createPhoto = useMutation(api.photos.create);
  const completeHouse = useMutation(api.properties.completeHouseAndSaveLetter);

  useEffect(() => {
    if (property && property._id === pid) setNote(property.inspectorNotes ?? "");
  }, [property?._id, pid, property?.inspectorNotes]); // eslint-disable-line react-hooks/exhaustive-deps -- sync when switching houses

  const sectionPhotos = (photos ?? []).filter((p) => p.section === currentSection);

  const walkList = streetData?.properties ?? [];
  const currentIdx = walkList.findIndex((p) => p._id === pid);
  const nextProperty = currentIdx >= 0 ? walkList[currentIdx + 1] : undefined;

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadPhoto(file, propertyId!, currentSection);
      await createPhoto({
        propertyId: pid,
        section: currentSection,
        filePath: result.filePath,
        publicUrl: result.publicUrl,
      });
    } catch (err) {
      console.error("Photo upload failed:", err);
      alert("Upload failed: " + String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
              <span className="animate-spin">⏳</span> Uploading...
            </span>
          ) : (
            "📸 Take Photo"
          )}
        </button>

        {sectionPhotos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sectionPhotos.map((photo) => (
              <a
                key={photo._id}
                href={photo.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative shrink-0"
              >
                <img
                  src={photo.publicUrl}
                  alt="section photo"
                  className="w-20 h-20 object-cover rounded-xl border-2 border-white shadow-sm"
                />
              </a>
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
            ? "Saving letter…"
            : nextProperty
              ? "Next House → 🏠"
              : "Complete Street 🎉"}
        </button>
      </div>
    </div>
  );
}
