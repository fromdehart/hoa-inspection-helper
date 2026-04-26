import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { uploadTemplateFile } from "@/lib/uploadClient";

async function extractPdfTextInBrowser(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>)
      .filter((it) => (it.str ?? "").trim().length > 0)
      .map((it) => {
        const tr = it.transform ?? [1, 0, 0, 1, 0, 0];
        return {
          text: (it.str ?? "").trim(),
          x: tr[4] ?? 0,
          y: tr[5] ?? 0,
          hasEOL: !!it.hasEOL,
        };
      });
    items.sort((a, b) => (Math.abs(a.y - b.y) < 1 ? a.x - b.x : b.y - a.y));

    const lines: Array<{ y: number; parts: string[] }> = [];
    for (const it of items) {
      const existing = lines.find((l) => Math.abs(l.y - it.y) < 2.5);
      if (existing) {
        existing.parts.push(it.text);
      } else {
        lines.push({ y: it.y, parts: [it.text] });
      }
    }
    lines.sort((a, b) => b.y - a.y);

    let pageText = "";
    let prevY: number | null = null;
    for (const l of lines) {
      const lineText = l.parts.join(" ").replace(/\s+/g, " ").trim();
      if (!lineText) continue;
      if (prevY != null && Math.abs(prevY - l.y) > 16) {
        pageText += "\n";
      }
      pageText += (pageText ? "\n" : "") + lineText;
      prevY = l.y;
    }
    if (pageText.trim()) pages.push(pageText.trim());
  }
  return pages.join("\n\n");
}

function looksLikeRawPdfPayload(text: string): boolean {
  const sample = text.slice(0, 2000);
  if (sample.includes("%PDF-")) return true;
  const objHits = (sample.match(/\bendobj\b/g) ?? []).length;
  return objHits >= 2 && /\bstream\b/.test(sample);
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

  useEffect(() => {
    if (!latestTemplate?._id) {
      loadedTemplateIdRef.current = null;
      setDocTemplateText("");
      setDocSaveState("idle");
      setDocLastSavedAt(null);
      return;
    }
    if (loadedTemplateIdRef.current === latestTemplate._id) return;
    loadedTemplateIdRef.current = latestTemplate._id;
    setDocTemplateText(latestTemplate?.templateText ?? latestTemplate?.parsedText ?? "");
    setDocSaveState("idle");
  }, [latestTemplate?._id, latestTemplate?.templateText, latestTemplate?.parsedText]);

  useEffect(() => {
    return () => {
      if (docAutosaveTimerRef.current) clearTimeout(docAutosaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!latestTemplate?._id) return;
    if (docTemplateText === (latestTemplate.templateText ?? latestTemplate.parsedText ?? "")) return;

    if (docAutosaveTimerRef.current) clearTimeout(docAutosaveTimerRef.current);
    docAutosaveTimerRef.current = setTimeout(async () => {
      try {
        setDocSaveState("saving");
        await updateTemplateText({ id: latestTemplate._id, templateText: docTemplateText });
        setDocSaveState("saved");
        setDocLastSavedAt(Date.now());
      } catch {
        setDocSaveState("error");
      }
    }, 900);
  }, [docTemplateText, latestTemplate?._id, latestTemplate?.templateText, latestTemplate?.parsedText, updateTemplateText]);

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
        <p className="text-purple-200 text-xs mt-2 text-center">Letter templates & reference text</p>
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

          {latestTemplate && (
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
      </div>
    </div>
  );
}
