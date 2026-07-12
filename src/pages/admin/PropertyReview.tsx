import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { Trash2, ArrowRightLeft } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MovePhotoDialog } from "@/components/MovePhotoDialog";
import AdminShell from "@/components/admin/AdminShell";
import { InspectionCard } from "@/components/property/InspectionCard";
import { PreviousInspectionsCard } from "@/components/property/PreviousInspectionsCard";
import { CasesCard } from "@/components/property/CasesCard";
import { DetailsRail } from "@/components/property/DetailsRail";
import { LetterComposeDialog } from "@/components/property/LetterComposeDialog";

/**
 * The household record: header, this season's inspection first, the prior
 * season's record, then cases/requests — case detail is its own page.
 */
export default function PropertyReview() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const pid = propertyId as Id<"properties">;

  const property = useQuery(api.properties.get, { id: pid });
  const viewer = useQuery(api.tenancy.viewerContext, {});
  const photos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const fixPhotos = useQuery(api.fixPhotos.listByProperty, { propertyId: pid });
  const streets = useQuery(api.streets.list);
  const arcReviewSettings = useQuery(api.arcReviewSettings.get, {});

  const updateEmail = useMutation(api.properties.updateEmail);
  const updateHomeownerNames = useMutation(api.properties.updateHomeownerNames);
  const removePhotoForInspector = useAction(api.photos.removeForInspector);

  const casesEnabled = viewer?.features?.includes("cases") ?? false;
  const arcEnabled = arcReviewSettings?.showArcApplicationOnPropertyPage ?? false;

  const nameClerkIds = useMemo(() => {
    if (!property) return [] as string[];
    const ids = [
      property.inspectionNotesEnteredByClerkUserId,
      property.inspectionNotesLastUpdatedByClerkUserId,
      property.inspectionDetailsVerifiedByClerkUserId,
    ].filter((x): x is string => !!x);
    return [...new Set(ids)];
  }, [property]);
  const displayNames = useQuery(
    api.members.displayNamesByClerkIds,
    nameClerkIds.length > 0 ? { clerkUserIds: nameClerkIds } : "skip",
  );
  const nameFor = (id?: string) => (!id ? "" : displayNames?.[id]?.trim() || "Team member");

  const [toast, setToast] = useState("");
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // Header edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [namesInput, setNamesInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [savingHeader, setSavingHeader] = useState(false);
  useEffect(() => {
    setNamesInput(property?.homeownerNames ?? "");
    setEmailInput(property?.email ?? "");
  }, [property?.homeownerNames, property?.email]);

  const [newCaseFormOpen, setNewCaseFormOpen] = useState(false);
  const [letterOpen, setLetterOpen] = useState(false);

  // Photo lightbox / delete / move (unchanged behavior from the old page)
  const allPhotos = photos ?? [];
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const selectedPhoto = photoIndex !== null ? allPhotos[photoIndex] : undefined;
  const [deleteTarget, setDeleteTarget] = useState<{ id: Id<"photos"> } | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);

  const handleConfirmDeletePhoto = () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    const n = allPhotos.length;
    const i = photoIndex ?? 0;
    setDeleteSubmitting(true);
    void removePhotoForInspector({ id, propertyId: pid })
      .then(() => {
        setDeleteTarget(null);
        setPhotoIndex(n <= 1 ? null : Math.min(i, n - 2));
        showToast("Photo deleted");
      })
      .catch((err) => {
        console.error(err);
        const msg = err instanceof Error ? err.message : String(err);
        alert(
          msg.includes("upload server")
            ? `Photo was removed from the inspection, but the file on the upload server could not be deleted: ${msg}`
            : msg || "Could not delete photo. Please try again.",
        );
      })
      .finally(() => setDeleteSubmitting(false));
  };

  if (!property) {
    return (
      <AdminShell active="properties">
        <p className="py-16 text-center text-sm text-ink-2">Loading property…</p>
      </AdminShell>
    );
  }

  const streetName = streets?.find((s) => s._id === property.streetId)?.name;
  const fixPhotoPendingCount = (fixPhotos ?? []).filter(
    (p) => p.verificationStatus === "pending" || p.verificationStatus === "needsReview",
  ).length;

  return (
    <AdminShell active="properties">
      {toast && (
        <div className="mb-3 rounded-xl border border-[#dbe6dc] bg-[#e5efe8] p-3 text-sm font-medium text-[#2c6446]">
          {toast}
        </div>
      )}

      <div className="mb-3.5 flex flex-wrap items-center gap-4 rounded-xl border bg-white px-4 py-3.5">
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold">{property.address}</h1>
          <p className="truncate text-xs text-ink-2">
            {property.homeownerNames || "Owner not on file"}
            {property.email && <> · {property.email}</>}
            {" · "}
            <button
              type="button"
              className="font-semibold text-petrol hover:underline"
              onClick={() => setEditOpen(true)}
            >
              edit
            </button>
          </p>
        </div>
        {casesEnabled && (
          <Button size="sm" className="ml-auto" onClick={() => setNewCaseFormOpen(true)}>
            + New case
          </Button>
        )}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-3.5">
          <InspectionCard
            property={property}
            photos={allPhotos}
            nameFor={nameFor}
            onOpenPhoto={setPhotoIndex}
            onOpenLetter={() => setLetterOpen(true)}
            showToast={showToast}
          />
          <PreviousInspectionsCard property={property} showToast={showToast} />
          {(casesEnabled || arcEnabled) && (
            <CasesCard
              propertyId={pid}
              casesEnabled={casesEnabled}
              arcEnabled={arcEnabled}
              showForm={newCaseFormOpen}
              onFormClosed={() => setNewCaseFormOpen(false)}
              showToast={showToast}
            />
          )}
        </div>
        <DetailsRail
          property={property}
          streetName={streetName}
          fixPhotoPendingCount={fixPhotoPendingCount}
          casesEnabled={casesEnabled}
          onViewLetter={() => setLetterOpen(true)}
          showToast={showToast}
        />
      </div>

      {/* Owner contact edit */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Owner &amp; contact</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs text-ink-2">Homeowner name(s)</p>
              <Input
                value={namesInput}
                onChange={(e) => setNamesInput(e.target.value)}
                placeholder="e.g. Jane and John Doe"
              />
            </div>
            <div>
              <p className="mb-1 text-xs text-ink-2">Email</p>
              <Input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="homeowner@example.com"
                type="email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={savingHeader}
              onClick={async () => {
                setSavingHeader(true);
                try {
                  await Promise.all([
                    updateHomeownerNames({ id: pid, homeownerNames: namesInput }),
                    updateEmail({ id: pid, email: emailInput }),
                  ]);
                  setEditOpen(false);
                  showToast("Owner details saved");
                } finally {
                  setSavingHeader(false);
                }
              }}
            >
              {savingHeader ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LetterComposeDialog
        propertyId={pid}
        propertyEmail={property.email}
        letterSentAt={property.letterSentAt}
        open={letterOpen}
        onOpenChange={setLetterOpen}
        showToast={showToast}
      />

      {/* Inspection photo lightbox */}
      <Dialog
        open={photoIndex !== null && !!selectedPhoto}
        onOpenChange={(open) => {
          if (!open) setPhotoIndex(null);
        }}
      >
        <DialogContent className="max-w-[min(95vw,56rem)] gap-0 p-0 sm:max-w-[min(95vw,56rem)]">
          {selectedPhoto && photoIndex !== null && (
            <>
              <DialogHeader className="space-y-0 px-6 pb-2 pr-14 pt-6 text-left">
                <DialogTitle>
                  Photo {photoIndex + 1} / {allPhotos.length}
                </DialogTitle>
              </DialogHeader>
              <div className="px-6 pb-4">
                <img
                  src={selectedPhoto.publicUrl ?? selectedPhoto.thumbnailPublicUrl ?? ""}
                  alt=""
                  className="mx-auto max-h-[min(85vh,880px)] w-full rounded-md bg-muted object-contain"
                />
              </div>
              {selectedPhoto.inspectorNote?.trim() ? (
                <p className="whitespace-pre-wrap border-t px-6 py-3 text-sm text-ink-2">
                  {selectedPhoto.inspectorNote}
                </p>
              ) : null}
              <DialogFooter className="border-t px-6 py-4 sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setMoveDialogOpen(true)}>
                    <ArrowRightLeft className="h-4 w-4 shrink-0" aria-hidden />
                    Move to another property
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteTarget({ id: selectedPhoto._id })}
                  >
                    <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                    Delete photo
                  </Button>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={selectedPhoto.publicUrl ?? selectedPhoto.thumbnailPublicUrl ?? ""}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in new tab
                  </a>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="z-[100] max-w-[min(92vw,22rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              It will be removed from this inspection. Linked violation notes stay, but will no
              longer show this image. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogCancel className="w-full sm:w-full" disabled={deleteSubmitting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="w-full bg-red-600 text-white hover:bg-red-700 focus:ring-red-600 sm:w-full"
              disabled={deleteSubmitting}
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDeletePhoto();
              }}
            >
              {deleteSubmitting ? "Deleting…" : "Delete photo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MovePhotoDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        photo={selectedPhoto ?? null}
        fromPropertyId={pid}
        currentStreetId={property.streetId}
        onMoved={(toAddress) => {
          setMoveDialogOpen(false);
          setPhotoIndex(null);
          showToast(`Photo moved to ${toAddress}`);
        }}
      />
    </AdminShell>
  );
}
