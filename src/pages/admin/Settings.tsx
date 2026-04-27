import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { uploadTemplateFile, uploadArcReferenceFile } from "@/lib/uploadClient";
import {
  extractPdfTextInBrowser,
  extractPdfTextWithOcrFallback,
  fileToBase64,
  looksLikeRawPdfPayload,
} from "@/lib/extractPdfText";

/** Convex may store `templateText: ""`; `??` would hide non-empty `parsedText` and leave the editor blank. */
function editorBodyFromStoredTemplate(doc: { templateText?: string; parsedText?: string } | null | undefined): string {
  if (!doc) return "";
  const custom = doc.templateText;
  if (typeof custom === "string" && custom.trim().length > 0) return custom;
  return doc.parsedText ?? "";
}

export default function Settings() {
  const navigate = useNavigate();
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [templateErr, setTemplateErr] = useState("");
  const [docTemplateText, setDocTemplateText] = useState("");
  const loadedTemplateIdRef = useRef<string | null>(null);
  const docTemplateRef = useRef<HTMLTextAreaElement | null>(null);
  const docAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [docSaveState, setDocSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [docLastSavedAt, setDocLastSavedAt] = useState<number | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const templateDocs = useQuery(api.letterTemplateDocs.list, {});
  const activeTemplate = useQuery(api.letterTemplateDocs.getActive, {});

  const updateTemplateText = useMutation(api.letterTemplateDocs.updateTemplateText);
  const ingestUploadedTemplate = useAction(api.letterTemplateIngest.ingestUploadedTemplate);
  const arcRefDocs = useQuery(api.arcReferenceDocs.list, {});
  const createArcRef = useMutation(api.arcReferenceDocs.create);
  const removeArcRef = useMutation(api.arcReferenceDocs.remove);
  const parseDocxBase64 = useAction(api.arcDocIngest.parseDocxBase64);
  const [arcRefTitle, setArcRefTitle] = useState("");
  const [arcRefUploading, setArcRefUploading] = useState(false);
  const [arcRefErr, setArcRefErr] = useState("");
  const [arcRefOcrHint, setArcRefOcrHint] = useState("");

  const flashSaved = (key: string) => {
    setSaved((s) => ({ ...s, [key]: true }));
    setTimeout(() => setSaved((s) => ({ ...s, [key]: false })), 2000);
  };

  const insertTokenAtCursor = (token: string) => {
    const el = docTemplateRef.current;
    if (!el) {
      setDocTemplateText((prev) => `${prev}${prev.endsWith("\n") || prev.length === 0 ? "" : "\n"}${token}`);
      return;
    }
    const start = el.selectionStart ?? docTemplateText.length;
    const end = el.selectionEnd ?? start;
    const before = docTemplateText.slice(0, start);
    const after = docTemplateText.slice(end);
    const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
    const insert = `${needsLeadingNewline ? "\n" : ""}${token}`;
    const next = before + insert + after;
    setDocTemplateText(next);

    // Restore focus/caret after React applies state.
    requestAnimationFrame(() => {
      el.focus();
      const caret = before.length + insert.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const latestTemplate = templateDocs?.[0];
  const currentTemplate = activeTemplate ?? latestTemplate;

  useEffect(() => {
    if (!currentTemplate?._id) {
      loadedTemplateIdRef.current = null;
      setDocTemplateText("");
      setDocSaveState("idle");
      setDocLastSavedAt(null);
      return;
    }
    if (loadedTemplateIdRef.current === currentTemplate._id) return;
    loadedTemplateIdRef.current = currentTemplate._id;
    setDocTemplateText(editorBodyFromStoredTemplate(currentTemplate));
    setDocSaveState("idle");
  }, [currentTemplate?._id, currentTemplate?.templateText, currentTemplate?.parsedText]);

  useEffect(() => {
    return () => {
      if (docAutosaveTimerRef.current) clearTimeout(docAutosaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!currentTemplate?._id) return;
    if (docTemplateText === editorBodyFromStoredTemplate(currentTemplate)) return;

    if (docAutosaveTimerRef.current) clearTimeout(docAutosaveTimerRef.current);
    docAutosaveTimerRef.current = setTimeout(async () => {
      try {
        setDocSaveState("saving");
        await updateTemplateText({ id: currentTemplate._id, templateText: docTemplateText });
        setDocSaveState("saved");
        setDocLastSavedAt(Date.now());
      } catch {
        setDocSaveState("error");
      }
    }, 900);
  }, [docTemplateText, currentTemplate?._id, currentTemplate?.templateText, currentTemplate?.parsedText, updateTemplateText]);

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-admin px-4 pt-8 pb-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-purple-100 hover:text-white font-medium transition-colors"
            onClick={() => navigate("/admin/dashboard")}
          >
            ← Dashboard
          </button>
          <h1 className="font-extrabold text-white text-xl">⚙️ Settings</h1>
          <div className="w-20" />
        </div>
        <p className="text-purple-200 text-xs mt-2 text-center">Letter templates, ARC rules, and reference docs</p>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-800">Letter Template</h2>
            <Button
              asChild
              size="sm"
              type="button"
              disabled={uploadingTemplate}
              className="bg-[#4f46e5] hover:bg-[#4338ca] text-white"
            >
              <label htmlFor="template-upload-input" className="cursor-pointer">
                {uploadingTemplate ? "Uploading..." : "Upload Template"}
              </label>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Upload one DOCX or PDF.
          </p>
          <Input
            id="template-upload-input"
            type="file"
            accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={async (e) => {
              const inputEl = e.currentTarget;
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setUploadingTemplate(true);
                setTemplateErr("");
                const up = await uploadTemplateFile(file);
                const fileType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
                const bytes = new Uint8Array(await file.arrayBuffer());
                let binary = "";
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                const parsedTextOverride =
                  fileType === "pdf"
                    ? await extractPdfTextInBrowser(file)
                    : undefined;
                if (fileType === "pdf") {
                  if (!parsedTextOverride?.trim()) {
                    throw new Error("Could not extract readable text from PDF. Please upload a text-based PDF or DOCX.");
                  }
                  if (looksLikeRawPdfPayload(parsedTextOverride)) {
                    throw new Error("PDF parsing returned raw file bytes instead of readable text. Please try a DOCX upload for this template.");
                  }
                }
                await ingestUploadedTemplate({
                  fileName: file.name,
                  fileType,
                  sourcePublicUrl: up.publicUrl,
                  sourceFilePath: up.filePath,
                  fileBase64: btoa(binary),
                  parsedTextOverride,
                });
                flashSaved("uploadedTemplate");
              } catch (err) {
                setTemplateErr(String(err));
              } finally {
                setUploadingTemplate(false);
                inputEl.value = "";
              }
            }}
          />
          {uploadingTemplate && <p className="text-xs text-muted-foreground">Uploading and parsing template…</p>}
          {templateErr && <p className="text-xs text-red-600">{templateErr}</p>}
          {saved.uploadedTemplate && <p className="text-xs text-green-600">Template uploaded and parsed.</p>}

          {currentTemplate && (
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
                    onClick={() => insertTokenAtCursor(token)}
                  >
                    Insert {token}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground min-h-[1rem]">
                {docSaveState === "saving" && "Saving..."}
                {docSaveState === "saved" &&
                  `Saved ${docLastSavedAt ? `at ${new Date(docLastSavedAt).toLocaleString()}` : ""}`}
                {docSaveState === "error" && "Autosave failed. Try editing again."}
              </p>
            </div>
          )}
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
                  <Button type="button" size="sm" variant="outline" onClick={() => removeArcRef({ id: d._id })}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
