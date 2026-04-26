import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const OWNER_WORKFLOW_ENABLED = false;

type AdminFieldsDraft = {
  previousInspectionSummary: string;
  priorOwnerLetterNotes2024: string;
};

export default function PropertyReview() {
  const navigate = useNavigate();
  const { propertyId } = useParams<{ propertyId: string }>();
  const pid = propertyId as Id<"properties">;

  const [emailInput, setEmailInput] = useState("");
  const [homeownerNamesInput, setHomeownerNamesInput] = useState("");
  const [statusInput, setStatusInput] = useState<"notStarted" | "inProgress" | "complete">("notStarted");
  const [adminFieldsDraft, setAdminFieldsDraft] = useState<AdminFieldsDraft>({
    previousInspectionSummary: "",
    priorOwnerLetterNotes2024: "",
  });
  const [letterHtml, setLetterHtml] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiBulletsBusy, setAiBulletsBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [editingInspectorNotes, setEditingInspectorNotes] = useState(false);
  const [inspectorNotesDraft, setInspectorNotesDraft] = useState("");
  const [aiBulletsDraft, setAiBulletsDraft] = useState("");
  const [aiBulletsSaveState, setAiBulletsSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [aiBulletsLastSavedAt, setAiBulletsLastSavedAt] = useState<number | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<{
    url: string;
    title: string;
    caption?: string;
  } | null>(null);

  const property = useQuery(api.properties.get, { id: pid });
  const photos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const fixPhotos = useQuery(api.fixPhotos.listByProperty, { propertyId: pid });
  const storedLetter = useQuery(api.properties.getLetterHtml, { id: pid });

  const updateEmail = useMutation(api.properties.updateEmail);
  const updateHomeownerNames = useMutation(api.properties.updateHomeownerNames);
  const updateStatus = useMutation(api.properties.updateStatus);
  const updateAdminPropertyFields = useMutation(api.properties.updateAdminPropertyFields);
  const updateInspectorNotes = useMutation(api.properties.updateInspectorNotes);
  const saveGeneratedLetterHtml = useMutation(api.properties.saveGeneratedLetterHtml);
  const setFixVerification = useMutation(api.fixPhotos.setVerification);
  const generateLetter = useAction(api.letters.generate);
  const sendLetter = useAction(api.letters.send);
  const generateAiLetterBullets = useAction(api.inspectionBullets.generateFromInspectorNotes);
  const updateAiLetterBullets = useMutation(api.properties.updateAiLetterBullets);
  const aiBulletsAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiBulletsHydratedForPropertyIdRef = useRef<Id<"properties"> | null>(null);
  const aiBulletsInitializedRef = useRef(false);
  const lastPersistedAiBulletsRef = useRef("");

  useEffect(() => {
    if (property?.email) setEmailInput(property.email);
    else setEmailInput("");
  }, [property?.email]);

  useEffect(() => {
    setHomeownerNamesInput(property?.homeownerNames ?? "");
  }, [property?.homeownerNames]);

  useEffect(() => {
    if (!property?.status) return;
    setStatusInput(property.status);
  }, [property?.status]);

  useEffect(() => {
    setAdminFieldsDraft({
      previousInspectionSummary: property?.previousInspectionSummary ?? "",
      priorOwnerLetterNotes2024: property?.priorOwnerLetterNotes2024 ?? "",
    });
  }, [
    property?.previousInspectionSummary,
    property?.priorOwnerLetterNotes2024,
  ]);

  useEffect(() => {
    setInspectorNotesDraft(property?.inspectorNotes ?? "");
  }, [property?._id, property?.inspectorNotes]);

  useEffect(() => {
    aiBulletsHydratedForPropertyIdRef.current = null;
    aiBulletsInitializedRef.current = false;
    if (aiBulletsAutosaveTimerRef.current) {
      clearTimeout(aiBulletsAutosaveTimerRef.current);
      aiBulletsAutosaveTimerRef.current = null;
    }
  }, [pid]);

  useEffect(() => {
    if (!property || property._id !== pid) return;
    if (aiBulletsHydratedForPropertyIdRef.current === pid) return;
    aiBulletsHydratedForPropertyIdRef.current = pid;

    const initialBullets = property.aiLetterBullets ?? "";
    setAiBulletsDraft(initialBullets);
    lastPersistedAiBulletsRef.current = initialBullets;
    aiBulletsInitializedRef.current = true;
    setAiBulletsSaveState("idle");
    setAiBulletsLastSavedAt(property.aiLetterBulletsAt ?? null);
  }, [pid, property]);

  useEffect(() => {
    if (!property || property._id !== pid) return;
    if (!aiBulletsInitializedRef.current) return;
    const serverBullets = property.aiLetterBullets ?? "";
    const localIsDirty = aiBulletsDraft !== lastPersistedAiBulletsRef.current;
    if (!localIsDirty && serverBullets !== lastPersistedAiBulletsRef.current) {
      setAiBulletsDraft(serverBullets);
      lastPersistedAiBulletsRef.current = serverBullets;
      setAiBulletsLastSavedAt(property.aiLetterBulletsAt ?? Date.now());
      setAiBulletsSaveState("saved");
    }
  }, [pid, property?._id, property?.aiLetterBullets, property?.aiLetterBulletsAt, aiBulletsDraft]);

  useEffect(() => {
    return () => {
      if (aiBulletsAutosaveTimerRef.current) clearTimeout(aiBulletsAutosaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!aiBulletsInitializedRef.current) return;
    if (aiBulletsDraft === lastPersistedAiBulletsRef.current) return;

    if (aiBulletsAutosaveTimerRef.current) clearTimeout(aiBulletsAutosaveTimerRef.current);
    aiBulletsAutosaveTimerRef.current = setTimeout(async () => {
      try {
        setAiBulletsSaveState("saving");
        await updateAiLetterBullets({ id: pid, aiLetterBullets: aiBulletsDraft });
        lastPersistedAiBulletsRef.current = aiBulletsDraft;
        setAiBulletsLastSavedAt(Date.now());
        setAiBulletsSaveState("saved");
      } catch {
        setAiBulletsSaveState("error");
      }
    }, 1200);
  }, [aiBulletsDraft, pid, updateAiLetterBullets]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const allPhotos = photos ?? [];
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateLetter({ propertyId: pid });
      await saveGeneratedLetterHtml({ id: pid, html: result.html });
      setLetterHtml(result.html);
      setShowPreview(true);
      showToast("Letter generated and saved");
    } catch (err) {
      showToast("Failed to generate letter");
    } finally {
      setGenerating(false);
    }
  };

  const handleLoadStoredLetter = () => {
    const html = storedLetter?.html;
    if (!html) {
      showToast("No stored letter for this property yet");
      return;
    }
    setLetterHtml(html);
    setShowPreview(true);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const result = await sendLetter({ propertyId: pid });
      if (result.success) {
        showToast("Letter sent successfully!");
        setShowPreview(false);
      } else {
        showToast("Send failed: " + result.error);
      }
    } finally {
      setSending(false);
    }
  };

  const handleSavePropertyDetails = async () => {
    await Promise.all([
      updateHomeownerNames({ id: pid, homeownerNames: homeownerNamesInput }),
      updateEmail({ id: pid, email: emailInput }),
      updateStatus({ id: pid, status: statusInput }),
      updateAdminPropertyFields({
        id: pid,
        previousInspectionSummary: adminFieldsDraft.previousInspectionSummary,
        priorOwnerLetterNotes2024: adminFieldsDraft.priorOwnerLetterNotes2024,
      }),
    ]);
    showToast("Property details saved");
  };

  if (!property) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gradient-hero">
        <div className="text-5xl animate-spin mb-4">🔄</div>
        <p className="text-white font-medium">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="sticky top-0 z-10 gradient-admin px-4 pt-4 pb-3 shadow-md">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-sm text-purple-100 hover:text-white font-medium transition-colors"
            onClick={() => navigate("/admin/dashboard")}
          >
            ← Dashboard
          </button>
          <h1 className="font-extrabold text-white text-sm truncate max-w-[50%] text-center">{property.address}</h1>
          <div className="w-20" />
        </div>
      </div>

      {toast && (
        <div className="mx-4 mt-4 p-3 bg-green-50 text-green-800 rounded-xl border border-green-200 text-sm font-medium">
          {toast}
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Photos + editable fields */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-lg font-semibold mb-3">Photos</h2>
            {allPhotos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No photos yet</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
                {allPhotos.map((photo, idx) => (
                  <div key={photo._id} className="relative min-w-0">
                    <button
                      type="button"
                      className="w-full rounded border overflow-hidden text-left transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() =>
                        setPhotoLightbox({
                          url: photo.publicUrl ?? photo.thumbnailPublicUrl ?? "",
                          title: `Photo ${idx + 1}`,
                          caption: photo.inspectorNote?.trim() || undefined,
                        })
                      }
                    >
                      <img
                        src={photo.publicUrl ?? photo.thumbnailPublicUrl ?? ""}
                        alt={`Inspection photo ${idx + 1}`}
                        className="w-full h-32 object-cover"
                      />
                    </button>
                    {photo.inspectorNote && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {photo.inspectorNote}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Editable Property Fields</h2>
                <Button size="sm" onClick={handleSavePropertyDetails}>Save All</Button>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Homeowner Name(s)</p>
                  <Input
                    value={homeownerNamesInput}
                    onChange={(e) => setHomeownerNamesInput(e.target.value)}
                    placeholder="e.g. Jane and John Doe"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Homeowner Email</p>
                  <Input
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="homeowner@example.com"
                    type="email"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Property Status</p>
                  <Select
                    value={statusInput}
                    onValueChange={(v) => setStatusInput(v as "notStarted" | "inProgress" | "complete")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="notStarted">Not started</SelectItem>
                      <SelectItem value="inProgress">In progress</SelectItem>
                      <SelectItem value="complete">Complete</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Portal Link Token</p>
                  <Input value={property.accessToken} readOnly className="font-mono text-xs" />
                </div>
              </div>
            </div>
          </div>

          {/* Right: letter + inspection content */}
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="text-lg font-semibold">Letter Actions</h2>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={handleGenerate} disabled={generating}>
                  {generating ? "Generating…" : "Generate Letter"}
                </Button>
                <Button variant="outline" onClick={handleLoadStoredLetter} disabled={!storedLetter?.html}>
                  View Letter
                </Button>
              </div>
              {storedLetter?.generatedLetterAt && (
                <p className="text-xs text-muted-foreground">
                  Last generated: {new Date(storedLetter.generatedLetterAt).toLocaleString()}
                </p>
              )}
            </div>

            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="text-lg font-semibold">Inspection Content</h2>
              <div className="rounded border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Inspector Notes</p>
                  {!editingInspectorNotes ? (
                    <Button size="sm" variant="outline" onClick={() => setEditingInspectorNotes(true)}>
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          await updateInspectorNotes({ id: pid, inspectorNotes: inspectorNotesDraft });
                          setEditingInspectorNotes(false);
                          showToast("Inspector notes updated");
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setInspectorNotesDraft(property.inspectorNotes ?? "");
                          setEditingInspectorNotes(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
                {editingInspectorNotes ? (
                  <Textarea
                    value={inspectorNotesDraft}
                    onChange={(e) => setInspectorNotesDraft(e.target.value)}
                    rows={4}
                  />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">
                    {property.inspectorNotes?.trim() || "No inspector notes yet."}
                  </p>
                )}
              </div>

              <div className="rounded border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Summarized Inspection Notes</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={aiBulletsBusy || !property.inspectorNotes?.trim()}
                    onClick={async () => {
                      setAiBulletsBusy(true);
                      try {
                        const r = await generateAiLetterBullets({ propertyId: pid });
                        if (r.ok) showToast("Inspection notes generated");
                        else showToast("error" in r ? r.error : "Failed to generate inspection notes");
                      } catch {
                        showToast("Failed to generate inspection notes");
                      } finally {
                        setAiBulletsBusy(false);
                      }
                    }}
                  >
                    {aiBulletsBusy ? "Generating…" : property.aiLetterBullets?.trim() ? "Regenerate" : "Generate"}
                  </Button>
                </div>
                <Textarea
                  value={aiBulletsDraft}
                  onChange={(e) => setAiBulletsDraft(e.target.value)}
                  rows={5}
                  className="text-sm"
                  placeholder="Generate summarized inspection notes, then edit as needed."
                />
                <p className="text-xs text-muted-foreground min-h-[1rem]">
                  {aiBulletsSaveState === "saving" && "Saving summarized notes..."}
                  {aiBulletsSaveState === "saved" &&
                    `Saved${aiBulletsLastSavedAt ? ` at ${new Date(aiBulletsLastSavedAt).toLocaleString()}` : ""}`}
                  {aiBulletsSaveState === "error" && "Autosave failed. Try editing again."}
                </p>
              </div>

              <div className="rounded border p-3 space-y-2">
                <p className="text-sm font-medium">Previous Inspection Summary</p>
                <Textarea
                  value={adminFieldsDraft.previousInspectionSummary}
                  onChange={(e) => setAdminFieldsDraft((s) => ({ ...s, previousInspectionSummary: e.target.value }))}
                  rows={3}
                />
              </div>

              <div className="rounded border p-3 space-y-2">
                <p className="text-sm font-medium">2024 Letter Text on File</p>
                <Textarea
                  value={adminFieldsDraft.priorOwnerLetterNotes2024}
                  onChange={(e) => setAdminFieldsDraft((s) => ({ ...s, priorOwnerLetterNotes2024: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>

            {(fixPhotos ?? []).length > 0 && (
              <div className="rounded border p-3 space-y-2">
                <h3 className="text-sm font-semibold">Homeowner fix photos</h3>
                {(fixPhotos ?? []).map((fp) => (
                    <div key={fp._id} className="flex flex-wrap gap-2 items-start">
                      <button
                        type="button"
                        className="shrink-0 rounded border overflow-hidden transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onClick={() =>
                          setPhotoLightbox({
                            url: fp.publicUrl,
                            title: "Homeowner fix photo",
                          })
                        }
                      >
                        <img src={fp.publicUrl} alt="fix" className="w-20 h-20 object-cover" />
                      </button>
                      <Select
                        value={fp.verificationStatus}
                        onValueChange={async (status) => {
                          await setFixVerification({
                            id: fp._id,
                            status: status as "pending" | "resolved" | "notResolved" | "needsReview",
                            note: fp.verificationNote ?? "",
                          });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="needsReview">Needs review</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                          <SelectItem value="notResolved">Not resolved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={!!photoLightbox}
        onOpenChange={(open) => {
          if (!open) setPhotoLightbox(null);
        }}
      >
        <DialogContent className="max-w-[min(95vw,56rem)] gap-0 p-0 sm:max-w-[min(95vw,56rem)]">
          {photoLightbox && (
            <>
              <DialogHeader className="space-y-0 px-6 pt-6 pb-2 pr-14 text-left">
                <DialogTitle className="capitalize">{photoLightbox.title}</DialogTitle>
              </DialogHeader>
              <div className="px-6 pb-4">
                <img
                  src={photoLightbox.url}
                  alt=""
                  className="mx-auto max-h-[min(85vh,880px)] w-full object-contain rounded-md bg-muted"
                />
              </div>
              {photoLightbox.caption ? (
                <p className="border-t px-6 py-3 text-sm text-muted-foreground whitespace-pre-wrap">
                  {photoLightbox.caption}
                </p>
              ) : null}
              <DialogFooter className="border-t px-6 py-4 sm:justify-start">
                <Button variant="outline" size="sm" asChild>
                  <a href={photoLightbox.url} target="_blank" rel="noopener noreferrer">
                    Open in new tab
                  </a>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Letter preview dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Letter Preview</DialogTitle>
          </DialogHeader>
          {letterHtml && (
            <div
              className="border rounded p-4 overflow-auto"
              dangerouslySetInnerHTML={{ __html: letterHtml }}
            />
          )}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSend}
              disabled={!OWNER_WORKFLOW_ENABLED || sending || !property.email || !storedLetter?.html}
              title={
                !OWNER_WORKFLOW_ENABLED
                  ? "Homeowner workflow is paused"
                  : !property.email
                    ? "Set homeowner email first"
                    : !storedLetter?.html
                      ? "Generate the letter first"
                      : ""
              }
            >
              {sending ? "Sending..." : "Send to Homeowner"}
            </Button>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Close
            </Button>
          </div>
          {!property.email && <p className="text-xs text-red-500">Set a homeowner email before sending.</p>}
          {!storedLetter?.html && <p className="text-xs text-red-500">Generate the letter before sending.</p>}
          {!OWNER_WORKFLOW_ENABLED && (
            <p className="text-xs text-amber-600">
              Homeowner portal and sending are temporarily paused for this phase.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
