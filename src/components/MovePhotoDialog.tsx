import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type MovePhotoTarget = {
  _id: Id<"photos">;
  section: "front" | "side" | "back";
  publicUrl?: string;
  thumbnailPublicUrl?: string;
};

type MovePhotoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photo: MovePhotoTarget | null;
  fromPropertyId: Id<"properties">;
  currentStreetId: Id<"streets">;
  onMoved: (toAddress: string) => void;
};

export function MovePhotoDialog({
  open,
  onOpenChange,
  photo,
  fromPropertyId,
  currentStreetId,
  onMoved,
}: MovePhotoDialogProps) {
  const [searchAllStreets, setSearchAllStreets] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedToPropertyId, setSelectedToPropertyId] = useState<Id<"properties"> | "">("");
  const [section, setSection] = useState<"front" | "side" | "back">("front");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const reassignToProperty = useMutation(api.photos.reassignToProperty);

  const properties = useQuery(
    api.properties.list,
    open
      ? searchAllStreets
        ? {}
        : { streetId: currentStreetId }
      : "skip",
  );

  useEffect(() => {
    if (!open || !photo) return;
    setSearchAllStreets(false);
    setSearchQuery("");
    setSelectedToPropertyId("");
    setSection(photo.section);
    setError("");
  }, [open, photo?._id, photo?.section]);

  const filteredProperties = useMemo(() => {
    if (!properties) return [];
    const q = searchQuery.trim().toLowerCase();
    return properties
      .filter((p) => p._id !== fromPropertyId)
      .filter((p) => {
        if (!q) return true;
        return (
          p.address.toLowerCase().includes(q) ||
          String(p.houseNumber).includes(q)
        );
      })
      .sort((a, b) => a.address.localeCompare(b.address));
  }, [properties, fromPropertyId, searchQuery]);

  const previewUrl = photo?.publicUrl ?? photo?.thumbnailPublicUrl ?? "";

  const handleConfirm = async () => {
    if (!photo || !selectedToPropertyId) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await reassignToProperty({
        id: photo._id,
        fromPropertyId,
        toPropertyId: selectedToPropertyId,
        section,
      });
      onMoved(result.toAddress);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move photo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-[min(95vw,28rem)] gap-4">
        <DialogHeader>
          <DialogTitle>Move photo to another property</DialogTitle>
          <DialogDescription>
            The photo will appear on the selected property. The image file stays at its current URL.
          </DialogDescription>
        </DialogHeader>

        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="mx-auto h-24 w-full max-w-[12rem] rounded-lg border object-cover"
          />
        ) : null}

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={searchAllStreets}
              onChange={(e) => {
                setSearchAllStreets(e.target.checked);
                setSelectedToPropertyId("");
              }}
              className="rounded border-gray-300"
            />
            Search all streets
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="move-photo-search">Find property</Label>
            <Input
              id="move-photo-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="House number or address"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Target property</Label>
            <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
              {properties === undefined ? (
                <p className="p-3 text-sm text-muted-foreground">Loading…</p>
              ) : filteredProperties.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No matching properties.</p>
              ) : (
                filteredProperties.map((p) => (
                  <button
                    key={p._id}
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                      selectedToPropertyId === p._id ? "bg-sky-50 font-semibold text-sky-900" : ""
                    }`}
                    onClick={() => setSelectedToPropertyId(p._id)}
                  >
                    {p.address}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Section</Label>
            <Select value={section} onValueChange={(v) => setSection(v as "front" | "side" | "back")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="front">Front</SelectItem>
                <SelectItem value="side">Side</SelectItem>
                <SelectItem value="back">Back</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || !selectedToPropertyId}
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Moving…" : "Move photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
