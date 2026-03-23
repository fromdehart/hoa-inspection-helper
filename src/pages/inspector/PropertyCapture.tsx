import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { uploadPhoto } from "@/lib/uploadClient";

type Section = "front" | "side" | "back";

const ANALYSIS_ICONS: Record<string, string> = {
  pending: "⏳",
  processing: "🔄",
  done: "✅",
  error: "❌",
};

const SEV_CONFIG: Record<string, { bar: string; bg: string; text: string }> = {
  high:   { bar: "border-l-4 border-red-500",    bg: "bg-red-50",    text: "text-red-700" },
  medium: { bar: "border-l-4 border-amber-500",  bg: "bg-amber-50",  text: "text-amber-700" },
  low:    { bar: "border-l-4 border-green-500",  bg: "bg-green-50",  text: "text-green-700" },
};

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
  const [savingNote, setSavingNote] = useState(false);
  const [lastUploadedPhotoId, setLastUploadedPhotoId] = useState<Id<"photos"> | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (localStorage.getItem("hoa_inspector") !== "true") {
      navigate("/inspector");
    }
  }, [navigate]);

  const property = useQuery(api.properties.get, { id: pid });
  const photos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const violations = useQuery(api.violations.listByProperty, { propertyId: pid });
  const streetData = useQuery(
    api.streets.getWithProperties,
    property?.streetId ? { streetId: property.streetId } : "skip",
  );

  const createPhoto = useMutation(api.photos.create);
  const updateNote = useMutation(api.photos.updateNote);
  const updateStatus = useMutation(api.properties.updateStatus);

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
      const photoId = await createPhoto({
        propertyId: pid,
        section: currentSection,
        filePath: result.filePath,
        publicUrl: result.publicUrl,
      });
      setLastUploadedPhotoId(photoId);
    } catch (err) {
      alert("Upload failed: " + String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (albumInputRef.current) albumInputRef.current.value = "";
    }
  };

  const handleSaveNote = async () => {
    if (!lastUploadedPhotoId || !note.trim()) return;
    setSavingNote(true);
    try {
      await updateNote({ id: lastUploadedPhotoId, note });
      setNote("");
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } finally {
      setSavingNote(false);
    }
  };

  const handleMic = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser");
      return;
    }
    setListening(true);
    const recognition = new SpeechRecognition();
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setNote((prev) => prev + (prev ? " " : "") + transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.start();
  };

  const handleNextHouse = async () => {
    await updateStatus({ id: pid, status: "complete" });
    if (nextProperty) {
      navigate(`/inspector/property/${nextProperty._id}`);
    } else {
      navigate(`/inspector/street/${property?.streetId}`);
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

  return (
    <div className="min-h-screen bg-[#f8f7ff] pb-24 flex flex-col">
      {/* Header */}
      <div className="gradient-inspector px-4 pt-8 pb-4">
        <div className="flex items-center justify-between mb-3">
          <button
            className="text-sky-100 hover:text-white text-sm font-medium transition-colors"
            onClick={() => navigate(`/inspector/street/${property.streetId}`)}
          >
            ← Street
          </button>
          <h1 className="font-bold text-white text-sm truncate max-w-[200px]">
            {property.address}
          </h1>
          <div className="w-12" />
        </div>

        {/* Section tabs */}
        <div className="flex gap-2">
          {(["front", "side", "back"] as Section[]).map((sec) => (
            <button
              key={sec}
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Camera button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoSelected}
        />
        <input
          ref={albumInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoSelected}
        />
        <div className="flex gap-2">
          <button
            className={`btn-bounce flex-1 py-4 rounded-2xl font-bold text-lg shadow-sm border-2 transition-all ${
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
          <button
            className="btn-bounce px-5 py-4 rounded-2xl font-bold text-lg shadow-sm border-2 bg-white border-dashed border-violet-300 text-violet-600 hover:bg-violet-50 transition-all disabled:opacity-40"
            disabled={uploading}
            onClick={() => albumInputRef.current?.click()}
            title="Upload from album"
          >
            🖼️
          </button>
        </div>

        {/* Photo strip */}
        {sectionPhotos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sectionPhotos.map((photo) => (
              <div key={photo._id} className="relative shrink-0">
                <img
                  src={photo.publicUrl}
                  alt="section photo"
                  className="w-20 h-20 object-cover rounded-xl border-2 border-white shadow-sm"
                />
                <span className="absolute bottom-0.5 right-0.5 text-sm">
                  {ANALYSIS_ICONS[photo.analysisStatus]}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Violations */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
            ⚠️ Violations
            <span className="ml-auto bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5 rounded-full">
              {violations?.length ?? 0}
            </span>
          </h2>
          {(violations ?? []).length === 0 ? (
            <p className="text-gray-400 text-sm">
              No violations yet — AI results appear here automatically ✨
            </p>
          ) : (
            <div className="space-y-2">
              {(violations ?? []).map((v) => {
                const cfg = SEV_CONFIG[v.severity ?? "low"] ?? SEV_CONFIG.low;
                return (
                  <div key={v._id} className={`rounded-xl p-3 text-sm ${cfg.bar} ${cfg.bg}`}>
                    <p className={`font-semibold ${cfg.text}`}>{v.description}</p>
                    <div className="flex gap-1 mt-1.5">
                      <Badge variant="outline" className="text-xs capitalize">
                        {v.severity ?? "N/A"}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {v.aiGenerated ? "🤖 AI" : "✏️ Manual"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Note input */}
        {lastUploadedPhotoId && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="font-bold text-gray-800 mb-2">📝 Note for last photo</h2>
            <div className="flex gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note or tap the mic..."
                rows={2}
                className="flex-1 text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-sky-400 resize-none transition-colors"
              />
              <button
                className={`px-3 py-2 rounded-xl text-xl transition-all ${
                  listening
                    ? "animate-pulse bg-red-100 border-2 border-red-400"
                    : "bg-gray-100 hover:bg-gray-200 border-2 border-transparent"
                }`}
                onClick={handleMic}
                title="Speech to text"
              >
                🎤
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button
                className="btn-bounce px-4 py-1.5 text-sm rounded-full bg-sky-100 text-sky-700 font-semibold hover:bg-sky-200 transition-colors disabled:opacity-50"
                onClick={handleSaveNote}
                disabled={savingNote}
              >
                {savingNote ? "Saving..." : "Save Note"}
              </button>
              {noteSaved && <span className="text-xs text-green-600 font-medium">✓ Saved!</span>}
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-white/90 backdrop-blur border-t border-gray-100">
        <button
          className="btn-bounce w-full py-4 rounded-2xl font-bold text-lg gradient-success text-white shadow-lg"
          onClick={handleNextHouse}
        >
          {nextProperty ? `Next House → 🏠` : "Complete Street 🎉"}
        </button>
      </div>
    </div>
  );
}
