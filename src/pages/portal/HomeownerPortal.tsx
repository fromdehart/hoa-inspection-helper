import { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { uploadPhoto } from "@/lib/uploadClient";

const SEV_COLORS: Record<string, string> = {
  high: "bg-red-50 border border-red-200",
  medium: "bg-amber-50 border border-amber-200",
  low: "bg-green-50 border border-green-200",
};

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
  const [uploadingForViolationId, setUploadingForViolationId] = useState<string | null>(null);
  const fileInputsRef = useRef<Map<string, HTMLInputElement>>(new Map());

  const property = useQuery(api.properties.getByToken, { token: token ?? "" });
  const violations = useQuery(
    api.violations.listByProperty,
    property ? { propertyId: property._id as Id<"properties"> } : "skip",
  );
  const photos = useQuery(
    api.photos.listByProperty,
    property ? { propertyId: property._id as Id<"properties"> } : "skip",
  );
  const fixPhotos = useQuery(
    api.fixPhotos.listByProperty,
    property ? { propertyId: property._id as Id<"properties"> } : "skip",
  );

  const createFixPhoto = useMutation(api.fixPhotos.create);

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

  const handleFixUpload = async (
    violationId: Id<"violations">,
    file: File,
  ) => {
    setUploadingForViolationId(violationId);
    try {
      const result = await uploadPhoto(file, pid, "fix");
      await createFixPhoto({
        propertyId: pid,
        violationId,
        filePath: result.filePath,
        publicUrl: result.publicUrl,
      });
    } catch (err) {
      alert("Upload failed: " + String(err));
    } finally {
      setUploadingForViolationId(null);
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
            {violations?.length ?? 0} violation(s)
          </span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="space-y-4">
          {(violations ?? []).map((v) => {
            const evidencePhoto = (photos ?? []).find((p) => p._id === v.photoId);
            const fixPhotosForV = (fixPhotos ?? []).filter((fp) => fp.violationId === v._id);
            const isUploading = uploadingForViolationId === v._id;

            return (
              <div
                key={v._id}
                className={`rounded-2xl p-4 shadow-sm border border-gray-100 bg-white ${SEV_COLORS[v.severity ?? "low"] ?? "border"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">{v.description}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {v.severity ?? "N/A"}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Evidence photo */}
                {evidencePhoto && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1">Evidence</p>
                    <img
                      src={evidencePhoto.publicUrl}
                      alt="violation evidence"
                      className="w-full max-h-48 object-cover rounded"
                    />
                  </div>
                )}

                {/* Fix photos */}
                {fixPhotosForV.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Your submissions</p>
                    {fixPhotosForV.map((fp) => {
                      const ui = VERIFICATION_UI[fp.verificationStatus];
                      return (
                        <div key={fp._id} className="flex items-start gap-3">
                          <img
                            src={fp.publicUrl}
                            alt="fix photo"
                            className="w-16 h-16 object-cover rounded border"
                          />
                          <div>
                            <Badge
                              variant={ui.color as any}
                              className="text-xs"
                            >
                              {ui.label}
                            </Badge>
                            {fp.verificationNote && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {fp.verificationNote}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Upload fix photo */}
                <div className="mt-3">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    ref={(el) => {
                      if (el) fileInputsRef.current.set(v._id, el);
                    }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFixUpload(v._id as Id<"violations">, file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isUploading}
                    onClick={() => fileInputsRef.current.get(v._id)?.click()}
                  >
                    {isUploading ? "Uploading..." : "Upload Fix Photo"}
                  </Button>
                </div>
              </div>
            );
          })}

          {(violations ?? []).length === 0 && violations !== undefined && (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg">No violations on record</p>
              <p className="text-sm mt-1">Your property is in good standing.</p>
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
