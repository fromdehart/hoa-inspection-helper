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

const ANALYSIS_ICONS: Record<string, string> = {
  pending: "⏳",
  processing: "🔄",
  done: "✅",
  error: "❌",
};

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

  useEffect(() => {
    if (localStorage.getItem("hoa_admin") !== "true") navigate("/admin");
  }, [navigate]);

  const property = useQuery(api.properties.get, { id: pid });
  const photos = useQuery(api.photos.listByProperty, { propertyId: pid });
  const violations = useQuery(api.violations.listByProperty, { propertyId: pid });
  const fixPhotos = useQuery(api.fixPhotos.listByProperty, { propertyId: pid });

  const updateEmail = useMutation(api.properties.updateEmail);
  const updateViolation = useMutation(api.violations.update);
  const removeViolation = useMutation(api.violations.remove);
  const createPublic = useMutation(api.violations.createPublic);
  const generateLetter = useAction(api.letters.generate);
  const sendLetter = useAction(api.letters.send);

  useEffect(() => {
    if (property?.email) setEmailInput(property.email);
  }, [property?.email]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const photosBySection = {
    front: (photos ?? []).filter((p) => p.section === "front"),
    side: (photos ?? []).filter((p) => p.section === "side"),
    back: (photos ?? []).filter((p) => p.section === "back"),
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateLetter({ propertyId: pid });
      setLetterHtml(result.html);
      setShowPreview(true);
    } catch (err) {
      showToast("Failed to generate letter");
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!letterHtml) return;
    setSending(true);
    try {
      const result = await sendLetter({ propertyId: pid, html: letterHtml });
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
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b bg-background">
        <button className="text-sm text-blue-600 hover:underline" onClick={() => navigate("/admin/dashboard")}>
          ← Dashboard
        </button>
        <h1 className="font-semibold truncate max-w-xs">{property.address}</h1>
        <div className="w-20" />
      </div>

      {toast && (
        <div className="mx-4 mt-4 p-3 bg-green-100 text-green-800 rounded text-sm">{toast}</div>
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
                          <span className="absolute bottom-1 right-1 text-lg">
                            {ANALYSIS_ICONS[photo.analysisStatus]}
                          </span>
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
                    <Select value={newViolSeverity} onValueChange={(v: any) => setNewViolSeverity(v)}>
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
                            <p className="text-xs text-muted-foreground mt-1">
                              {fixPhotoForViolation.length} fix photo(s) submitted
                            </p>
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
            <div className="pt-2 border-t flex gap-2 flex-wrap">
              <Button onClick={handleGenerate} disabled={generating}>
                {generating ? "Generating..." : "Generate Letter"}
              </Button>
              {property.letterSentAt && (
                <p className="text-xs text-muted-foreground self-center">
                  Last sent: {new Date(property.letterSentAt).toLocaleDateString()}
                </p>
              )}
            </div>
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
              disabled={sending || !property.email}
              title={!property.email ? "Set homeowner email first" : ""}
            >
              {sending ? "Sending..." : "Send to Homeowner"}
            </Button>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Close
            </Button>
          </div>
          {!property.email && (
            <p className="text-xs text-red-500">Set a homeowner email before sending.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
