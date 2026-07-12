import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

/**
 * The evaluation moment: homeowner fix photos awaiting review, with the two
 * real answers. Approving marks the photo resolved; whether that also closes
 * a case is the caller's follow-up (see onApproved).
 */
export function FixPhotoReviewStrip({
  propertyId,
  onApproved,
}: {
  propertyId: Id<"properties">;
  /** Called after "Looks fixed" succeeds — e.g. to offer resolving the case. */
  onApproved?: () => void;
}) {
  const fixPhotos = useQuery(api.fixPhotos.listByProperty, { propertyId });
  const setVerification = useMutation(api.fixPhotos.setVerification);

  const pending = (fixPhotos ?? []).filter(
    (p) => p.verificationStatus === "pending" || p.verificationStatus === "needsReview",
  );
  if (pending.length === 0) return null;

  return (
    <div className="space-y-2">
      {pending.map((fp) => (
        <div
          key={fp._id}
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-paper px-3 py-2.5"
        >
          <a href={fp.publicUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <img
              src={fp.publicUrl}
              alt="Homeowner fix photo"
              className="h-11 w-11 rounded-md border object-cover"
            />
          </a>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold">Fix photo to review</p>
            <p className="text-xs text-ink-2">
              From the homeowner · {new Date(fp.uploadedAt).toLocaleDateString()}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-[#2c6446] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            onClick={async () => {
              await setVerification({ id: fp._id, status: "resolved", note: fp.verificationNote ?? "" });
              onApproved?.();
            }}
          >
            ✓ Looks fixed
          </button>
          <button
            type="button"
            className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold hover:bg-paper"
            onClick={() =>
              void setVerification({ id: fp._id, status: "notResolved", note: fp.verificationNote ?? "" })
            }
          >
            Needs another look
          </button>
        </div>
      ))}
    </div>
  );
}
