import { useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { enqueuePhoto } from "@/offline/outbox";
import { syncNow } from "@/offline/syncManager";
import { hasNativeCamera, takePhoto } from "@/native/camera";
import { useHomeProperty } from "./HomeLayout";
import { VerificationBadge } from "./homeUi";

export default function FixPhotos() {
  const { selected } = useHomeProperty();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fixPhotos = useQuery(
    api.fixPhotos.listForHomeowner,
    selected ? { propertyId: selected.propertyId } : "skip",
  );

  const handleUpload = async (file: File) => {
    if (!selected) return;
    setUploading(true);
    setError(null);
    try {
      // Queue to the outbox: resilient uploads + works if the signal drops.
      await enqueuePhoto({
        propertyId: selected.propertyId,
        section: "fix",
        file,
        kind: "fixPhoto",
      });
      void syncNow();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}. Please try again.`
          : "Upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleCapture = async () => {
    if (hasNativeCamera()) {
      try {
        const file = await takePhoto();
        await handleUpload(file);
      } catch {
        setError("Camera capture failed. Please try again.");
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const photos = fixPhotos ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Fix photos</h1>

      <section className="rounded-2xl bg-white border border-slate-200 p-5">
        <p className="font-semibold text-slate-900">Verify a completed fix</p>
        <p className="text-sm text-slate-500">
          Take or choose a photo of the resolved item. Your HOA will review it.
        </p>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          ref={fileInputRef}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => void handleCapture()}
          className="btn-bounce mt-3 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {uploading ? "Saving…" : "📷 Upload fix photo"}
        </button>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </section>

      <div className="space-y-3">
        {photos.map((fp) => (
          <div
            key={fp._id}
            className="flex items-start gap-3 rounded-2xl bg-white border border-slate-200 p-3"
          >
            <img
              src={fp.publicUrl}
              alt="Submitted fix photo"
              loading="lazy"
              decoding="async"
              className="h-20 w-20 rounded-lg border object-cover"
            />
            <div className="min-w-0">
              <VerificationBadge status={fp.verificationStatus} />
              {fp.verificationNote && (
                <p className="mt-1 text-xs text-slate-500">{fp.verificationNote}</p>
              )}
            </div>
          </div>
        ))}

        {fixPhotos !== undefined && photos.length === 0 && (
          <div className="py-10 text-center text-slate-500">
            <p>No fix photos yet</p>
            <p className="text-sm">Upload one above to send an update.</p>
          </div>
        )}
      </div>
    </div>
  );
}
