import { escapeHtml } from "./letterBody";

type TemplateDoc = {
  blocks: Array<{ idx: number; text: string; kind: "paragraph" | "bullet" }>;
  mapping: {
    date?: number;
    recipientName?: number;
    recipientStreet?: number;
    recipientCityStateZip?: number;
    maintenanceStart?: number;
    maintenanceEnd?: number;
  };
};

type MergeData = {
  date: string;
  recipientName: string;
  recipientStreet: string;
  recipientCityStateZip: string;
  maintenanceItems: string[];
};

export function mergeUploadedTemplateToHtml(doc: TemplateDoc, data: MergeData): string {
  const blocks = [...doc.blocks].sort((a, b) => a.idx - b.idx);
  const maintenanceStart = doc.mapping.maintenanceStart;
  const maintenanceEnd = doc.mapping.maintenanceEnd ?? maintenanceStart;

  const out: string[] = [];
  for (const b of blocks) {
    if (maintenanceStart != null && maintenanceEnd != null && b.idx >= maintenanceStart && b.idx <= maintenanceEnd) {
      if (b.idx === maintenanceStart) {
        out.push("<ul>");
        const items = data.maintenanceItems.length
          ? data.maintenanceItems
          : ["No exterior routine maintenance items were listed for this inspection."];
        for (const item of items) out.push(`<li>${escapeHtml(item)}</li>`);
        out.push("</ul>");
      }
      continue;
    }

    let text = b.text;
    if (doc.mapping.date === b.idx) text = data.date;
    if (doc.mapping.recipientName === b.idx) text = data.recipientName;
    if (doc.mapping.recipientStreet === b.idx) text = data.recipientStreet;
    if (doc.mapping.recipientCityStateZip === b.idx) text = data.recipientCityStateZip;

    if (!text.trim()) continue;
    if (b.kind === "bullet") {
      out.push(`<ul><li>${escapeHtml(text)}</li></ul>`);
    } else {
      out.push(`<p>${escapeHtml(text)}</p>`);
    }
  }
  return `<div style="font-family:'Times New Roman',serif; font-size:12pt; line-height:1.35; color:#000;">${out.join("\n")}</div>`;
}

export function mergeTokenTemplateTextToHtml(templateText: string, data: MergeData): string {
  const maintenanceItems = data.maintenanceItems.length
    ? data.maintenanceItems.map((x) => `- ${x}`).join("\n")
    : "- No exterior routine maintenance items were listed for this inspection.";

  const mergedText = templateText
    .replace(/\{\{date\}\}/g, data.date)
    .replace(/\{\{recipientName\}\}/g, data.recipientName)
    .replace(/\{\{recipientStreet\}\}/g, data.recipientStreet)
    .replace(/\{\{recipientCityStateZip\}\}/g, data.recipientCityStateZip)
    .replace(/\{\{maintenanceItems\}\}/g, maintenanceItems);

  const lines = mergedText.split(/\r?\n/);
  const out: string[] = [];
  let listOpen = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    if (bulletMatch) {
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${escapeHtml(bulletMatch[1].trim())}</li>`);
      continue;
    }
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
    if (!line.trim()) {
      out.push("<p>&nbsp;</p>");
      continue;
    }
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  if (listOpen) out.push("</ul>");
  return `<div style="font-family:'Times New Roman',serif; font-size:12pt; line-height:1.35; color:#000;">${out.join("\n")}</div>`;
}

