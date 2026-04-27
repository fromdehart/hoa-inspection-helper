import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: false,
});

/** Extract plain text from a .docx file (word/document.xml). */
export async function parseDocxText(buf: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) return "";
  const xml = await xmlFile.async("string");
  const parsed = xmlParser.parse(xml) as {
    document?: { body?: { p?: unknown } };
  };

  const pRaw = parsed.document?.body?.p;
  const paras = Array.isArray(pRaw) ? pRaw : pRaw != null ? [pRaw] : [];
  const lines: string[] = [];

  const collectRuns = (node: unknown, out: string[]): void => {
    if (node == null) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) collectRuns(n, out);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if ("t" in rec) collectRuns(rec.t, out);
    else for (const val of Object.values(rec)) collectRuns(val, out);
  };

  for (const p of paras) {
    const pObj = (p ?? {}) as { pPr?: { numPr?: unknown }; r?: unknown };
    const parts: string[] = [];
    collectRuns(pObj, parts);
    const text = parts.join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const isBullet = !!pObj.pPr?.numPr;
    lines.push(isBullet ? `- ${text}` : text);
  }
  return lines.join("\n");
}
