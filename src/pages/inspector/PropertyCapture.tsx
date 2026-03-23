import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { uploadPhoto } from "@/lib/uploadClient";

type Section = "front" | "side" | "back";

const ANALYSIS_ICONS: Record<string, string> = {
  pending: "⏳",
  processing: "🔄",
  done: "✅",
  error: "❌",
};

const SEV_BORDER: Record<string, string> = {
  high: "border-l-4 border-red-500 bg-red-50",
  medium: "border-l-4 border-amber-500 bg-amber-50",
  low: "border-l-4 border-green-500 bg-green-50",
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

  // Compute next property in walk order
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
      console.error("Photo upload failed:", err);
      alert("Upload failed: " + String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background pb-20 flex flex-col">
      {/* Top: address + section tabs */}
      <div className="border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            className="text-sm text-blue-600 hover:underline"
            onClick={() => navigate(`/inspector/street/${property.streetId}`)}
          >
            ← Back
          </button>
          <h1 className="font-semibold text-sm truncate max-w-xs">{property.address}</h1>
          <div className="w-12" />
        </div>
        <div className="flex px-4 gap-4 pb-2">
          {(["front", "side", "back"] as Section[]).map((sec) => (
            <button
              key={sec}
              className={`text-sm pb-1 capitalize transition-colors ${
                currentSection === sec
                  ? "font-bold border-b-2 border-primary"
                  : "text-muted-foreground"
              }`}
              onClick={() => setCurrentSection(sec)}
            >
              {sec}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Camera capture */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoSelected}
          />
          <Button
            className="w-full h-12"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin">⏳</span> Uploading...
              </span>
            ) : (
              "Take Photo"
            )}
          </Button>
        </div>

        {/* Photo thumbnails for current section */}
        {sectionPhotos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sectionPhotos.map((photo) => (
              <div key={photo._id} className="relative shrink-0">
                <img
                  src={photo.publicUrl}
                  alt="section photo"
                  className="w-20 h-20 object-cover rounded border"
                />
                <span className="absolute bottom-0.5 right-0.5 text-sm">
                  {ANALYSIS_ICONS[photo.analysisStatus]}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Violations panel */}
        <div>
          <h2 className="text-sm font-semibold mb-2">
            Violations ({violations?.length ?? 0})
          </h2>
          {(violations ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No violations yet — AI results appear here automatically
            </p>
          ) : (
            <div className="space-y-2">
              {(violations ?? []).map((v) => (
                <div
                  key={v._id}
                  className={`rounded p-2 text-sm ${SEV_BORDER[v.severity ?? "low"] ?? "border-l-4"}`}
                >
                  <p className="font-medium">{v.description}</p>
                  <div className="flex gap-1 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {v.severity ?? "N/A"}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {v.aiGenerated ? "AI" : "Manual"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Note textarea */}
        {lastUploadedPhotoId && (
          <div>
            <h2 className="text-sm font-semibold mb-1">Note for last photo</h2>
            <div className="flex gap-2">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add note or tap mic..."
                rows={2}
                className="flex-1 text-sm"
              />
              <button
                className={`px-3 py-1 rounded border text-lg transition-colors ${
                  listening ? "animate-pulse bg-red-100 border-red-400" : "hover:bg-accent"
                }`}
                onClick={handleMic}
                title="Speech to text"
              >
                🎤
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Button size="sm" variant="outline" onClick={handleSaveNote} disabled={savingNote}>
                {savingNote ? "Saving..." : "Save Note"}
              </Button>
              {noteSaved && <span className="text-xs text-green-600">Saved</span>}
            </div>
          </div>
        )}
      </div>

      {/* Sticky Next House bar */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-background border-t">
        <Button
          className="w-full h-12 text-base bg-green-600 hover:bg-green-700 text-white"
          onClick={handleNextHouse}
        >
          {nextProperty ? `Next House →` : "Complete Street ✓"}
        </Button>
      </div>
    </div>
  );
}
