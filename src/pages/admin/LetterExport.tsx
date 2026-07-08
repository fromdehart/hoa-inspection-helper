import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { useClerk } from "@clerk/clerk-react";
import { ChevronDown, Download, Eye, Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { deleteUploadedFile, uploadLetterPdf } from "@/lib/uploadClient";

type PropertyStatus = "notStarted" | "inProgress" | "review" | "complete";

type ReviewRow = {
  _id: string;
  address: string;
  streetId: string;
  streetName: string;
  houseNumber: number;
  aiLetterBullets: string;
  generatedLetterHtml: string | null;
  generatedLetterAt: number | null;
  letterPdfUrl: string | null;
  letterPdfFilePath: string | null;
  letterPdfFingerprint: string | null;
  letterPdfRenderedAt: number | null;
  inspectorNotesFront: string;
  inspectorNotesSide: string;
  inspectorNotesBack: string;
  originalInspectorNotes: string;
  status: PropertyStatus;
  noViolationsConfirmed: boolean;
  isLetterWorkflowReady: boolean;
  photos: Array<{
    _id: string;
    section: "front" | "side" | "back";
    uploadedAt: number;
    url: string;
    thumbnailUrl: string;
  }>;
};

const STATUS_BADGE: Record<PropertyStatus, string> = {
  notStarted: "text-slate-700 bg-slate-100 border-slate-200",
  inProgress: "text-amber-800 bg-amber-50 border-amber-200",
  review: "text-violet-800 bg-violet-50 border-violet-200",
  complete: "text-emerald-800 bg-emerald-50 border-emerald-200",
};

const STATUS_LABEL: Record<PropertyStatus, string> = {
  notStarted: "Not started",
  inProgress: "In progress",
  review: "Review",
  complete: "Complete",
};

type SaveState = "idle" | "saving" | "saved" | "error";
type NotesDraft = { front: string; side: string; back: string };
type ConfirmMarkStreet = {
  streetId: string;
  streetName: string;
  withLetters: number;
  noViolations: number;
  totalOnStreet: number;
};

const AUTOSAVE_DELAY_MS = 800;
/** Bypass PDF cache until cache invalidation is wired to bullet edits. */
const FORCE_PDF_RERENDER = true;

function rowsNeedingLetters(rows: ReviewRow[]): ReviewRow[] {
  return rows.filter((row) => !row.noViolationsConfirmed);
}

function seedNotesDraft(row: ReviewRow): NotesDraft {
  const front = row.inspectorNotesFront ?? "";
  const side = row.inspectorNotesSide ?? "";
  const back = row.inspectorNotesBack ?? "";
  const original = row.originalInspectorNotes ?? "";
  const hasStored = front.trim() || side.trim() || back.trim();
  if (!hasStored && original.trim()) {
    return { front: original, side: "", back: "" };
  }
  return { front, side, back };
}

function notesDraftMatchesRow(draft: NotesDraft, row: ReviewRow): boolean {
  return (
    draft.front === (row.inspectorNotesFront ?? "") &&
    draft.side === (row.inspectorNotesSide ?? "") &&
    draft.back === (row.inspectorNotesBack ?? "")
  );
}

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
const PHOTO_FETCH_CONCURRENCY = 6;
const PHOTO_MAX_EDGE = 1400;
const PHOTO_JPEG_QUALITY = 0.8;
/** Bump when PDF rendering logic changes to invalidate cached letter PDFs. */
const PDF_RENDER_VERSION = 3;

type LoadedPhoto = { dataUrl: string; width: number; height: number };

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Decode via canvas with `imageOrientation: "from-image"` so EXIF rotation from phone
 * photos is baked into the pixels. Embedding raw JPEG bytes (or reading bitmap dims
 * without orientation) leaves rotated/stretched images because jsPDF ignores EXIF.
 */
async function loadPhotoViaCanvas(blob: Blob): Promise<LoadedPhoto> {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    const longestEdge = Math.max(bmp.width, bmp.height);
    const scale = longestEdge > PHOTO_MAX_EDGE ? PHOTO_MAX_EDGE / longestEdge : 1;
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas context for photo.");
    ctx.drawImage(bmp, 0, 0, width, height);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY),
      width,
      height,
    };
  } finally {
    bmp.close();
  }
}

async function loadPhotoForPdf(url: string): Promise<LoadedPhoto> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed: ${url} (${res.status})`);
  const blob = await res.blob();
  return loadPhotoViaCanvas(blob);
}

function photoThumbnailSource(photo: ReviewRow["photos"][number]): string {
  return photo.thumbnailUrl || photo.url;
}

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

function parseCssLengthToPt(value: string, fontSize: number): number {
  const v = value.trim().toLowerCase();
  const num = parseFloat(v);
  if (Number.isNaN(num)) return 0;
  if (v.endsWith("pt")) return num;
  if (v.endsWith("px")) return num * 0.75;
  if (v.endsWith("em")) return num * fontSize;
  return num;
}

/** Read margin-bottom from inline style; default tight gap for unstyled letter lines. */
function parseParagraphMarginBottom(el: Element, fontSize: number): number {
  const style = el.getAttribute("style") ?? "";
  const marginBottom = style.match(/margin-bottom\s*:\s*([^;]+)/i);
  if (marginBottom) return parseCssLengthToPt(marginBottom[1], fontSize);

  const margin = style.match(/margin\s*:\s*([^;]+)/i);
  if (margin) {
    const parts = margin[1].trim().split(/\s+/);
    if (parts.length === 1) return parseCssLengthToPt(parts[0], fontSize);
    if (parts.length === 2) return parseCssLengthToPt(parts[0], fontSize);
    if (parts.length === 3) return parseCssLengthToPt(parts[1], fontSize);
    if (parts.length >= 4) return parseCssLengthToPt(parts[2], fontSize);
  }

  return 1;
}

function createRenderContext(pdf: jsPDF): RenderContext {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  return {
    margin,
    maxW: pageW - margin * 2,
    maxH: pageH - margin * 2,
    lineHeight: 14,
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
    ctx.y += 10;
    return;
  }
  const runs = collectRunsFromElement(el);
  renderRunsWrapped(pdf, runs, ctx.margin, ctx.maxW, ctx);
  ctx.y += parseParagraphMarginBottom(el, ctx.fontSize);
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
    ctx.y += parseParagraphMarginBottom(li, ctx.fontSize);
  }
  const ulMargin = parseParagraphMarginBottom(el, ctx.fontSize);
  ctx.y += ulMargin > 1 ? ulMargin : 4;
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

  const loaded = await mapWithConcurrency(row.photos, PHOTO_FETCH_CONCURRENCY, async (photo) => {
    try {
      return await loadPhotoForPdf(photoThumbnailSource(photo));
    } catch {
      return null;
    }
  });

  let rendered = 0;
  let skipped = 0;
  for (let i = 0; i < row.photos.length; i += 4) {
    const chunkLoaded = loaded.slice(i, i + 4);
    pdf.addPage();
    const pageNum = Math.floor(i / 4) + 1;
    pdf.setFontSize(11);
    pdf.setTextColor(60, 60, 60);
    pdf.text(`${row.address} - Photo Appendix ${pageNum}`, marginX, marginTop);

    for (let j = 0; j < chunkLoaded.length; j++) {
      const col = j % 2;
      const r = Math.floor(j / 2);
      const cellX = marginX + col * (cellW + gutter);
      const cellY = gridY + r * (cellH + gutter);
      const image = chunkLoaded[j];
      if (!image) {
        skipped++;
        continue;
      }
      const frame = fitIntoBox(image.width, image.height, cellX, cellY, cellW, cellH);
      pdf.addImage(image.dataUrl, "JPEG", frame.x, frame.y, frame.w, frame.h, undefined, "FAST");
      rendered++;
    }
  }
  return { rendered, skipped };
}

async function letterHtmlToPdfBlob(
  row: ReviewRow,
  html: string,
): Promise<{ blob: Blob; rendered: number; skipped: number }> {
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: false });
  renderLetterHtml(pdf, html);
  const { rendered, skipped } = await appendPhotoGridPages(pdf, row);
  return { blob: pdf.output("blob"), rendered, skipped };
}

function computeLetterFingerprint(row: ReviewRow): string {
  const photoParts = row.photos
    .map((photo) => `${photo._id}:${photo.uploadedAt}`)
    .sort()
    .join("|");
  return [PDF_RENDER_VERSION, row.generatedLetterAt ?? 0, photoParts].join("::");
}

type LetterPdfResult = {
  blob: Blob;
  rendered: number;
  skipped: number;
  fromCache: boolean;
};

async function getLetterPdfBlob(
  row: ReviewRow,
  html: string,
  options: {
    forceRerender: boolean;
    saveLetterPdfMeta: (args: {
      id: Id<"properties">;
      url: string;
      filePath: string;
      fingerprint: string;
    }) => Promise<null>;
  },
): Promise<LetterPdfResult> {
  const fingerprint = computeLetterFingerprint(row);
  if (
    !options.forceRerender &&
    row.letterPdfUrl &&
    row.letterPdfFingerprint === fingerprint
  ) {
    try {
      const res = await fetch(row.letterPdfUrl);
      if (res.ok) {
        const blob = await res.blob();
        return { blob, rendered: 0, skipped: 0, fromCache: true };
      }
    } catch {
      /* fall through to render */
    }
  }

  const { blob, rendered, skipped } = await letterHtmlToPdfBlob(row, html);

  try {
    if (row.letterPdfFilePath) {
      await deleteUploadedFile(row.letterPdfFilePath).catch(() => {
        /* non-fatal */
      });
    }
    const file = new File([blob], `${sanitizeFilename(row.address)}.pdf`, {
      type: "application/pdf",
    });
    const { publicUrl, filePath } = await uploadLetterPdf(row._id, file);
    await options.saveLetterPdfMeta({
      id: row._id as Id<"properties">,
      url: publicUrl,
      filePath,
      fingerprint,
    });
  } catch (err) {
    console.warn("Failed to cache letter PDF on upload server:", err);
  }

  return { blob, rendered, skipped, fromCache: false };
}

export default function LetterExport() {
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const [exportBusy, setExportBusy] = useState(false);
  const [log, setLog] = useState("");
  const [selectedStreetId, setSelectedStreetId] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, NotesDraft>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [noteSaveStates, setNoteSaveStates] = useState<Record<string, SaveState>>({});
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [streetMenuOpenId, setStreetMenuOpenId] = useState<string | null>(null);
  const [confirmMarkStreet, setConfirmMarkStreet] = useState<ConfirmMarkStreet | null>(null);
  const [markCompleteBusy, setMarkCompleteBusy] = useState(false);
  const [togglingNoViolationsId, setTogglingNoViolationsId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Kept for future cache-bust UI; always bypass cache via FORCE_PDF_RERENDER for now.
  const [forceRerenderPdfs] = useState(false);
  const [exportProgress, setExportProgress] = useState<{
    current: number;
    total: number;
    phase: "generating" | "zipping" | "done";
  } | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<{ url: string; title: string } | null>(null);
  const [previewRow, setPreviewRow] = useState<{ address: string; html: string } | null>(null);

  const bulletAutosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const noteAutosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const reviewRowsRaw = useQuery(api.properties.listLetterReviewRows);
  const streetReadinessRaw = useQuery(api.properties.listStreetMarkCompleteReadiness);

  const updateAiLetterBullets = useMutation(api.properties.updateAiLetterBullets);
  const updateInspectorNotes = useMutation(api.properties.updateInspectorNotes);
  const setNoViolationsConfirmed = useMutation(api.properties.setNoViolationsConfirmed);
  const markStreetLetterReviewComplete = useMutation(api.properties.markStreetLetterReviewComplete);
  const saveGeneratedLetterHtml = useMutation(api.properties.saveGeneratedLetterHtml);
  const saveLetterPdfMeta = useMutation(api.properties.saveLetterPdfMeta);
  const generateAiLetterBullets = useAction(api.inspectionBullets.generateFromInspectorNotes);
  const generateLetter = useAction(api.letters.generate);

  const reviewRows = (reviewRowsRaw ?? []) as ReviewRow[];

  const streetReadinessById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof streetReadinessRaw>[number]>();
    for (const row of streetReadinessRaw ?? []) {
      map.set(row.streetId, row);
    }
    return map;
  }, [streetReadinessRaw]);

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
    setNotesDrafts((prev) => {
      const next = { ...prev };
      for (const row of reviewRows) {
        if (next[row._id] === undefined) next[row._id] = seedNotesDraft(row);
      }
      return next;
    });
  }, [reviewRows]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(bulletAutosaveTimers.current)) clearTimeout(timer);
      for (const timer of Object.values(noteAutosaveTimers.current)) clearTimeout(timer);
    };
  }, []);

  const busy = exportBusy;

  const persistDraftFor = useCallback(
    async (row: ReviewRow) => {
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
    },
    [drafts, updateAiLetterBullets],
  );

  const persistNoteDraftFor = useCallback(
    async (row: ReviewRow) => {
      const draft = notesDrafts[row._id] ?? seedNotesDraft(row);
      if (notesDraftMatchesRow(draft, row)) return;
      setNoteSaveStates((s) => ({ ...s, [row._id]: "saving" }));
      try {
        await updateInspectorNotes({
          id: row._id as Id<"properties">,
          inspectorNotesFront: draft.front,
          inspectorNotesSide: draft.side,
          inspectorNotesBack: draft.back,
        });
        setNoteSaveStates((s) => ({ ...s, [row._id]: "saved" }));
      } catch {
        setNoteSaveStates((s) => ({ ...s, [row._id]: "error" }));
        throw new Error("Could not save inspection notes.");
      }
    },
    [notesDrafts, updateInspectorNotes],
  );

  const scheduleBulletAutosave = useCallback(
    (row: ReviewRow) => {
      const existing = bulletAutosaveTimers.current[row._id];
      if (existing) clearTimeout(existing);
      bulletAutosaveTimers.current[row._id] = setTimeout(() => {
        void persistDraftFor(row).catch((e) => setLog(String(e)));
      }, AUTOSAVE_DELAY_MS);
    },
    [persistDraftFor],
  );

  const scheduleNoteAutosave = useCallback(
    (row: ReviewRow) => {
      const existing = noteAutosaveTimers.current[row._id];
      if (existing) clearTimeout(existing);
      noteAutosaveTimers.current[row._id] = setTimeout(() => {
        void persistNoteDraftFor(row).catch((e) => setLog(String(e)));
      }, AUTOSAVE_DELAY_MS);
    },
    [persistNoteDraftFor],
  );

  const flushBulletAutosave = useCallback(
    async (row: ReviewRow) => {
      const existing = bulletAutosaveTimers.current[row._id];
      if (existing) {
        clearTimeout(existing);
        delete bulletAutosaveTimers.current[row._id];
      }
      await persistDraftFor(row);
    },
    [persistDraftFor],
  );

  const flushNoteAutosave = useCallback(
    async (row: ReviewRow) => {
      const existing = noteAutosaveTimers.current[row._id];
      if (existing) {
        clearTimeout(existing);
        delete noteAutosaveTimers.current[row._id];
      }
      await persistNoteDraftFor(row);
    },
    [persistNoteDraftFor],
  );

  const flushRowDrafts = useCallback(
    async (row: ReviewRow) => {
      await flushBulletAutosave(row);
      await flushNoteAutosave(row);
    },
    [flushBulletAutosave, flushNoteAutosave],
  );

  const regenerateFreshLetterHtml = useCallback(
    async (row: ReviewRow): Promise<string | null> => {
      const result = await generateLetter({ propertyId: row._id as Id<"properties"> });
      if (result.ok === false) {
        setLog(`Skipped ${row.address}: ${result.error}`);
        return null;
      }
      await saveGeneratedLetterHtml({ id: row._id as Id<"properties">, html: result.html });
      return result.html;
    },
    [generateLetter, saveGeneratedLetterHtml],
  );

  const regenerateRow = async (row: ReviewRow) => {
    setRegeneratingId(row._id);
    try {
      await flushRowDrafts(row);
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

  const downloadSingleLetter = async (row: ReviewRow) => {
    if (row.noViolationsConfirmed) {
      setLog(`Skipping ${row.address} — no violations confirmed.`);
      return;
    }
    setExportingId(row._id);
    setLog("");
    try {
      await flushRowDrafts(row);
      setLog(`Generating letter for ${row.address}...`);
      const html = await regenerateFreshLetterHtml(row);
      if (!html) return;

      setLog(`Rendering PDF for ${row.address}...`);
      const { blob, rendered, skipped } = await getLetterPdfBlob(row, html, {
        forceRerender: FORCE_PDF_RERENDER || forceRerenderPdfs,
        saveLetterPdfMeta,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(row.address)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      const skippedNote = skipped > 0 ? ` (photos: ${rendered} added, ${skipped} skipped)` : "";
      setLog(`Downloaded ${row.address}.pdf${skippedNote}`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
    } finally {
      setExportingId(null);
    }
  };

  const viewSingleLetter = async (row: ReviewRow) => {
    if (row.noViolationsConfirmed) {
      setLog(`Skipping ${row.address} — no violations confirmed.`);
      return;
    }
    setViewingId(row._id);
    setLog("");
    try {
      await flushRowDrafts(row);
      setLog(`Generating preview for ${row.address}...`);
      const html = await regenerateFreshLetterHtml(row);
      if (!html) return;
      setPreviewRow({ address: row.address, html });
      setLog(`Preview ready for ${row.address}.`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
    } finally {
      setViewingId(null);
    }
  };

  const exportZip = async (rows: ReviewRow[], zipLabel: string) => {
    const exportRows = rowsNeedingLetters(rows);
    if (exportRows.length === 0) {
      setLog("No letters to export.");
      return;
    }
    setExportBusy(true);
    setLog("");
    setExportProgress({ current: 0, total: exportRows.length, phase: "generating" });
    const zip = new JSZip();
    try {
      let pdfCount = 0;
      const skipped: Array<{ address: string; error: string }> = [];

      for (let i = 0; i < exportRows.length; i++) {
        const row = exportRows[i];
        await flushRowDrafts(row);
        setLog(`Generating letter ${i + 1} / ${exportRows.length}: ${row.address}`);
        const html = await regenerateFreshLetterHtml(row);
        if (!html) {
          skipped.push({ address: row.address, error: "Letter generation failed" });
          setExportProgress({ current: i + 1, total: exportRows.length, phase: "generating" });
          await new Promise((resolve) => setTimeout(resolve, 0));
          continue;
        }

        const { blob, rendered, skipped: photosSkipped } = await getLetterPdfBlob(row, html, {
          forceRerender: FORCE_PDF_RERENDER || forceRerenderPdfs,
          saveLetterPdfMeta,
        });
        zip.file(`${sanitizeFilename(row.address)}.pdf`, blob);
        pdfCount++;
        if (photosSkipped > 0) {
          setLog(
            `Rendered ${i + 1} / ${exportRows.length}: ${row.address} (photos: ${rendered} added, ${photosSkipped} skipped)`,
          );
        }
        setExportProgress({ current: i + 1, total: exportRows.length, phase: "generating" });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (pdfCount === 0) {
        setLog("No letters to export.");
        setExportProgress(null);
        return;
      }

      setLog("Zipping...");
      setExportProgress({ current: exportRows.length, total: exportRows.length, phase: "zipping" });
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFilename(zipLabel)}-letters-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setExportProgress({ current: exportRows.length, total: exportRows.length, phase: "done" });
      const skippedSuffix =
        skipped.length > 0
          ? `. Skipped ${skipped.length}: ${skipped.map((s) => s.address).join(", ")}`
          : "";
      const noViolationsSkipped = rows.length - exportRows.length;
      const noViolationsSuffix =
        noViolationsSkipped > 0
          ? `. ${noViolationsSkipped} no-violations home${noViolationsSkipped === 1 ? "" : "s"} omitted`
          : "";
      setLog(`Done (${pdfCount} PDFs${skippedSuffix}${noViolationsSuffix}).`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
      setExportProgress(null);
    } finally {
      setExportBusy(false);
    }
  };

  const activeStreetName =
    streetGroups.find((g) => g.streetId === selectedStreetId)?.streetName ?? "street";

  const downloadCurrentStreet = () => {
    setDownloadMenuOpen(false);
    void exportZip(activeStreetRows, activeStreetName);
  };

  const downloadAllStreets = () => {
    setDownloadMenuOpen(false);
    void exportZip(reviewRows, "all-streets");
  };

  const openMarkStreetConfirm = (
    streetId: string,
    streetName: string,
    readiness: NonNullable<typeof streetReadinessRaw>[number],
  ) => {
    setStreetMenuOpenId(null);
    setConfirmMarkStreet({
      streetId,
      streetName,
      withLetters: readiness.withLetters,
      noViolations: readiness.noViolations,
      totalOnStreet: readiness.totalOnStreet,
    });
  };

  const handleMarkStreetComplete = async () => {
    if (!confirmMarkStreet) return;
    setMarkCompleteBusy(true);
    try {
      const result = await markStreetLetterReviewComplete({
        streetId: confirmMarkStreet.streetId as Id<"streets">,
      });
      setLog(
        `Marked ${result.updated} properties on ${confirmMarkStreet.streetName} complete` +
          (result.skippedNoViolations > 0
            ? ` (${result.skippedNoViolations} no-violations, no letter needed)`
            : "") +
          ".",
      );
    } catch (e) {
      setLog(String(e));
    } finally {
      setMarkCompleteBusy(false);
      setConfirmMarkStreet(null);
    }
  };

  const exportProgressPercent = exportProgress
    ? Math.round(
        (exportProgress.phase === "zipping" || exportProgress.phase === "done"
          ? 1
          : exportProgress.current / Math.max(1, exportProgress.total)) * 100,
      )
    : 0;

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-admin px-4 pt-8 pb-5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="font-extrabold text-white text-lg">Letter Review & Export</h1>
            <p className="text-sm text-purple-100 mt-1">
              Review bullets and notes, then download letters as PDFs.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
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
        {(exportBusy || log) && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
            {exportProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-gray-600">
                  <span>
                    {exportProgress.phase === "zipping"
                      ? "Compressing ZIP..."
                      : exportProgress.phase === "done"
                        ? "Complete"
                        : `Generating letter ${Math.min(exportProgress.current + 1, exportProgress.total)} of ${exportProgress.total}`}
                  </span>
                  <span>{exportProgressPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      exportProgress.phase === "done" ? "bg-emerald-500" : "bg-violet-600"
                    } ${exportProgress.phase === "zipping" ? "animate-pulse" : ""}`}
                    style={{ width: `${exportProgressPercent}%` }}
                  />
                </div>
              </div>
            )}
            {log && (
              <p className="text-xs font-mono text-gray-500 whitespace-pre-wrap bg-gray-50 rounded-xl p-3 border border-gray-100">
                {log}
              </p>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex flex-wrap items-center gap-2">
            {streetGroups.map((g) => {
              const isSelected = g.streetId === selectedStreetId;
              const readiness = streetReadinessById.get(g.streetId);
              return (
                <div key={g.streetId} className="relative text-xs font-semibold">
                  <div
                    className={`inline-flex items-stretch overflow-hidden rounded-full border ${
                      isSelected ? "border-sky-600" : "border-gray-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedStreetId(g.streetId)}
                      className={`px-3 py-1.5 transition-colors ${
                        isSelected ? "bg-sky-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {g.streetName} ({g.rows.length})
                    </button>
                    <button
                      type="button"
                      aria-label={`Actions for ${g.streetName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDownloadMenuOpen(false);
                        setStreetMenuOpenId((id) => (id === g.streetId ? null : g.streetId));
                      }}
                      className={`border-l px-2 py-1.5 transition-colors ${
                        isSelected
                          ? "border-sky-500 bg-sky-600 text-white hover:bg-sky-700"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {streetMenuOpenId === g.streetId && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setStreetMenuOpenId(null)}
                      />
                      <div className="absolute left-0 z-20 mt-1 w-max max-w-xs rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                        <button
                          type="button"
                          disabled={!readiness?.canMarkComplete || markCompleteBusy || busy}
                          onClick={() => {
                            if (readiness) openMarkStreetConfirm(g.streetId, g.streetName, readiness);
                          }}
                          className="block whitespace-nowrap px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Mark street complete
                        </button>
                        {readiness && !readiness.canMarkComplete ? (
                          <p className="px-3 pb-2 text-xs text-gray-500 whitespace-normal">
                            {readiness.notReadyAddresses.length > 0
                              ? `${readiness.notReadyAddresses.join(", ")} still need letter bullets or a no-violations confirmation.`
                              : "All homes need letter bullets or a no-violations confirmation."}
                          </p>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            <div className="relative ml-auto">
              <Button
                disabled={busy || rowsNeedingLetters(reviewRows).length === 0}
                onClick={() => {
                  setStreetMenuOpenId(null);
                  setDownloadMenuOpen((o) => !o);
                }}
                className="h-9 px-4 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-full shadow-md inline-flex items-center gap-1.5"
              >
                {exportBusy
                  ? exportProgress
                    ? exportProgress.phase === "zipping"
                      ? "Compressing ZIP..."
                      : `Exporting ${exportProgress.current}/${exportProgress.total}...`
                    : "Exporting..."
                  : "Download Letters"}
                {!exportBusy && <ChevronDown className="h-4 w-4" />}
              </Button>
              {downloadMenuOpen && !exportBusy && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setDownloadMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      disabled={activeStreetRows.length === 0 || rowsNeedingLetters(activeStreetRows).length === 0}
                      onClick={downloadCurrentStreet}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      This street — {activeStreetName} ({rowsNeedingLetters(activeStreetRows).length})
                    </button>
                    <button
                      type="button"
                      disabled={rowsNeedingLetters(reviewRows).length === 0}
                      onClick={downloadAllStreets}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      All streets ({rowsNeedingLetters(reviewRows).length})
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {activeStreetRows.length > 0 ? (
          <div className="space-y-3">
            {activeStreetRows.map((row, idx) => {
              const rowDraft = drafts[row._id] ?? row.aiLetterBullets;
              const notesDraft = notesDrafts[row._id] ?? seedNotesDraft(row);
              const rowBusy = exportingId === row._id || viewingId === row._id;
              return (
                <div key={row._id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-xs text-gray-500">{row.streetName}</p>
                      <h2 className="text-lg font-bold text-gray-800">{row.address}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-medium border px-2 py-1 rounded-full ${STATUS_BADGE[row.status]}`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                      {row.noViolationsConfirmed ? (
                        <span className="text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 px-2 py-1 rounded-full">
                          No violations
                        </span>
                      ) : row.generatedLetterAt ? (
                        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
                          Generated {new Date(row.generatedLetterAt).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                          Not generated
                        </span>
                      )}
                      <p className="text-xs font-medium text-gray-500">
                        {idx + 1} / {activeStreetRows.length}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <h3 className="font-semibold text-gray-800">Photos</h3>
                      {row.photos.length === 0 ? (
                        <p className="text-sm text-gray-500">No photos available for this property.</p>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
                          {row.photos.map((p, i) => (
                            <div key={p._id} className="relative min-w-0">
                              <button
                                type="button"
                                className="w-full rounded border overflow-hidden text-left transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                onClick={() =>
                                  setPhotoLightbox({
                                    url: p.url,
                                    title: `${row.address} - ${p.section} photo ${i + 1}`,
                                  })
                                }
                              >
                                <img
                                  src={photoThumbnailSource(p)}
                                  alt={`${p.section} photo`}
                                  className="w-full h-32 object-cover"
                                />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      {!row.noViolationsConfirmed ? (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-gray-800">AI Letter Bullet Points</h3>
                            <div className="flex items-center gap-2">
                              {(saveStates[row._id] && saveStates[row._id] !== "idle") ? (
                                <span className="text-xs text-gray-500">{saveStates[row._id]}</span>
                              ) : null}
                              <button
                                type="button"
                                title="View letter"
                                disabled={busy || rowBusy}
                                onClick={() => void viewSingleLetter(row)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                              >
                                {viewingId === row._id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                title="Download PDF"
                                disabled={busy || rowBusy}
                                onClick={() => void downloadSingleLetter(row)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                              >
                                {exportingId === row._id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Download className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </div>
                          <textarea
                            value={rowDraft}
                            onChange={(e) => {
                              setDrafts((d) => ({
                                ...d,
                                [row._id]: e.target.value,
                              }));
                              scheduleBulletAutosave(row);
                            }}
                            onBlur={() => void flushBulletAutosave(row).catch((e) => setLog(String(e)))}
                            rows={10}
                            disabled={busy}
                            className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400 resize-y"
                          />
                        </>
                      ) : null}

                      <details className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                        <summary className="cursor-pointer text-sm font-medium text-gray-700 select-none">
                          Inspection notes
                          {noteSaveStates[row._id] && noteSaveStates[row._id] !== "idle" ? (
                            <span className="ml-2 text-xs font-normal text-gray-500">
                              {noteSaveStates[row._id]}
                            </span>
                          ) : null}
                        </summary>
                        <div className="mt-3 space-y-3">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-600">Front</label>
                            <textarea
                              value={notesDraft.front}
                              onChange={(e) => {
                                setNotesDrafts((d) => ({
                                  ...d,
                                  [row._id]: { ...notesDraft, front: e.target.value },
                                }));
                                scheduleNoteAutosave(row);
                              }}
                              onBlur={() => void flushNoteAutosave(row).catch((e) => setLog(String(e)))}
                              rows={3}
                              className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400 resize-y bg-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-600">Side</label>
                            <textarea
                              value={notesDraft.side}
                              onChange={(e) => {
                                setNotesDrafts((d) => ({
                                  ...d,
                                  [row._id]: { ...notesDraft, side: e.target.value },
                                }));
                                scheduleNoteAutosave(row);
                              }}
                              onBlur={() => void flushNoteAutosave(row).catch((e) => setLog(String(e)))}
                              rows={3}
                              className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400 resize-y bg-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-600">Back</label>
                            <textarea
                              value={notesDraft.back}
                              onChange={(e) => {
                                setNotesDrafts((d) => ({
                                  ...d,
                                  [row._id]: { ...notesDraft, back: e.target.value },
                                }));
                                scheduleNoteAutosave(row);
                              }}
                              onBlur={() => void flushNoteAutosave(row).catch((e) => setLog(String(e)))}
                              rows={3}
                              className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400 resize-y bg-white"
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={regeneratingId === row._id || busy}
                            onClick={() => void regenerateRow(row)}
                          >
                            {regeneratingId === row._id ? "Regenerating..." : "Regenerate bullets"}
                          </Button>
                        </div>
                      </details>
                      <div className="flex justify-start pt-1">
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-gray-300"
                            checked={row.noViolationsConfirmed}
                            disabled={busy || togglingNoViolationsId === row._id}
                            onChange={async (e) => {
                              setTogglingNoViolationsId(row._id);
                              try {
                                await setNoViolationsConfirmed({
                                  id: row._id as Id<"properties">,
                                  confirmed: e.target.checked,
                                });
                              } catch (err) {
                                setLog(String(err));
                              } finally {
                                setTogglingNoViolationsId(null);
                              }
                            }}
                          />
                          <span>No violations - Skip letter for this property.</span>
                        </label>
                      </div>
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
              : "No properties available for letter workflow."}
          </div>
        )}
      </div>

      <AlertDialog
        open={confirmMarkStreet !== null}
        onOpenChange={(open) => !open && !markCompleteBusy && setConfirmMarkStreet(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {confirmMarkStreet?.streetName} complete?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {confirmMarkStreet ? (
                  <>
                    <p>
                      {confirmMarkStreet.withLetters} home
                      {confirmMarkStreet.withLetters === 1 ? "" : "s"} with violation letters
                    </p>
                    <p>
                      {confirmMarkStreet.noViolations} home
                      {confirmMarkStreet.noViolations === 1 ? "" : "s"} confirmed no violations (no letter
                      needed)
                    </p>
                    <p>
                      This marks all {confirmMarkStreet.totalOnStreet} properties on{" "}
                      {confirmMarkStreet.streetName} as Completed and ready to send.
                    </p>
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markCompleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={markCompleteBusy}
              onClick={(e) => {
                e.preventDefault();
                void handleMarkStreetComplete();
              }}
            >
              {markCompleteBusy ? "Marking..." : "Mark complete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <Dialog open={previewRow !== null} onOpenChange={(open) => !open && setPreviewRow(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Letter Preview — {previewRow?.address}</DialogTitle>
          </DialogHeader>
          {previewRow?.html ? (
            <div
              className="border rounded p-4 overflow-auto"
              dangerouslySetInnerHTML={{ __html: previewRow.html }}
            />
          ) : null}
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => setPreviewRow(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
