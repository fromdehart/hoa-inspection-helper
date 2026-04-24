import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SEV_COLORS: Record<string, string> = {
  high: "bg-red-100 border-l-4 border-red-500",
  medium: "bg-amber-50 border-l-4 border-amber-500",
  low: "bg-green-50 border-l-4 border-green-500",
};
const OWNER_WORKFLOW_ENABLED = false;

export default function PropertyReview() {
  const navigate = useNavigate();
  const { propertyId } = useParams<{ propertyId: string }>();
  const pid = propertyId as Id<"properties">;

  const [emailInput, setEmailInput] = useState("");
  const [letterHtml, setLetterHtml] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [addingViolation, setAddingViolation] = useState(false);
  const [newViolDesc, setNewViolDesc] = useState("");
  const [newViolSeverity, setNewViolSeverity] = useState<"low" | "medium" | "high">("medium");
  const [toast, setToast] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editingInspectorNotes, setEditingInspectorNotes] = useState(false);
  const [inspectorNotesDraft, setInspectorNotesDraft] = useState("");

  const property = useQuery(api.properties.get, { id: pid });
  const photos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const violations = useQuery(api.violations.listByProperty, { propertyId: pid });
  const fixPhotos = useQuery(api.fixPhotos.listByProperty, { propertyId: pid });
  const storedLetter = useQuery(api.properties.getLetterHtml, { id: pid });

  const updateEmail = useMutation(api.properties.updateEmail);
  const updateInspectorNotes = useMutation(api.properties.updateInspectorNotes);
  const saveGeneratedLetterHtml = useMutation(api.properties.saveGeneratedLetterHtml);
  const setFixVerification = useMutation(api.fixPhotos.setVerification);
  const updateViolation = useMutation(api.violations.update);
  const removeViolation = useMutation(api.violations.remove);
  const createPublic = useMutation(api.violations.createPublic);
  const generateLetter = useAction(api.letters.generate);
  const sendLetter = useAction(api.letters.send);

  useEffect(() => {
    if (property?.email) setEmailInput(property.email);
  }, [property?.email]);

  useEffect(() => {
    setInspectorNotesDraft(property?.inspectorNotes ?? "");
  }, [property?._id, property?.inspectorNotes]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const photosBySection = {
    front: (photos ?? []).filter((p) => p.section === "front"),
    side: (photos ?? []).filter((p) => p.section === "side"),
    back: (photos ?? []).filter((p) => p.section === "back"),
  };
  const openViolations = (violations ?? []).filter((v) => v.status === "open");
  const priorReference = property?.previousInspectionSummary?.trim()
    ? property.previousInspectionSummary
    : [
        property?.previousCitations2024?.trim(),
        property?.previousFrontObs?.trim(),
        property?.previousBackObs?.trim(),
        property?.previousInspectorComments?.trim(),
      ]
        .filter(Boolean)
        .join("\n");

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

  const handleAddViolation = async () => {
    if (!newViolDesc.trim()) return;
    await createPublic({ propertyId: pid, description: newViolDesc, severity: newViolSeverity });
    setNewViolDesc("");
    setAddingViolation(false);
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Photos */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Photos</h2>
            <Tabs defaultValue="front">
              <TabsList>
                <TabsTrigger value="front">Front ({photosBySection.front.length})</TabsTrigger>
                <TabsTrigger value="side">Side ({photosBySection.side.length})</TabsTrigger>
                <TabsTrigger value="back">Back ({photosBySection.back.length})</TabsTrigger>
              </TabsList>
              {(["front", "side", "back"] as const).map((sec) => (
                <TabsContent key={sec} value={sec}>
                  {photosBySection[sec].length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No photos yet</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                      {photosBySection[sec].map((photo) => (
                        <div key={photo._id} className="relative">
                          <a href={photo.publicUrl} target="_blank" rel="noopener noreferrer">
                            <img
                              src={photo.publicUrl}
                              alt={`${sec} photo`}
                              className="w-full h-32 object-cover rounded border"
                            />
                          </a>
                          {photo.inspectorNote && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {photo.inspectorNote}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* Right: Violations + Actions */}
          <div className="space-y-4">
            {(property.previousFrontObs ||
              property.previousBackObs ||
              property.previousInspectionSummary ||
              property.previousInspectorComments) && (
              <div className="rounded border bg-muted/40 p-3 text-sm space-y-1">
                <h3 className="font-semibold text-sm">Prior inspection (imported)</h3>
                {property.previousInspectionSummary && (
                  <p className="whitespace-pre-wrap text-xs">{property.previousInspectionSummary}</p>
                )}
                {!property.previousInspectionSummary && (
                  <>
                    {property.previousFrontObs && (
                      <p>
                        <span className="font-medium">Front: </span>
                        {property.previousFrontObs}
                      </p>
                    )}
                    {property.previousBackObs && (
                      <p>
                        <span className="font-medium">Back: </span>
                        {property.previousBackObs}
                      </p>
                    )}
                    {property.previousInspectorComments && (
                      <p>
                        <span className="font-medium">Comments: </span>
                        {property.previousInspectorComments}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Letter Inputs Review</h2>
                <Button onClick={handleGenerate} disabled={generating} size="sm">
                  {generating ? "Generating…" : "Generate Letter"}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Review and edit these fields before generating. Generation saves HTML for send/export.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded border p-2">
                  <p className="text-xs text-muted-foreground">Address</p>
                  <p className="font-medium">{property.address}</p>
                </div>
                <div className="rounded border p-2">
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="font-medium">{new Date().toLocaleDateString()}</p>
                </div>
                <div className="rounded border p-2">
                  <p className="text-xs text-muted-foreground">Portal Link Token</p>
                  <p className="font-mono text-xs break-all">{property.accessToken}</p>
                </div>
                <div className="rounded border p-2">
                  <p className="text-xs text-muted-foreground">Open Violations</p>
                  <p className="font-medium">{openViolations.length}</p>
                </div>
              </div>

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

              <div className="rounded border p-3 space-y-1">
                <p className="text-sm font-medium">Prior Inspection Reference</p>
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                  {priorReference || "None"}
                </p>
              </div>
            </div>

            {/* Email */}
            <div>
              <h2 className="text-lg font-semibold mb-2">Homeowner Email</h2>
              <div className="flex gap-2">
                <Input
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="homeowner@example.com"
                  type="email"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateEmail({ id: pid, email: emailInput })}
                >
                  Save
                </Button>
              </div>
            </div>

            {/* Violations */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold">Violations ({violations?.length ?? 0})</h2>
                <Button size="sm" variant="outline" onClick={() => setAddingViolation(!addingViolation)}>
                  + Add Violation
                </Button>
              </div>

              {addingViolation && (
                <div className="border rounded p-3 mb-3 space-y-2 bg-muted/50">
                  <Textarea
                    value={newViolDesc}
                    onChange={(e) => setNewViolDesc(e.target.value)}
                    placeholder="Violation description..."
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Select
                      value={newViolSeverity}
                      onValueChange={(v) => setNewViolSeverity(v as "low" | "medium" | "high")}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={handleAddViolation}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAddingViolation(false)}>Cancel</Button>
                  </div>
                </div>
              )}

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {(violations ?? []).map((v) => {
                  const isEditing = editingId === v._id;
                  const fixPhotoForViolation = (fixPhotos ?? []).filter(
                    (fp) => fp.violationId === v._id,
                  );
                  return (
                    <div
                      key={v._id}
                      className={`rounded p-3 ${SEV_COLORS[v.severity ?? "low"] ?? "border-l-4"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          {isEditing ? (
                            <Textarea
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                              rows={2}
                              className="mb-1"
                            />
                          ) : (
                            <p className="text-sm font-medium">{v.description}</p>
                          )}
                          <div className="flex gap-2 mt-1 flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {v.severity ?? "N/A"}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {v.aiGenerated ? "AI" : "Manual"}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {v.status}
                            </Badge>
                          </div>
                          {isEditing && (
                            <div className="mt-2 space-y-1">
                              <Input
                                placeholder="Admin note..."
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                className="text-xs"
                              />
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    await updateViolation({
                                      id: v._id,
                                      description: editDesc,
                                      adminNote: editNote || undefined,
                                    });
                                    setEditingId(null);
                                  }}
                                >
                                  Save
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                          {fixPhotoForViolation.length > 0 && (
                            <div className="mt-2 space-y-2 border-t pt-2">
                              {fixPhotoForViolation.map((fp) => (
                                <div key={fp._id} className="flex flex-wrap gap-2 items-start">
                                  <a href={fp.publicUrl} target="_blank" rel="noopener noreferrer">
                                    <img
                                      src={fp.publicUrl}
                                      alt="fix"
                                      className="w-20 h-20 object-cover rounded border"
                                    />
                                  </a>
                                  <div className="flex-1 min-w-[140px] space-y-1">
                                    <Select
                                      value={fp.verificationStatus}
                                      onValueChange={async (status) => {
                                        await setFixVerification({
                                          id: fp._id,
                                          status: status as
                                            | "pending"
                                            | "resolved"
                                            | "notResolved"
                                            | "needsReview",
                                          note: fp.verificationNote ?? "",
                                        });
                                      }}
                                    >
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="pending">Pending</SelectItem>
                                        <SelectItem value="needsReview">Needs review</SelectItem>
                                        <SelectItem value="resolved">Resolved</SelectItem>
                                        <SelectItem value="notResolved">Not resolved</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      className="text-xs h-8"
                                      placeholder="Reviewer note"
                                      defaultValue={fp.verificationNote ?? ""}
                                      key={fp._id + (fp.verificationNote ?? "")}
                                      onBlur={async (e) => {
                                        await setFixVerification({
                                          id: fp._id,
                                          status: fp.verificationStatus,
                                          note: e.target.value,
                                        });
                                      }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {!isEditing && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(v._id);
                                setEditDesc(v.description);
                                setEditNote(v.adminNote ?? "");
                              }}
                            >
                              Edit
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => {
                              if (confirm("Delete this violation?")) {
                                removeViolation({ id: v._id });
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(violations ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No violations recorded</p>
                )}
              </div>
            </div>

            {/* Letter actions */}
            <div className="pt-2 border-t space-y-2">
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={handleLoadStoredLetter} disabled={!storedLetter?.html}>
                  Load stored letter
                </Button>
              </div>
              {storedLetter?.generatedLetterAt && (
                <p className="text-xs text-muted-foreground">
                  Stored letter saved: {new Date(storedLetter.generatedLetterAt).toLocaleString()}
                </p>
              )}
              {property.letterSentAt && (
                <p className="text-xs text-muted-foreground">
                  Last emailed: {new Date(property.letterSentAt).toLocaleDateString()}
                </p>
              )}
            </div>

            {(fixPhotos ?? []).some((fp) => !fp.violationId) && (
              <div className="rounded border p-3 space-y-2">
                <h3 className="text-sm font-semibold">Fix photos (no linked violation)</h3>
                {(fixPhotos ?? [])
                  .filter((fp) => !fp.violationId)
                  .map((fp) => (
                    <div key={fp._id} className="flex flex-wrap gap-2 items-start">
                      <a href={fp.publicUrl} target="_blank" rel="noopener noreferrer">
                        <img src={fp.publicUrl} alt="fix" className="w-20 h-20 object-cover rounded border" />
                      </a>
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
