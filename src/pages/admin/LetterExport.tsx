import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { useClerk } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

type ReviewRow = {
  _id: string;
  address: string;
  streetId: string;
  streetName: string;
  houseNumber: number;
  aiLetterBullets: string;
  generatedLetterHtml: string | null;
  generatedLetterAt: number | null;
  originalInspectorNotes: string;
  photos: Array<{
    _id: string;
    section: "front" | "side" | "back";
    uploadedAt: number;
    url: string;
  }>;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function sanitizeFilename(s: string) {
  return s.replace(/[/\?%*:|"<>]/g, "-").slice(0, 120);
}

function normalizeLetterHtmlForRender(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "<p>No letter content.</p>";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, "text/html");
    const bodyHtml = doc.body?.innerHTML?.trim();
    if (bodyHtml) return bodyHtml;
    return trimmed;
  } catch {
    return trimmed;
  }
}

type FontStyle = "normal" | "bold" | "italic" | "bolditalic";

type TextRun = { text: string; style: FontStyle };

type RenderContext = {
  margin: number;
  maxW: number;
  maxH: number;
  lineHeight: number;
  fontSize: number;
  y: number;
};

const BULLET_GLYPH = "\u2022";
const BULLET_INDENT = 14;
const TEXT_INDENT = 28;
const PHOTO_MAX_EDGE = 1400;
const PHOTO_JPEG_QUALITY = 0.8;

function resolveFontStyle(el: Element, inherited: FontStyle): FontStyle {
  const tag = el.tagName.toLowerCase();
  let style = inherited;
  if (tag === "strong" || tag === "b") {
    style = style === "italic" ? "bolditalic" : "bold";
  } else if (tag === "em" || tag === "i") {
    style = style === "bold" ? "bolditalic" : "italic";
  }
  const styleAttr = el.getAttribute("style") ?? "";
  if (/font-weight\s*:\s*bold/i.test(styleAttr)) {
    style = style === "italic" ? "bolditalic" : "bold";
  }
  return style;
}

function collectRuns(node: Node, inheritedStyle: FontStyle, runs: TextRun[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\u00a0/g, " ");
    if (text) runs.push({ text, style: inheritedStyle });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") {
    runs.push({ text: "\n", style: inheritedStyle });
    return;
  }

  const style = resolveFontStyle(el, inheritedStyle);
  for (const child of el.childNodes) {
    collectRuns(child, style, runs);
  }
}

function collectRunsFromElement(el: Element): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of el.childNodes) {
    collectRuns(child, "normal", runs);
  }
  return mergeRuns(runs);
}

function mergeRuns(runs: TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.style === run.style &&
      !last.text.endsWith("\n") &&
      !run.text.startsWith("\n")
    ) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function createRenderContext(pdf: jsPDF): RenderContext {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  return {
    margin,
    maxW: pageW - margin * 2,
    maxH: pageH - margin * 2,
    lineHeight: 16,
    fontSize: 12,
    y: margin + 12,
  };
}

function resetPageTextStyle(pdf: jsPDF, ctx: RenderContext): void {
  pdf.setFont("times", "normal");
  pdf.setFontSize(ctx.fontSize);
  pdf.setTextColor(0, 0, 0);
}

function addPdfPage(pdf: jsPDF, ctx: RenderContext): void {
  pdf.addPage();
  ctx.y = ctx.margin + 12;
  resetPageTextStyle(pdf, ctx);
}

function ensureLineSpace(pdf: jsPDF, ctx: RenderContext): void {
  if (ctx.y > ctx.margin + ctx.maxH - ctx.lineHeight) {
    addPdfPage(pdf, ctx);
  }
}

function renderRunsWrapped(
  pdf: jsPDF,
  runs: TextRun[],
  x: number,
  maxWidth: number,
  ctx: RenderContext,
  options?: { onFirstLine?: () => void },
): void {
  let lineParts: Array<{ text: string; style: FontStyle }> = [];
  let lineWidth = 0;
  let drewFirstLine = false;

  const flushLine = () => {
    if (lineParts.length === 0) return;
    ensureLineSpace(pdf, ctx);
    if (!drewFirstLine) {
      options?.onFirstLine?.();
      drewFirstLine = true;
    }
    let drawX = x;
    for (const part of lineParts) {
      pdf.setFont("times", part.style);
      pdf.setFontSize(ctx.fontSize);
      pdf.setTextColor(0, 0, 0);
      pdf.text(part.text, drawX, ctx.y);
      drawX += pdf.getTextWidth(part.text);
    }
    ctx.y += ctx.lineHeight;
    lineParts = [];
    lineWidth = 0;
  };

  for (const run of runs) {
    const segments = run.text.split("\n");
    for (let si = 0; si < segments.length; si++) {
      if (si > 0) flushLine();
      const segment = segments[si];
      if (!segment) continue;

      pdf.setFont("times", run.style);
      pdf.setFontSize(ctx.fontSize);
      const words = segment.match(/\S+|\s+/g) ?? [];
      for (const word of words) {
        const wordWidth = pdf.getTextWidth(word);
        if (lineWidth + wordWidth > maxWidth && lineWidth > 0) {
          flushLine();
        }
        if (word.trim() === "" && lineWidth === 0) continue;
        lineParts.push({ text: word, style: run.style });
        lineWidth += wordWidth;
      }
    }
  }
  flushLine();
}

function isEmptyBlock(el: Element): boolean {
  return (el.textContent ?? "").replace(/\u00a0/g, " ").trim().length === 0;
}

function renderParagraph(pdf: jsPDF, el: Element, ctx: RenderContext): void {
  if (isEmptyBlock(el)) {
    ctx.y += 8;
    return;
  }
  const runs = collectRunsFromElement(el);
  renderRunsWrapped(pdf, runs, ctx.margin, ctx.maxW, ctx);
  ctx.y += 8;
}

function renderList(pdf: jsPDF, el: Element, ctx: RenderContext): void {
  const items = Array.from(el.children).filter((child) => child.tagName.toLowerCase() === "li");
  const textX = ctx.margin + TEXT_INDENT;
  const textMaxW = ctx.maxW - TEXT_INDENT;
  const bulletX = ctx.margin + BULLET_INDENT;

  for (const li of items) {
    if (ctx.y + ctx.lineHeight * 2 > ctx.margin + ctx.maxH) {
      addPdfPage(pdf, ctx);
    }

    const runs = collectRunsFromElement(li);
    let bulletDrawn = false;
    renderRunsWrapped(pdf, runs, textX, textMaxW, ctx, {
      onFirstLine: () => {
        if (bulletDrawn) return;
        pdf.setFont("times", "normal");
        pdf.setFontSize(ctx.fontSize);
        pdf.setTextColor(0, 0, 0);
        pdf.text(BULLET_GLYPH, bulletX, ctx.y);
        bulletDrawn = true;
      },
    });
    ctx.y += 6;
  }
  ctx.y += 8;
}

function processBlockElement(pdf: jsPDF, el: Element, ctx: RenderContext): void {
  const tag = el.tagName.toLowerCase();
  if (tag === "p") {
    renderParagraph(pdf, el, ctx);
    return;
  }
  if (tag === "ul" || tag === "ol") {
    renderList(pdf, el, ctx);
    return;
  }
  if (tag === "div") {
    for (const child of Array.from(el.children)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        processBlockElement(pdf, child as Element, ctx);
      }
    }
  }
}

function renderLetterHtml(pdf: jsPDF, html: string): void {
  const normalized = normalizeLetterHtmlForRender(html);
  const ctx = createRenderContext(pdf);
  resetPageTextStyle(pdf, ctx);

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(normalized, "text/html");
    const body = doc.body;
    if (!body) {
      renderRunsWrapped(pdf, [{ text: "No letter content.", style: "normal" }], ctx.margin, ctx.maxW, ctx);
      return;
    }

    for (const child of Array.from(body.children)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        processBlockElement(pdf, child as Element, ctx);
      }
    }
  } catch {
    renderRunsWrapped(pdf, [{ text: "No letter content.", style: "normal" }], ctx.margin, ctx.maxW, ctx);
  }
}

async function imageUrlToDataUrl(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Image load failed: ${url}`));
  });
  img.src = url;
  await loaded;

  const longestEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longestEdge > PHOTO_MAX_EDGE ? PHOTO_MAX_EDGE / longestEdge : 1;
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context for photo.");
  ctx.drawImage(img, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY),
    width,
    height,
  };
}

function fitIntoBox(
  srcW: number,
  srcH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return {
    x: boxX + (boxW - w) / 2,
    y: boxY + (boxH - h) / 2,
    w,
    h,
  };
}

async function appendPhotoGridPages(
  pdf: jsPDF,
  row: Pick<ReviewRow, "address" | "photos">,
): Promise<{ rendered: number; skipped: number }> {
  if (!row.photos.length) return { rendered: 0, skipped: 0 };

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const marginX = 36;
  const marginTop = 46;
  const marginBottom = 36;
  const headerHeight = 24;
  const gutter = 12;
  const gridY = marginTop + headerHeight;
  const gridW = pageW - marginX * 2;
  const gridH = pageH - gridY - marginBottom;
  const cellW = (gridW - gutter) / 2;
  const cellH = (gridH - gutter) / 2;

  let rendered = 0;
  let skipped = 0;
  for (let i = 0; i < row.photos.length; i += 4) {
    const chunk = row.photos.slice(i, i + 4);
    pdf.addPage();
    const pageNum = Math.floor(i / 4) + 1;
    pdf.setFontSize(11);
    pdf.setTextColor(60, 60, 60);
    pdf.text(`${row.address} - Photo Appendix ${pageNum}`, marginX, marginTop);

    for (let j = 0; j < chunk.length; j++) {
      const col = j % 2;
      const r = Math.floor(j / 2);
      const cellX = marginX + col * (cellW + gutter);
      const cellY = gridY + r * (cellH + gutter);
      const photo = chunk[j];
      try {
        const { dataUrl, width, height } = await imageUrlToDataUrl(photo.url);
        const frame = fitIntoBox(width, height, cellX, cellY, cellW, cellH);
        pdf.addImage(dataUrl, "JPEG", frame.x, frame.y, frame.w, frame.h, undefined, "FAST");
        rendered++;
      } catch {
        skipped++;
      }
    }
  }
  return { rendered, skipped };
}

async function letterHtmlToPdfBlob(
  row: ReviewRow,
  html: string,
): Promise<{ blob: Blob; rendered: number; skipped: number }> {
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: true });
  renderLetterHtml(pdf, html);
  const { rendered, skipped } = await appendPhotoGridPages(pdf, row);
  return { blob: pdf.output("blob"), rendered, skipped };
}

export default function LetterExport() {
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const [generateBusy, setGenerateBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [log, setLog] = useState("");
  const [selectedStreetId, setSelectedStreetId] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [reviewed, setReviewed] = useState<Record<string, true>>({});
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [regenerateExisting, setRegenerateExisting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    current: number;
    total: number;
    phase: "rendering" | "zipping" | "done";
  } | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<{ url: string; title: string } | null>(null);

  const reviewRowsRaw = useQuery(api.properties.listLetterReviewRows);

  const updateAiLetterBullets = useMutation(api.properties.updateAiLetterBullets);
  const saveGeneratedLetterHtml = useMutation(api.properties.saveGeneratedLetterHtml);
  const generateAiLetterBullets = useAction(api.inspectionBullets.generateFromInspectorNotes);
  const generateLetter = useAction(api.letters.generate);

  const reviewRows = (reviewRowsRaw ?? []) as ReviewRow[];

  const streetGroups = useMemo(() => {
    const groupMap = new Map<string, { streetId: string; streetName: string; rows: ReviewRow[] }>();
    for (const row of reviewRows) {
      const key = row.streetId;
      const existing = groupMap.get(key);
      if (existing) existing.rows.push(row);
      else groupMap.set(key, { streetId: key, streetName: row.streetName, rows: [row] });
    }
    return Array.from(groupMap.values()).sort((a, b) => a.streetName.localeCompare(b.streetName));
  }, [reviewRows]);

  const generatedCount = useMemo(
    () => reviewRows.filter((row) => row.generatedLetterAt).length,
    [reviewRows],
  );

  const generateTargets = useMemo(
    () => reviewRows.filter((row) => regenerateExisting || !row.generatedLetterAt),
    [reviewRows, regenerateExisting],
  );

  const exportTargets = useMemo(
    () => reviewRows.filter((row) => row.generatedLetterHtml?.trim()),
    [reviewRows],
  );

  useEffect(() => {
    if (!selectedStreetId && streetGroups.length > 0) {
      setSelectedStreetId(streetGroups[0].streetId);
    }
  }, [selectedStreetId, streetGroups]);

  const activeStreetRows = useMemo(
    () => streetGroups.find((g) => g.streetId === selectedStreetId)?.rows ?? [],
    [selectedStreetId, streetGroups],
  );

  useEffect(() => {
    if (reviewRows.length === 0) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of reviewRows) {
        if (next[row._id] === undefined) next[row._id] = row.aiLetterBullets;
      }
      return next;
    });
  }, [reviewRows]);

  useEffect(() => {
    if (activeStreetRows.length === 0) return;
    setReviewed((prev) => {
      const next = { ...prev };
      for (const row of activeStreetRows) {
        next[row._id] = true;
      }
      return next;
    });
  }, [activeStreetRows]);

  const reviewedCount = Object.keys(reviewed).length;
  const busy = generateBusy || exportBusy;

  const persistDraftFor = async (row: ReviewRow) => {
    const draft = drafts[row._id] ?? row.aiLetterBullets;
    if (draft === row.aiLetterBullets) return;
    setSaveStates((s) => ({ ...s, [row._id]: "saving" }));
    try {
      await updateAiLetterBullets({ id: row._id as Id<"properties">, aiLetterBullets: draft });
      setSaveStates((s) => ({ ...s, [row._id]: "saved" }));
    } catch {
      setSaveStates((s) => ({ ...s, [row._id]: "error" }));
      throw new Error("Could not save bullet points.");
    }
  };

  const persistAllDrafts = async () => {
    for (const row of reviewRows) {
      const draft = drafts[row._id] ?? row.aiLetterBullets;
      if (draft !== row.aiLetterBullets) {
        await persistDraftFor(row);
      }
    }
  };

  const saveRow = async (row: ReviewRow) => {
    try {
      await persistDraftFor(row);
      setLog(`Saved bullet points for ${row.address}`);
    } catch (e) {
      setLog(String(e));
    }
  };

  const regenerateRow = async (row: ReviewRow) => {
    setRegeneratingId(row._id);
    try {
      await persistDraftFor(row);
      const result = await generateAiLetterBullets({ propertyId: row._id as Id<"properties"> });
      if (!result.ok) {
        setLog("error" in result ? result.error : "Could not regenerate bullet points.");
      } else {
        setLog(`Regenerated bullet points for ${row.address}.`);
      }
    } catch (e) {
      setLog(String(e));
    } finally {
      setRegeneratingId(null);
    }
  };

  const generateSingleLetter = async (row: ReviewRow) => {
    setGeneratingId(row._id);
    setLog("");
    try {
      await persistDraftFor(row);
      const result = await generateLetter({ propertyId: row._id as Id<"properties"> });
      if (result.ok === false) {
        setLog(`Skipped ${row.address}: ${result.error}`);
        return;
      }
      await saveGeneratedLetterHtml({ id: row._id as Id<"properties">, html: result.html });
      setLog(`Generated letter for ${row.address}.`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
    } finally {
      setGeneratingId(null);
    }
  };

  const exportSingleLetter = async (row: ReviewRow) => {
    const html = row.generatedLetterHtml?.trim();
    if (!html) {
      setLog(`No letter generated yet for ${row.address}. Generate it first.`);
      return;
    }
    setExportingId(row._id);
    setLog("");
    try {
      setLog(`Rendering ${row.address} (letter + photos)...`);
      const { blob, rendered, skipped } = await letterHtmlToPdfBlob(row, html);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(row.address)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      const skippedNote = skipped > 0 ? ` (photos: ${rendered} added, ${skipped} skipped)` : "";
      setLog(`Exported ${row.address}.pdf${skippedNote}`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
    } finally {
      setExportingId(null);
    }
  };

  const bulkGenerateLetters = async () => {
    if (generateTargets.length === 0) return;
    setGenerateBusy(true);
    setLog("");
    try {
      await persistAllDrafts();

      const skipped: Array<{ address: string; error: string }> = [];
      let generatedCountLocal = 0;

      for (let i = 0; i < generateTargets.length; i++) {
        const row = generateTargets[i];
        setLog(`Generating letter ${i + 1} / ${generateTargets.length}: ${row.address}`);
        const result = await generateLetter({ propertyId: row._id as Id<"properties"> });
        if (result.ok === false) {
          skipped.push({ address: row.address, error: result.error });
          setLog(`Skipped ${row.address}: ${result.error}`);
          continue;
        }
        await saveGeneratedLetterHtml({ id: row._id as Id<"properties">, html: result.html });
        generatedCountLocal++;
      }

      const skippedSuffix =
        skipped.length > 0
          ? `. Skipped ${skipped.length}: ${skipped.map((s) => s.address).join(", ")}`
          : "";
      setLog(`Generated ${generatedCountLocal} letter(s)${skippedSuffix}.`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
    } finally {
      setGenerateBusy(false);
    }
  };

  const exportZip = async () => {
    if (exportTargets.length === 0) return;
    setExportBusy(true);
    setLog("");
    setExportProgress({ current: 0, total: exportTargets.length, phase: "rendering" });
    const zip = new JSZip();
    try {
      await persistAllDrafts();

      let pdfCount = 0;
      for (let i = 0; i < exportTargets.length; i++) {
        const row = exportTargets[i];
        const html = row.generatedLetterHtml?.trim();
        if (!html) {
          setExportProgress({ current: i + 1, total: exportTargets.length, phase: "rendering" });
          continue;
        }

        setLog(`Rendering ${i + 1} / ${exportTargets.length}: ${row.address} (letter + photos)`);
        const { blob, rendered, skipped } = await letterHtmlToPdfBlob(row, html);
        zip.file(`${sanitizeFilename(row.address)}.pdf`, blob);
        pdfCount++;
        if (skipped > 0) {
          setLog(
            `Rendering ${i + 1} / ${exportTargets.length}: ${row.address} (photos: ${rendered} added, ${skipped} skipped)`,
          );
        }
        setExportProgress({ current: i + 1, total: exportTargets.length, phase: "rendering" });
        // Yield to the event loop so the progress bar can repaint between letters.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (pdfCount === 0) {
        setLog("No letters to export.");
        setExportProgress(null);
        return;
      }

      setLog("Zipping...");
      setExportProgress({ current: exportTargets.length, total: exportTargets.length, phase: "zipping" });
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `happier-block-letters-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setExportProgress({ current: exportTargets.length, total: exportTargets.length, phase: "done" });
      setLog(`Done (${pdfCount} PDFs). Reviewed ${reviewedCount}/${reviewRows.length}.`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
      setExportProgress(null);
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-admin px-4 pt-8 pb-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="font-extrabold text-white text-lg">Letter Review & Export</h1>
            <p className="text-sm text-purple-100 mt-1">
              Review bullets, generate letters, then export PDFs.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors"
              onClick={() => navigate("/admin/dashboard")}
            >
              Dashboard
            </button>
            <button
              type="button"
              className="text-sm bg-white/10 hover:bg-white/20 text-white/80 px-3 py-1.5 rounded-full border border-white/20 transition-colors"
              onClick={() => void signOut({ redirectUrl: "/" })}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">Review by street:</span>
            <span className="ml-auto text-xs text-gray-500">Reviewed {reviewedCount}/{reviewRows.length}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {streetGroups.map((g) => (
              <button
                key={g.streetId}
                type="button"
                onClick={() => {
                  setSelectedStreetId(g.streetId);
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  g.streetId === selectedStreetId
                    ? "bg-sky-600 text-white border-sky-600"
                    : "bg-white text-gray-700 border-gray-200"
                }`}
              >
                {g.streetName} ({g.rows.length})
              </button>
            ))}
          </div>
        </div>

        {activeStreetRows.length > 0 ? (
          <div className="space-y-3">
            {activeStreetRows.map((row, idx) => {
                const rowDraft = drafts[row._id] ?? row.aiLetterBullets;
                return (
                  <div key={row._id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-xs text-gray-500">{row.streetName}</p>
                        <h2 className="text-lg font-bold text-gray-800">{row.address}</h2>
                      </div>
                      <div className="flex items-center gap-2">
                        {row.generatedLetterAt ? (
                          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
                            Generated {new Date(row.generatedLetterAt).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                            Not generated
                          </span>
                        )}
                        <p className="text-xs font-medium text-gray-500">{idx + 1} / {activeStreetRows.length}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <h3 className="font-semibold text-gray-800">Photos</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {row.photos.length === 0 ? (
                            <p className="text-sm text-gray-500 col-span-2">No photos available for this property.</p>
                          ) : (
                            row.photos.map((p, i) => (
                              <button
                                key={p._id}
                                type="button"
                                className="w-full rounded-lg border border-gray-200 bg-white overflow-hidden hover:opacity-95 transition-opacity"
                                onClick={() =>
                                  setPhotoLightbox({
                                    url: p.url,
                                    title: `${row.address} - ${p.section} photo ${i + 1}`,
                                  })
                                }
                              >
                                <img
                                  src={p.url}
                                  alt={`${p.section} photo`}
                                  className="w-full h-24 object-contain bg-white"
                                />
                              </button>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-semibold text-gray-800">AI Letter Bullet Points</h3>
                          <span className="text-xs text-gray-500">{saveStates[row._id] ?? "idle"}</span>
                        </div>
                        <textarea
                          value={rowDraft}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [row._id]: e.target.value,
                            }))
                          }
                          rows={10}
                          className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400 resize-y"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => void saveRow(row)} size="sm">Save</Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={regeneratingId === row._id}
                            onClick={() => void regenerateRow(row)}
                          >
                            {regeneratingId === row._id ? "Regenerating..." : "Regenerate"}
                          </Button>
                          <Button
                            size="sm"
                            className="bg-sky-600 hover:bg-sky-700 text-white"
                            disabled={busy || generatingId === row._id || exportingId === row._id}
                            onClick={() => void generateSingleLetter(row)}
                          >
                            {generatingId === row._id
                              ? "Generating..."
                              : row.generatedLetterAt
                                ? "Regenerate letter"
                                : "Generate letter"}
                          </Button>
                          <Button
                            size="sm"
                            className="bg-violet-600 hover:bg-violet-700 text-white"
                            disabled={
                              busy ||
                              !row.generatedLetterHtml?.trim() ||
                              generatingId === row._id ||
                              exportingId === row._id
                            }
                            onClick={() => void exportSingleLetter(row)}
                          >
                            {exportingId === row._id ? "Exporting..." : "Export letter"}
                          </Button>
                        </div>

                        <details className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                          <summary className="cursor-pointer text-sm font-medium text-gray-700 select-none">
                            Original inspection notes
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                            {row.originalInspectorNotes || "No original inspection notes."}
                          </p>
                        </details>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 text-sm text-gray-500">
            {reviewRowsRaw === undefined
              ? "Loading properties..."
              : "No properties in review or complete status available for letter workflow."}
          </div>
        )}

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm text-gray-600">
            Step 1: Review and edit bullet points. Step 2: Generate letters (auto-summarizes notes when needed).
            Step 3: Export PDFs from stored letter HTML.
          </p>
          {log && (
            <p className="text-xs font-mono text-gray-500 whitespace-pre-wrap bg-gray-50 rounded-xl p-3 border border-gray-100">
              {log}
            </p>
          )}

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-800">Generate letters</p>
            <p className="text-xs text-gray-600">
              {reviewRowsRaw === undefined
                ? "..."
                : `${generateTargets.length} property(ies) selected (${reviewRows.length - generatedCount} not yet generated)`}
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={regenerateExisting}
                onChange={(e) => setRegenerateExisting(e.target.checked)}
                className="rounded border-gray-300"
              />
              Regenerate existing letters
            </label>
            <Button
              disabled={busy || generateTargets.length === 0}
              onClick={() => void bulkGenerateLetters()}
              className="w-full h-11 font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded-xl"
            >
              {generateBusy ? "Generating..." : "Generate letters"}
            </Button>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-800">Export ZIP</p>
            <p className="text-xs text-gray-600">
              Download PDFs from letters already generated. Edit bullets and check Regenerate existing if content changed.
            </p>
            <p className="text-sm font-semibold text-gray-800">
              Ready to export: {reviewRowsRaw === undefined ? "..." : exportTargets.length} letter(s)
            </p>
            {exportProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-gray-600">
                  <span>
                    {exportProgress.phase === "zipping"
                      ? "Compressing ZIP..."
                      : exportProgress.phase === "done"
                        ? "Complete"
                        : `Rendering PDFs (${exportProgress.current}/${exportProgress.total})`}
                  </span>
                  <span>
                    {Math.round(
                      (exportProgress.phase === "zipping" || exportProgress.phase === "done"
                        ? 1
                        : exportProgress.current / Math.max(1, exportProgress.total)) * 100,
                    )}
                    %
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      exportProgress.phase === "done" ? "bg-emerald-500" : "bg-violet-600"
                    } ${exportProgress.phase === "zipping" ? "animate-pulse" : ""}`}
                    style={{
                      width: `${
                        (exportProgress.phase === "zipping" || exportProgress.phase === "done"
                          ? 1
                          : exportProgress.current / Math.max(1, exportProgress.total)) * 100
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
            <Button
              disabled={busy || exportTargets.length === 0}
              onClick={() => void exportZip()}
              className="btn-bounce w-full h-12 text-base font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl shadow-lg"
            >
              {exportBusy
                ? exportProgress
                  ? exportProgress.phase === "zipping"
                    ? "Compressing ZIP..."
                    : `Exporting ${exportProgress.current}/${exportProgress.total}...`
                  : "Exporting..."
                : "Download ZIP of PDFs"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={photoLightbox !== null} onOpenChange={(open) => !open && setPhotoLightbox(null)}>
        <DialogContent className="max-w-[min(95vw,80rem)]">
          <DialogHeader>
            <DialogTitle className="text-sm sm:text-base">{photoLightbox?.title ?? "Photo preview"}</DialogTitle>
          </DialogHeader>
          {photoLightbox?.url ? (
            <img
              src={photoLightbox.url}
              alt={photoLightbox.title}
              className="w-full max-h-[75vh] object-contain rounded-lg bg-black/5"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
