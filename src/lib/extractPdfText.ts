import { createWorker } from "tesseract.js";

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(new Error("Could not read file."));
    r.readAsDataURL(file);
  });
}

/** Heuristic: extracted "text" is actually raw PDF stream garbage. */
export function looksLikeRawPdfPayload(text: string): boolean {
  const sample = text.slice(0, 2000);
  if (sample.includes("%PDF-")) return true;
  const objHits = (sample.match(/\bendobj\b/g) ?? []).length;
  return objHits >= 2 && /\bstream\b/.test(sample);
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();
  }
  return pdfjs;
}

/** Extract text from PDFs that have an embedded text layer (fast). */
export async function extractPdfTextInBrowserFromData(data: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: data.slice() });
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

export async function extractPdfTextInBrowser(file: File): Promise<string> {
  const raw = new Uint8Array(await file.arrayBuffer());
  return extractPdfTextInBrowserFromData(raw.slice());
}

const MIN_TEXT_LAYER_CHARS = 80;
const MAX_OCR_PAGES = 35;

/**
 * When the PDF has little or no embedded text (typical for scans), render pages to images and run Tesseract OCR.
 * First page is slower while the OCR engine downloads (~few MB once, then cached by the browser).
 */
async function extractPdfTextViaOcrFromData(
  data: Uint8Array,
  onProgress?: (message: string) => void,
): Promise<string> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: data.slice() });
  const doc = await task.promise;
  const pageCount = Math.min(doc.numPages, MAX_OCR_PAGES);
  if (doc.numPages > MAX_OCR_PAGES) {
    onProgress?.(`OCR: processing first ${MAX_OCR_PAGES} of ${doc.numPages} pages…`);
  }

  const worker = await createWorker("eng", 1, { logger: () => {} });
  const parts: string[] = [];
  try {
    for (let i = 1; i <= pageCount; i++) {
      onProgress?.(`OCR: page ${i} of ${pageCount}…`);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.25, 2000 / Math.max(base.width, base.height, 1));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not available for OCR.");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const {
        data: { text },
      } = await worker.recognize(canvas);
      if (text.trim()) parts.push(text.trim());
    }
  } finally {
    await worker.terminate();
  }
  return parts.join("\n\n");
}

export type PdfExtractSource = "text_layer" | "ocr";

/**
 * Prefer fast text-layer extraction; if the PDF is image-only or nearly empty, fall back to OCR (slower).
 */
export async function extractPdfTextWithOcrFallback(
  file: File,
  onProgress?: (message: string) => void,
): Promise<{ text: string; source: PdfExtractSource }> {
  const raw = new Uint8Array(await file.arrayBuffer());
  let text = await extractPdfTextInBrowserFromData(raw.slice());
  if (looksLikeRawPdfPayload(text)) text = "";
  const meaningful = text.replace(/\s+/g, " ").trim().length;
  if (meaningful >= MIN_TEXT_LAYER_CHARS) {
    return { text: text.trim(), source: "text_layer" };
  }

  onProgress?.("Scanned or image-only PDF — running OCR (first time may download the OCR engine)…");
  const ocrText = await extractPdfTextViaOcrFromData(raw.slice(), onProgress);
  const o = ocrText.replace(/\s+/g, " ").trim();
  if (o.length < 40) {
    throw new Error(
      "OCR still found very little text. The PDF may be low resolution, encrypted, or mostly blank. Try DOCX or a clearer scan.",
    );
  }
  return { text: ocrText.trim(), source: "ocr" };
}
