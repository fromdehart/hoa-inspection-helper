import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import { parseDocxText } from "./lib/parseDocxText";

type Block = { idx: number; text: string; kind: "paragraph" | "bullet" };

function toBlocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBullet = /^[-*•]\s+/.test(line);
    out.push({
      idx: i,
      text: line.replace(/^[-*•]\s+/, "").trim(),
      kind: isBullet ? "bullet" : "paragraph",
    });
  }
  return out;
}

function parsePdfTextFallback(buf: Uint8Array): string {
  // Fallback text extraction without native/pdfjs dependencies.
  const decoded = new TextDecoder("latin1").decode(buf);
  const maybe = decoded
    .replace(/[^\x20-\x7E\n]/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
  return maybe.join("\n");
}

function looksLikeRawPdfPayload(text: string): boolean {
  const sample = text.slice(0, 2000);
  if (sample.includes("%PDF-")) return true;
  const objHits = (sample.match(/\bendobj\b/g) ?? []).length;
  return objHits >= 2 && /\bstream\b/.test(sample);
}

function detectMappings(blocks: Block[]) {
  const findBy = (re: RegExp) => blocks.find((b) => re.test(b.text))?.idx;
  const dateIdx = findBy(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  const cityStateZipIdx = findBy(/,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/);
  const dearIdx = findBy(/^Dear\b/i);
  const maintenanceLeadIdx = findBy(/These may include any of the following:?$/i);
  const maintenanceStart = maintenanceLeadIdx != null ? maintenanceLeadIdx + 1 : undefined;

  let maintenanceEnd: number | undefined;
  if (maintenanceStart != null) {
    const after = blocks.slice(maintenanceStart);
    const stop = after.find((b) =>
      /We understand that seasonal weather conditions/i.test(b.text) ||
      /Thank you for your attention to these routine items/i.test(b.text)
    );
    maintenanceEnd = stop ? stop.idx - 1 : undefined;
  }

  const recipientName = dateIdx != null ? dateIdx + 2 : undefined;
  const recipientStreet = recipientName != null ? recipientName + 1 : undefined;
  const recipientCityStateZip = cityStateZipIdx;

  const confidence = (val: number | undefined, score = 0.9) =>
    val == null || val < 0 || val >= blocks.length ? undefined : { blockIdx: val, confidence: score };

  return {
    date: confidence(dateIdx, 0.95),
    recipientName: confidence(recipientName, dearIdx != null ? 0.7 : 0.55),
    recipientStreet: confidence(recipientStreet, dearIdx != null ? 0.7 : 0.55),
    recipientCityStateZip: confidence(recipientCityStateZip, 0.9),
    maintenanceStart: confidence(maintenanceStart, 0.9),
    maintenanceEnd: confidence(maintenanceEnd, maintenanceEnd != null ? 0.85 : 0.5),
  };
}

export const ingestUploadedTemplate = action({
  args: {
    fileName: v.string(),
    fileType: v.union(v.literal("docx"), v.literal("pdf")),
    sourcePublicUrl: v.optional(v.string()),
    sourceFilePath: v.string(),
    fileBase64: v.optional(v.string()),
    parsedTextOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let buf: Uint8Array;
    if (args.fileBase64?.trim()) {
      const bin = atob(args.fileBase64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      buf = arr;
    } else {
      if (!args.sourcePublicUrl) {
        throw new Error("sourcePublicUrl or fileBase64 is required");
      }
      const res = await fetch(args.sourcePublicUrl);
      if (!res.ok) throw new Error(`Template fetch failed: ${res.status}`);
      const arr = await res.arrayBuffer();
      buf = new Uint8Array(arr);
    }

    let parsedText = args.parsedTextOverride?.trim() ?? "";
    if (!parsedText && args.fileType === "docx") {
      parsedText = await parseDocxText(buf);
    } else if (!parsedText) {
      // Avoid storing raw PDF bytes as template content.
      parsedText = parsePdfTextFallback(buf);
      if (!parsedText.trim() || looksLikeRawPdfPayload(parsedText)) {
        throw new Error(
          "Unable to extract readable text from PDF. Please re-upload as DOCX or provide browser-extracted PDF text."
        );
      }
    } else if (args.fileType === "pdf" && looksLikeRawPdfPayload(parsedText)) {
      throw new Error(
        "Uploaded PDF text appears to be raw file bytes, not readable content. Please try a DOCX template."
      );
    }
    const blocks = toBlocks(parsedText);
    const detection = detectMappings(blocks);
    const mapping = {
      date: detection.date?.blockIdx,
      recipientName: detection.recipientName?.blockIdx,
      recipientStreet: detection.recipientStreet?.blockIdx,
      recipientCityStateZip: detection.recipientCityStateZip?.blockIdx,
      maintenanceStart: detection.maintenanceStart?.blockIdx,
      maintenanceEnd: detection.maintenanceEnd?.blockIdx,
    };
    const id = await ctx.runMutation(api.letterTemplateDocs.createDraft, {
      fileName: args.fileName,
      fileType: args.fileType,
      sourcePublicUrl: args.sourcePublicUrl ?? "",
      sourceFilePath: args.sourceFilePath,
      parsedText,
      templateText: parsedText,
      blocks,
      detection,
      mapping,
    });
    return { id };
  },
});

