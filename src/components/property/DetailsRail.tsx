import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FixPhotoReviewStrip } from "@/components/cases/FixPhotoReviewStrip";

type PropertyDoc = Doc<"properties">;

export function DetailsRail({
  property,
  streetName,
  fixPhotoPendingCount,
  casesEnabled,
  onViewLetter,
  showToast,
}: {
  property: PropertyDoc;
  streetName: string | undefined;
  fixPhotoPendingCount: number;
  casesEnabled: boolean;
  onViewLetter: () => void;
  showToast: (msg: string) => void;
}) {
  const updateStatus = useMutation(api.properties.updateStatus);

  const portalUrl = `${window.location.origin}/portal/${property.accessToken}`;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-white p-4">
        <h2 className="text-[13px] font-bold">Details</h2>
        <dl className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-2">
          <div>
            Latest letter —{" "}
            {property.letterSentAt ? (
              <>sent {new Date(property.letterSentAt).toLocaleDateString()} ✓ </>
            ) : property.generatedLetterAt ? (
              <>draft {new Date(property.generatedLetterAt).toLocaleDateString()} </>
            ) : (
              <>none yet </>
            )}
            {(property.generatedLetterAt || property.letterSentAt) && (
              <button
                type="button"
                className="font-semibold text-petrol hover:underline"
                onClick={onViewLetter}
              >
                view
              </button>
            )}
          </div>
          <div>Street — {streetName ?? "—"}</div>
          <div>
            Portal link —{" "}
            <button
              type="button"
              className="font-semibold text-petrol hover:underline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(portalUrl);
                  showToast("Portal link copied");
                } catch {
                  showToast(portalUrl);
                }
              }}
            >
              copy ⧉
            </button>
          </div>
          <div>
            Fix photos to review — {fixPhotoPendingCount > 0 ? <b className="text-ink">{fixPhotoPendingCount}</b> : "0"}
          </div>
        </dl>
      </div>

      {/* Without the cases feature there is no case page to host status or fix
          review, so both live here (legacy behavior, new skin). */}
      {!casesEnabled && (
        <div className="space-y-3 rounded-xl border bg-white p-4">
          <div>
            <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
              Property status
            </p>
            <Select
              value={property.status}
              onValueChange={async (v) => {
                await updateStatus({
                  id: property._id,
                  status: v as PropertyDoc["status"],
                });
                showToast("Status updated");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="notStarted">Not started</SelectItem>
                <SelectItem value="inProgress">In progress</SelectItem>
                <SelectItem value="review">Ready to review</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <FixPhotoReviewStrip propertyId={property._id} />
        </div>
      )}
    </div>
  );
}
