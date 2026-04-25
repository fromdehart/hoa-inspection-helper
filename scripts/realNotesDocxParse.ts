/**
 * Parse Summer 2024 style HOA Word exports: first table, columns Address | Notes.
 * Used by import-real-notes-docx.ts and build-letter-bullet-fewshot.ts.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: false,
});

function paragraphToPlainText(p: unknown): string {
  const parts: string[] = [];
  function walk(node: unknown): void {
    if (node == null) return;
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if ("t" in o) {
      const t = o["t"];
      if (typeof t === "string") parts.push(t);
      else if (t && typeof t === "object" && "#text" in (t as object)) {
        parts.push(String((t as { "#text": string })["#text"]));
      } else if (Array.isArray(t)) {
        for (const x of t) walk(x);
      } else if (t && typeof t === "object") walk(t);
    } else {
      for (const v of Object.values(o)) walk(v);
    }
  }
  walk(p);
  return parts.join("");
}

function cellToParagraphTexts(tc: unknown): string[] {
  if (tc == null || typeof tc !== "object") return [];
  const cell = tc as { p?: unknown };
  const ps = cell.p;
  const plist = Array.isArray(ps) ? ps : ps != null ? [ps] : [];
  const out: string[] = [];
  for (const p of plist) {
    const line = paragraphToPlainText(p).replace(/\s+/g, " ").trim();
    if (line.length) out.push(line);
  }
  return out;
}

function tableRows(tbl: unknown): unknown[] {
  if (tbl == null || typeof tbl !== "object") return [];
  const t = tbl as { tr?: unknown };
  const tr = t.tr;
  return Array.isArray(tr) ? tr : tr != null ? [tr] : [];
}

function rowCells(tr: unknown): unknown[] {
  if (tr == null || typeof tr !== "object") return [];
  const row = tr as { tc?: unknown };
  const tc = row.tc;
  return Array.isArray(tc) ? tc : tc != null ? [tc] : [];
}

export type ParsedLetterRow = {
  addressCell: string;
  houseNumber: number;
  notesMarkdown: string;
};

export function parseHouseNumberFromAddress(addressCell: string): number | null {
  const m = addressCell.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function linesToMarkdownBullets(lines: string[]): string {
  const bullets: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    bullets.push(t.startsWith("- ") ? t : `- ${t}`);
  }
  return bullets.join("\n");
}

/**
 * Read .docx bytes and return rows from the first table (skips header row Address | Notes).
 */
export async function parseRealNotesDocx(buf: Buffer): Promise<ParsedLetterRow[]> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) return [];
  const xml = await file.async("string");
  const doc = xmlParser.parse(xml) as {
    document?: { body?: { tbl?: unknown; p?: unknown } };
  };
  const body = doc.document?.body;
  if (!body) return [];

  const tblRaw = body.tbl;
  const tables = Array.isArray(tblRaw) ? tblRaw : tblRaw != null ? [tblRaw] : [];
  if (tables.length === 0) return [];

  const rows = tableRows(tables[0]);
  const out: ParsedLetterRow[] = [];
  let first = true;
  for (const tr of rows) {
    const cells = rowCells(tr);
    if (cells.length < 2) continue;
    const addrLines = cellToParagraphTexts(cells[0]);
    const noteLines = cellToParagraphTexts(cells[1]);
    const addressCell = addrLines.join(" ").trim();
    if (!addressCell) continue;

    if (first) {
      first = false;
      if (addressCell.toLowerCase() === "address") continue;
    }

    const houseNumber = parseHouseNumberFromAddress(addressCell);
    if (houseNumber === null) continue;

    const notesMarkdown = linesToMarkdownBullets(noteLines);
    out.push({ addressCell, houseNumber, notesMarkdown });
  }
  return out;
}
