import { useState, useEffect, useRef, type RefObject } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { uploadTemplateFile, uploadArcReferenceFile } from "@/lib/uploadClient";
import { LetterTemplateVersionHistory } from "@/components/admin/LetterTemplateVersionHistory";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  extractPdfTextInBrowser,
  extractPdfTextWithOcrFallback,
  fileToBase64,
  looksLikeRawPdfPayload,
} from "@/lib/extractPdfText";
import { WorkflowEditor } from "@/components/cases/WorkflowEditor";
import { EmailIntakeSettings } from "@/components/cases/EmailIntakeSettings";
import AdminShell from "@/components/admin/AdminShell";
import { ImportExportCard } from "@/components/admin/ImportExportCard";
import { TeamSection } from "@/components/admin/TeamSection";
import { StewardAutonomySection } from "@/components/admin/StewardAutonomySection";

/** Editable letter body — only `templateText`; never fall back to upload `parsedText`. */
function editorBodyFromStoredTemplate(doc: { templateText?: string } | null | undefined): string {
  if (!doc) return "";
  return doc.templateText ?? "";
}

export default function Settings() {
  const settingsViewer = useQuery(api.tenancy.viewerContext, {});
  const [uploadingViolationTemplate, setUploadingViolationTemplate] = useState(false);
  const [uploadingNoViolationsTemplate, setUploadingNoViolationsTemplate] = useState(false);
  const [violationTemplateErr, setViolationTemplateErr] = useState("");
  const [noViolationsTemplateErr, setNoViolationsTemplateErr] = useState("");
  const [docTemplateText, setDocTemplateText] = useState("");
  const [noViolationsTemplateText, setNoViolationsTemplateText] = useState("");
  const loadedTemplateIdRef = useRef<string | null>(null);
  const loadedNoViolationsTemplateIdRef = useRef<string | null>(null);
  const docTemplateRef = useRef<HTMLTextAreaElement | null>(null);
  const noViolationsTemplateRef = useRef<HTMLTextAreaElement | null>(null);
  const [docSaveState, setDocSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [noViolationsSaveState, setNoViolationsSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [docLastSavedAt, setDocLastSavedAt] = useState<number | null>(null);
  const [noViolationsLastSavedAt, setNoViolationsLastSavedAt] = useState<number | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const templateDocs = useQuery(api.letterTemplateDocs.list, {});
  const activeViolationTemplate = useQuery(api.letterTemplateDocs.getActive, { variant: "violation" });
  const activeNoViolationsTemplate = useQuery(api.letterTemplateDocs.getActive, { variant: "noViolations" });

  const updateTemplateText = useMutation(api.letterTemplateDocs.updateTemplateText);
  const seedDefaultNoViolationsIfNeeded = useMutation(api.letterTemplateDocs.seedDefaultNoViolationsIfNeeded);
  const bootstrapVersionFromCurrent = useMutation(api.letterTemplateDocs.bootstrapVersionFromCurrent);
  const ingestUploadedTemplate = useAction(api.letterTemplateIngest.ingestUploadedTemplate);
  const arcRefDocs = useQuery(api.arcReferenceDocs.list, {});
  const createArcRef = useMutation(api.arcReferenceDocs.create);
  const removeArcRef = useMutation(api.arcReferenceDocs.remove);
  const updateArcRef = useMutation(api.arcReferenceDocs.update);
  const parseDocxBase64 = useAction(api.arcDocIngest.parseDocxBase64);
  const arcReviewSettings = useQuery(api.arcReviewSettings.get, {});
  const setArcReviewSettings = useMutation(api.arcReviewSettings.set);
  const [reviewPosture, setReviewPosture] = useState<"strict" | "practical" | "homeownerFriendly">("homeownerFriendly");
  const [reviewGuidance, setReviewGuidance] = useState("");
  const [showArcOnPropertyPage, setShowArcOnPropertyPage] = useState(false);
  const [reviewSaveState, setReviewSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const reviewAutosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [arcRefTitle, setArcRefTitle] = useState("");
  const [arcRefUploading, setArcRefUploading] = useState(false);
  const [arcRefErr, setArcRefErr] = useState("");
  const [arcRefOcrHint, setArcRefOcrHint] = useState("");

  const flashSaved = (key: string) => {
    setSaved((s) => ({ ...s, [key]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [key]: false })), 2000);
  };

  const insertTokenAtCursor = (
    token: string,
    text: string,
    setText: (value: string) => void,
    ref: RefObject<HTMLTextAreaElement | null>,
  ) => {
    const el = ref.current;
    if (!el) {
      setText(`${text}${text.endsWith("\n") || text.length === 0 ? "" : "\n"}${token}`);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
    const insert = `${needsLeadingNewline ? "\n" : ""}${token}`;
    const next = before + insert + after;
    setText(next);

    requestAnimationFrame(() => {
      el.focus();
      const caret = before.length + insert.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const violationTemplate =
    activeViolationTemplate ??
    templateDocs?.find((doc) => !doc.variant || doc.variant === "violation");
  const noViolationsTemplate =
    activeNoViolationsTemplate ?? templateDocs?.find((doc) => doc.variant === "noViolations");

  useEffect(() => {
    void seedDefaultNoViolationsIfNeeded({});
    void bootstrapVersionFromCurrent({});
  }, [seedDefaultNoViolationsIfNeeded, bootstrapVersionFromCurrent]);

  const uploadTemplate = async (
    file: File,
    variant: "violation" | "noViolations",
    setUploading: (value: boolean) => void,
    setErr: (value: string) => void,
    savedKey: string,
  ) => {
    try {
      setUploading(true);
      setErr("");
      const up = await uploadTemplateFile(file);
      const fileType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const parsedTextOverride =
        fileType === "pdf" ? await extractPdfTextInBrowser(file) : undefined;
      if (fileType === "pdf") {
        if (!parsedTextOverride?.trim()) {
          throw new Error("Could not extract readable text from PDF. Please upload a text-based PDF or DOCX.");
        }
        if (looksLikeRawPdfPayload(parsedTextOverride)) {
          throw new Error(
            "PDF parsing returned raw file bytes instead of readable text. Please try a DOCX upload for this template.",
          );
        }
      }
      await ingestUploadedTemplate({
        fileName: file.name,
        fileType,
        sourcePublicUrl: up.publicUrl,
        sourceFilePath: up.filePath,
        fileBase64: btoa(binary),
        parsedTextOverride,
        variant,
      });
      flashSaved(savedKey);
    } catch (err) {
      setErr(String(err));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!arcReviewSettings) return;
    setReviewPosture(arcReviewSettings.reviewPosture);
    setReviewGuidance(arcReviewSettings.adminGuidance ?? "");
    setShowArcOnPropertyPage(arcReviewSettings.showArcApplicationOnPropertyPage);
    setReviewSaveState("idle");
  }, [
    arcReviewSettings?.reviewPosture,
    arcReviewSettings?.adminGuidance,
    arcReviewSettings?.showArcApplicationOnPropertyPage,
  ]);

  useEffect(() => {
    if (violationTemplate === undefined) return;
    if (!violationTemplate?._id) {
      loadedTemplateIdRef.current = null;
      setDocTemplateText("");
      setDocSaveState("idle");
      setDocLastSavedAt(null);
      return;
    }
    if (loadedTemplateIdRef.current === violationTemplate._id) return;
    loadedTemplateIdRef.current = violationTemplate._id;
    setDocTemplateText(editorBodyFromStoredTemplate(violationTemplate));
    setDocSaveState("idle");
  }, [violationTemplate]);

  useEffect(() => {
    if (noViolationsTemplate === undefined) return;
    if (!noViolationsTemplate?._id) {
      loadedNoViolationsTemplateIdRef.current = null;
      setNoViolationsTemplateText("");
      setNoViolationsSaveState("idle");
      setNoViolationsLastSavedAt(null);
      return;
    }
    if (loadedNoViolationsTemplateIdRef.current === noViolationsTemplate._id) return;
    loadedNoViolationsTemplateIdRef.current = noViolationsTemplate._id;
    setNoViolationsTemplateText(editorBodyFromStoredTemplate(noViolationsTemplate));
    setNoViolationsSaveState("idle");
  }, [noViolationsTemplate]);

  const violationDirty =
    !!violationTemplate && docTemplateText !== editorBodyFromStoredTemplate(violationTemplate);
  const noViolationsDirty =
    !!noViolationsTemplate &&
    noViolationsTemplateText !== editorBodyFromStoredTemplate(noViolationsTemplate);

  const saveViolationTemplate = async () => {
    if (!violationTemplate?._id || !docTemplateText.trim()) return;
    setDocSaveState("saving");
    try {
      const result = await updateTemplateText({
        id: violationTemplate._id as Id<"letterTemplateDocs">,
        templateText: docTemplateText,
      });
      setDocSaveState("saved");
      setDocLastSavedAt(result.savedAt);
    } catch {
      setDocSaveState("error");
    }
  };

  const saveNoViolationsTemplate = async () => {
    if (!noViolationsTemplate?._id || !noViolationsTemplateText.trim()) return;
    setNoViolationsSaveState("saving");
    try {
      const result = await updateTemplateText({
        id: noViolationsTemplate._id as Id<"letterTemplateDocs">,
        templateText: noViolationsTemplateText,
      });
      setNoViolationsSaveState("saved");
      setNoViolationsLastSavedAt(result.savedAt);
    } catch {
      setNoViolationsSaveState("error");
    }
  };

  useEffect(() => {
    return () => {
      if (reviewAutosaveRef.current) clearTimeout(reviewAutosaveRef.current);
    };
  }, []);

  useEffect(() => {
    if (!arcReviewSettings) return;
    const unchanged =
      reviewPosture === arcReviewSettings.reviewPosture &&
      reviewGuidance === (arcReviewSettings.adminGuidance ?? "") &&
      showArcOnPropertyPage === arcReviewSettings.showArcApplicationOnPropertyPage;
    if (unchanged) return;
    if (reviewAutosaveRef.current) clearTimeout(reviewAutosaveRef.current);
    reviewAutosaveRef.current = setTimeout(async () => {
      try {
        setReviewSaveState("saving");
        await setArcReviewSettings({
          reviewPosture,
          adminGuidance: reviewGuidance,
          showArcApplicationOnPropertyPage: showArcOnPropertyPage,
        });
        setReviewSaveState("saved");
      } catch {
        setReviewSaveState("error");
      }
    }, 700);
  }, [arcReviewSettings, reviewPosture, reviewGuidance, showArcOnPropertyPage, setArcReviewSettings]);

  return (
    <AdminShell active="settings">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-lg font-bold">Settings</h1>
          <p className="text-xs text-ink-2">
            Letter template, team, utilities, ARC rules, and reference docs
          </p>
        </div>

        <ImportExportCard hoaSlug={settingsViewer?.hoaSlug} />
        <TeamSection />
        {settingsViewer?.features?.includes("steward") && <StewardAutonomySection />}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-800">Violation letter template</h2>
            <Button
              asChild
              size="sm"
              type="button"
              disabled={uploadingViolationTemplate}
              className="bg-[#4f46e5] hover:bg-[#4338ca] text-white"
            >
              <label htmlFor="violation-template-upload-input" className="cursor-pointer">
                {uploadingViolationTemplate ? "Uploading..." : "Upload Template"}
              </label>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Used for homes with violation bullet points. Upload one DOCX or PDF.
          </p>
          <Input
            id="violation-template-upload-input"
            type="file"
            accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={async (e) => {
              const inputEl = e.currentTarget;
              const file = e.target.files?.[0];
              if (!file) return;
              await uploadTemplate(
                file,
                "violation",
                setUploadingViolationTemplate,
                setViolationTemplateErr,
                "uploadedViolationTemplate",
              );
              inputEl.value = "";
            }}
          />
          {uploadingViolationTemplate && (
            <p className="text-xs text-muted-foreground">Uploading and parsing template…</p>
          )}
          {violationTemplateErr && <p className="text-xs text-red-600">{violationTemplateErr}</p>}
          {saved.uploadedViolationTemplate && (
            <p className="text-xs text-green-600">Violation template uploaded and parsed.</p>
          )}

          {violationTemplate && (
            <div className="rounded border p-3 space-y-2">
              <Textarea
                ref={docTemplateRef}
                value={docTemplateText}
                onChange={(e) => setDocTemplateText(e.target.value)}
                rows={18}
                className="font-serif"
                placeholder="Editable letter text..."
              />
              <div className="flex flex-wrap gap-2">
                {(["{{date}}", "{{recipientName}}", "{{recipientStreet}}", "{{recipientCityStateZip}}", "{{maintenanceItems}}"] as const).map((token) => (
                  <Button
                    key={token}
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() =>
                      insertTokenAtCursor(token, docTemplateText, setDocTemplateText, docTemplateRef)
                    }
                  >
                    Insert {token}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!violationDirty || !docTemplateText.trim() || docSaveState === "saving"}
                  onClick={() => void saveViolationTemplate()}
                  className="bg-[#4f46e5] hover:bg-[#4338ca] text-white"
                >
                  {docSaveState === "saving" ? "Saving…" : "Save"}
                </Button>
                {violationDirty && (
                  <span className="text-xs text-amber-700">Unsaved changes</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground min-h-[1rem]">
                {docSaveState === "saved" &&
                  `Saved ${docLastSavedAt ? `at ${new Date(docLastSavedAt).toLocaleString()}` : ""}`}
                {docSaveState === "error" && "Save failed. Try again."}
              </p>
              <LetterTemplateVersionHistory
                templateDocId={violationTemplate._id as Id<"letterTemplateDocs">}
                onRestored={(text) => {
                  setDocTemplateText(text);
                  setDocSaveState("saved");
                  setDocLastSavedAt(Date.now());
                }}
              />
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-800">No violations letter template</h2>
            <Button
              asChild
              size="sm"
              type="button"
              disabled={uploadingNoViolationsTemplate}
              className="bg-[#4f46e5] hover:bg-[#4338ca] text-white"
            >
              <label htmlFor="no-violations-template-upload-input" className="cursor-pointer">
                {uploadingNoViolationsTemplate ? "Uploading..." : "Upload Template"}
              </label>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Used when a home is marked no violations. No maintenance bullet list is included.
          </p>
          <Input
            id="no-violations-template-upload-input"
            type="file"
            accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={async (e) => {
              const inputEl = e.currentTarget;
              const file = e.target.files?.[0];
              if (!file) return;
              await uploadTemplate(
                file,
                "noViolations",
                setUploadingNoViolationsTemplate,
                setNoViolationsTemplateErr,
                "uploadedNoViolationsTemplate",
              );
              inputEl.value = "";
            }}
          />
          {uploadingNoViolationsTemplate && (
            <p className="text-xs text-muted-foreground">Uploading and parsing template…</p>
          )}
          {noViolationsTemplateErr && <p className="text-xs text-red-600">{noViolationsTemplateErr}</p>}
          {saved.uploadedNoViolationsTemplate && (
            <p className="text-xs text-green-600">No violations template uploaded and parsed.</p>
          )}

          {noViolationsTemplate && (
            <div className="rounded border p-3 space-y-2">
              <Textarea
                ref={noViolationsTemplateRef}
                value={noViolationsTemplateText}
                onChange={(e) => setNoViolationsTemplateText(e.target.value)}
                rows={14}
                className="font-serif"
                placeholder="Editable no-violations letter text..."
              />
              <div className="flex flex-wrap gap-2">
                {(["{{date}}", "{{recipientName}}", "{{recipientStreet}}", "{{recipientCityStateZip}}"] as const).map((token) => (
                  <Button
                    key={token}
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() =>
                      insertTokenAtCursor(
                        token,
                        noViolationsTemplateText,
                        setNoViolationsTemplateText,
                        noViolationsTemplateRef,
                      )
                    }
                  >
                    Insert {token}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !noViolationsDirty ||
                    !noViolationsTemplateText.trim() ||
                    noViolationsSaveState === "saving"
                  }
                  onClick={() => void saveNoViolationsTemplate()}
                  className="bg-[#4f46e5] hover:bg-[#4338ca] text-white"
                >
                  {noViolationsSaveState === "saving" ? "Saving…" : "Save"}
                </Button>
                {noViolationsDirty && (
                  <span className="text-xs text-amber-700">Unsaved changes</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground min-h-[1rem]">
                {noViolationsSaveState === "saved" &&
                  `Saved ${noViolationsLastSavedAt ? `at ${new Date(noViolationsLastSavedAt).toLocaleString()}` : ""}`}
                {noViolationsSaveState === "error" && "Save failed. Try again."}
              </p>
              <LetterTemplateVersionHistory
                templateDocId={noViolationsTemplate._id as Id<"letterTemplateDocs">}
                onRestored={(text) => {
                  setNoViolationsTemplateText(text);
                  setNoViolationsSaveState("saved");
                  setNoViolationsLastSavedAt(Date.now());
                }}
              />
            </div>
          )}
        </section>

        {settingsViewer?.features?.includes("cases") && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
            <h2 className="text-lg font-bold text-gray-800">Case workflow</h2>
            <p className="text-xs text-muted-foreground">
              The escalation ladder cases follow, per case type. Stage gates enforce due-process
              steps (notice sent, hearing decided, photo evidence) before a case can advance.
            </p>
            <WorkflowEditor />
          </section>
        )}

        {settingsViewer?.features?.includes("emailIntake") && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
            <h2 className="text-lg font-bold text-gray-800">Email intake</h2>
            <EmailIntakeSettings hoaSlug={settingsViewer.hoaSlug} />
          </section>
        )}

        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <h2 className="text-lg font-bold text-gray-800">ARC review behavior</h2>
          <p className="text-xs text-muted-foreground">
            Tune how strict the AI should be and add local process guidance beyond official documents.
          </p>
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-3">
              <div>
                <p className="text-sm font-medium text-gray-800">Show ARC application on property pages</p>
                <p className="text-xs text-muted-foreground">
                  When off, the Architecture Review Committee section is hidden on each property review page.
                </p>
              </div>
              <Switch
                checked={showArcOnPropertyPage}
                onCheckedChange={setShowArcOnPropertyPage}
                aria-label="Show ARC application on property pages"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Review posture</p>
              <Select value={reviewPosture} onValueChange={(v) => setReviewPosture(v as typeof reviewPosture)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="strict">Strict (compliance-focused)</SelectItem>
                  <SelectItem value="practical">Practical (balanced)</SelectItem>
                  <SelectItem value="homeownerFriendly">Homeowner-friendly (least intimidating)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Admin guidance for ARC reviewer model</p>
              <Textarea
                value={reviewGuidance}
                onChange={(e) => setReviewGuidance(e.target.value)}
                rows={5}
                placeholder="Example: For simple shrub replacement, do not request site surveys or color palettes. Ask for a rough location sketch and replacement plant photo/reference instead."
              />
            </div>
            <p className="text-xs text-muted-foreground min-h-[1rem]">
              {reviewSaveState === "saving" && "Saving..."}
              {reviewSaveState === "saved" && "Saved"}
              {reviewSaveState === "error" && "Could not save review settings."}
            </p>
          </div>
        </section>

        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <h2 className="text-lg font-bold text-gray-800">ARC review — reference documents</h2>
          <p className="text-xs text-muted-foreground">
            Upload rules, design guidelines, and example decisions. You can select multiple PDF or DOCX files in one
            go. Text is extracted and used when admins run an AI assist on a property&apos;s Architecture Review
            Committee (ARC) application.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-1">
                Title prefix (optional) — if set, each file is stored as “prefix · filename”
              </p>
              <Input
                value={arcRefTitle}
                onChange={(e) => setArcRefTitle(e.target.value)}
                placeholder="e.g. 2024 ARC guidelines"
              />
            </div>
            <Button
              asChild
              size="sm"
              type="button"
              disabled={arcRefUploading}
              className="bg-[#4f46e5] hover:bg-[#4338ca] text-white shrink-0"
            >
              <label htmlFor="arc-ref-upload" className="cursor-pointer">
                {arcRefUploading ? "Uploading…" : "Upload PDF or DOCX (multiple ok)"}
              </label>
            </Button>
          </div>
          <Input
            id="arc-ref-upload"
            type="file"
            multiple
            accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={async (e) => {
              const inputEl = e.currentTarget;
              const list = e.target.files;
              if (!list?.length) return;
              setArcRefUploading(true);
              setArcRefErr("");
              setArcRefOcrHint("");
              const errors: string[] = [];
              let added = 0;
              const titlePrefix = arcRefTitle.trim();
              for (const file of Array.from(list)) {
                setArcRefOcrHint("");
                try {
                  const up = await uploadArcReferenceFile(file);
                  const fileType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
                  let parsedText = "";
                  if (fileType === "pdf") {
                    const { text } = await extractPdfTextWithOcrFallback(file, (m) => setArcRefOcrHint(m));
                    parsedText = text;
                    if (!parsedText.trim()) {
                      throw new Error("No readable PDF text after OCR");
                    }
                  } else {
                    const b64 = await fileToBase64(file);
                    const parsed = await parseDocxBase64({ fileBase64: b64 });
                    if (parsed.error) throw new Error(parsed.error);
                    parsedText = parsed.text;
                    if (!parsedText.trim()) throw new Error("No text in DOCX");
                  }
                  const title = titlePrefix ? `${titlePrefix} · ${file.name}` : file.name;
                  await createArcRef({
                    title,
                    fileName: file.name,
                    fileType,
                    sourcePublicUrl: up.publicUrl,
                    sourceFilePath: up.filePath,
                    parsedText,
                  });
                  added++;
                } catch (err) {
                  errors.push(`${file.name}: ${String(err)}`);
                }
              }
              setArcRefUploading(false);
              setArcRefOcrHint("");
              inputEl.value = "";
              if (errors.length) {
                setArcRefErr(errors.join("\n"));
              }
              if (added > 0) {
                if (titlePrefix) setArcRefTitle("");
                flashSaved("arcRef");
              }
            }}
          />
          {arcRefOcrHint && <p className="text-xs text-muted-foreground">{arcRefOcrHint}</p>}
          {arcRefErr && (
            <p className="text-xs text-red-600 whitespace-pre-wrap max-h-32 overflow-y-auto">{arcRefErr}</p>
          )}
          {saved.arcRef && <p className="text-xs text-green-600">Reference document(s) added.</p>}

          {arcRefDocs && arcRefDocs.length > 0 && (
            <ul className="text-sm border rounded divide-y">
              {arcRefDocs.map((d) => (
                <li key={d._id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.title}</p>
                    <p className="text-xs text-muted-foreground">{d.fileName}</p>
                    <a
                      href={d.sourcePublicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Open file
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Category"
                      className="rounded border px-2 py-1 text-xs"
                      value={d.category ?? "general"}
                      onChange={(e) => updateArcRef({ id: d._id, category: e.target.value })}
                    >
                      <option value="general">General</option>
                      <option value="paintColors">Paint colors</option>
                      <option value="architectural">Architectural</option>
                      <option value="landscaping">Landscaping</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={d.visibleToHomeowners !== false}
                        onChange={(e) =>
                          updateArcRef({ id: d._id, visibleToHomeowners: e.target.checked })
                        }
                      />
                      Show to homeowners
                    </label>
                    <Button type="button" size="sm" variant="outline" onClick={() => removeArcRef({ id: d._id })}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
