import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type VersionRow = {
  _id: Id<"letterTemplateVersions">;
  savedAt: number;
  source: "save" | "upload" | "revert" | "seed";
  note?: string;
  preview: string;
};

const SOURCE_LABELS: Record<VersionRow["source"], string> = {
  save: "Save",
  upload: "Upload",
  revert: "Restored",
  seed: "Initial",
};

export function LetterTemplateVersionHistory({
  templateDocId,
  onRestored,
}: {
  templateDocId: Id<"letterTemplateDocs">;
  onRestored: (templateText: string) => void;
}) {
  const versions = useQuery(api.letterTemplateDocs.listVersions, { templateDocId });
  const [viewingId, setViewingId] = useState<Id<"letterTemplateVersions"> | null>(null);
  const versionDetail = useQuery(
    api.letterTemplateDocs.getVersion,
    viewingId ? { versionId: viewingId } : "skip",
  );
  const revertToVersion = useMutation(api.letterTemplateDocs.revertToVersion);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");

  const confirmRestore = async () => {
    if (!viewingId) return;
    setRestoring(true);
    setError("");
    try {
      const result = await revertToVersion({ versionId: viewingId });
      onRestored(result.templateText);
      setViewingId(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setRestoring(false);
    }
  };

  if (versions === undefined) {
    return <p className="text-xs text-muted-foreground">Loading version history…</p>;
  }

  if (versions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No saved versions yet. Click Save to create the first checkpoint.
      </p>
    );
  }

  return (
    <div className="space-y-2 border-t pt-3 mt-2">
      <p className="text-xs font-medium text-gray-700">Version history</p>
      {error && !viewingId && <p className="text-xs text-red-600">{error}</p>}
      <ul className="max-h-48 overflow-y-auto rounded border divide-y text-xs">
        {versions.map((version) => (
          <li key={version._id} className="flex items-start justify-between gap-2 p-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-800">
                {new Date(version.savedAt).toLocaleString()}
                <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-600">
                  {SOURCE_LABELS[version.source]}
                </span>
              </p>
              {version.note && <p className="text-muted-foreground">{version.note}</p>}
              <p className="text-muted-foreground truncate">{version.preview}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 h-7 text-xs"
              onClick={() => {
                setError("");
                setViewingId(version._id);
              }}
            >
              View
            </Button>
          </li>
        ))}
      </ul>

      <Dialog open={viewingId !== null} onOpenChange={(open) => !open && setViewingId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {versionDetail
                ? `Letter template — ${new Date(versionDetail.savedAt).toLocaleString()}`
                : "Letter template version"}
            </DialogTitle>
            <DialogDescription>
              {versionDetail ? (
                <>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                    {SOURCE_LABELS[versionDetail.source]}
                  </span>
                  {versionDetail.note ? ` — ${versionDetail.note}` : null}
                </>
              ) : (
                "Loading version…"
              )}
            </DialogDescription>
          </DialogHeader>

          {versionDetail === undefined && (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          )}
          {versionDetail === null && viewingId !== null && (
            <p className="text-sm text-red-600 py-4">Version not found.</p>
          )}
          {versionDetail && (
            <Textarea
              readOnly
              value={versionDetail.templateText}
              rows={20}
              className="font-serif text-sm flex-1 min-h-[280px] resize-none"
            />
          )}

          {error && viewingId && <p className="text-xs text-red-600">{error}</p>}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setViewingId(null)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!versionDetail || restoring}
              onClick={() => void confirmRestore()}
              className="bg-[#4f46e5] hover:bg-[#4338ca] text-white"
            >
              {restoring ? "Restoring…" : "Restore this version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
