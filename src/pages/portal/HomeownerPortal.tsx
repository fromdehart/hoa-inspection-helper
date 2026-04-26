import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { uploadPhoto } from "@/lib/uploadClient";

const VERIFICATION_UI: Record<
  string,
  { label: string; color: string }
> = {
  pending: { label: "Verifying...", color: "secondary" },
  resolved: { label: "✓ Resolved", color: "default" },
  notResolved: { label: "✗ Still present", color: "destructive" },
  needsReview: { label: "Under review", color: "outline" },
};

export default function HomeownerPortal() {
  const { token } = useParams<{ token: string }>();
  const [uploadingFixPhoto, setUploadingFixPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const property = useQuery(api.properties.getByToken, { token: token ?? "" });
  const fixPhotos = useQuery(api.fixPhotos.listByToken, token ? { token } : "skip");

  const createFixPhoto = useMutation(api.fixPhotos.createByToken);

  if (property === undefined) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gradient-hero">
        <div className="text-5xl animate-spin mb-4">🔄</div>
        <p className="text-white font-medium">Loading portal…</p>
      </div>
    );
  }

  if (property === null) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 text-center max-w-sm">
          <p className="text-white font-semibold">Portal link not found.</p>
          <p className="text-sky-200 text-sm mt-2">Check the link from your letter or contact the HOA.</p>
        </div>
      </div>
    );
  }

  const pid = property._id as Id<"properties">;

  const handleFixUpload = async (file: File) => {
    setUploadingFixPhoto(true);
    try {
      const result = await uploadPhoto(file, pid, "fix");
      await createFixPhoto({
        token: token ?? "",
        filePath: result.filePath,
        publicUrl: result.publicUrl,
      });
    } catch (err) {
      alert("Upload failed: " + String(err));
    } finally {
      setUploadingFixPhoto(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-inspector px-4 pt-8 pb-6">
        <p className="text-sky-100 text-xs font-medium uppercase tracking-widest text-center">Homeowner portal</p>
        <h1 className="text-xl font-extrabold text-white text-center mt-1 truncate px-2">{property.address}</h1>
        <p className="text-sky-200 text-sm text-center mt-1">HOA inspection results</p>
        <div className="flex justify-center mt-3">
          <span className="inline-flex items-center rounded-full bg-white/20 text-white text-xs font-semibold px-3 py-1 border border-white/30">
            {(fixPhotos ?? []).length} submitted fix photo(s)
          </span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="rounded-2xl p-4 shadow-sm border border-gray-100 bg-white mb-4">
          <p className="font-medium">Upload a fix photo</p>
          <p className="text-sm text-muted-foreground mt-1">
            Submit updated exterior photos for HOA review.
          </p>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFixUpload(file);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploadingFixPhoto}
            onClick={() => fileInputRef.current?.click()}
            className="mt-3"
          >
            {uploadingFixPhoto ? "Uploading..." : "Upload Fix Photo"}
          </Button>
        </div>

        <div className="space-y-4">
          {(fixPhotos ?? []).map((fp) => {
            const ui = VERIFICATION_UI[fp.verificationStatus] ?? VERIFICATION_UI.needsReview;
            return (
              <div key={fp._id} className="rounded-2xl p-4 shadow-sm border border-gray-100 bg-white">
                <div className="flex items-start gap-3">
                  <img
                    src={fp.publicUrl}
                    alt="fix photo"
                    className="w-20 h-20 object-cover rounded border"
                  />
                  <div>
                    <p className="text-sm font-medium">{ui.label}</p>
                    {fp.verificationNote && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {fp.verificationNote}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {(fixPhotos ?? []).length === 0 && fixPhotos !== undefined && (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg">No fix photos submitted yet</p>
              <p className="text-sm mt-1">Upload a photo above to send an update.</p>
            </div>
          )}
        </div>

        <footer className="mt-10 pt-6 text-center text-sm text-gray-500">
          Questions? Contact your HOA.
        </footer>
      </div>
    </div>
  );
}
