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

/** Placeholder survives DOMParser/`innerText` so `<br>` can be distinguished from DOCX soft wraps. */
const BR_PLACEHOLDER = "\uFFF0_LINE_BR_\uFFF1";

/** Sentinel for breaks that must not be flattened (replaced last). */
const HARD_BREAK_SENTINEL = "\uFFF2";

function maskBrTags(htmlFrag: string): string {
  return htmlFrag.replace(/<br\b[^>]*\/?>/gi, BR_PLACEHOLDER);
}

/**
 * `textContent` keeps literal newlines from DOCX inside one `<p>`; jsPDF treats every `\n`
 * as a hard break (ragged short lines). That is mostly an exporter issue, not the letter
 * template. We mask `<br>`, take `innerText`, flatten orphan single `\n`s, then restore
 * `<br>` line breaks — plus light comma spacing cleanup common in pasted addresses.
 */
function htmlToPlainText(html: string): string {
  const normalized = normalizeLetterHtmlForRender(html);
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(maskBrTags(normalized), "text/html");
    const body = doc.body;
    if (!body) return normalized.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    let raw = (typeof body.innerText === "string" ? body.innerText : body.textContent) ?? "";
    raw = raw.replace(/\r/g, "").replace(/\u00a0/g, " ");
    raw = raw.replaceAll(BR_PLACEHOLDER, HARD_BREAK_SENTINEL);
    raw = raw.replace(/[ \t]+\n/g, "\n");
    raw = raw.replace(/\n{3,}/g, "\n\n");
    // Flatten DOCX-style soft wraps; keep `\n\n` paragraph gaps (prev char must not be `\n`).
    raw = raw.replace(/([^\n\uFFF2])\n(?!\n)/g, "$1 ");
    raw = raw.replace(/\s+,/g, ", ");
    raw = raw.replace(/,\s+/g, ", ");
    raw = raw.replaceAll(HARD_BREAK_SENTINEL, "\n");
    raw = raw.replace(/[ \t]{2,}/g, " ");
    return raw.trim();
  } catch {
    return normalized.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function renderLetterAsPlainText(pdf: jsPDF, html: string): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const lineHeight = 16;
  const text = htmlToPlainText(html) || "No letter content.";

  pdf.setFont("times", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(0, 0, 0);

  const lines = pdf.splitTextToSize(text, maxW) as string[];
  let y = margin + 12;
  for (let i = 0; i < lines.length; i++) {
    if (y > margin + maxH - lineHeight) {
      pdf.addPage();
      y = margin + 12;
      pdf.setFont("times", "normal");
      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);
    }
    pdf.text(lines[i], margin, y);
    y += lineHeight;
  }
}

async function imageUrlToDataUrl(url: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Image load failed: ${url}`));
  });
  img.src = url;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context for photo.");
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
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
        const dataUrl = await imageUrlToDataUrl(photo.url);
        const img = new Image();
        const loaded = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`Image decode failed: ${photo.url}`));
        });
        img.src = dataUrl;
        await loaded;
        const frame = fitIntoBox(img.naturalWidth, img.naturalHeight, cellX, cellY, cellW, cellH);
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
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  renderLetterAsPlainText(pdf, html);
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
  const [regenerateExisting, setRegenerateExisting] = useState(false);
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
    const zip = new JSZip();
    try {
      await persistAllDrafts();

      let pdfCount = 0;
      for (let i = 0; i < exportTargets.length; i++) {
        const row = exportTargets[i];
        const html = row.generatedLetterHtml?.trim();
        if (!html) continue;

        setLog(`Rendering ${i + 1} / ${exportTargets.length}: ${row.address} (letter + photos)`);
        const { blob, rendered, skipped } = await letterHtmlToPdfBlob(row, html);
        zip.file(`${sanitizeFilename(row.address)}.pdf`, blob);
        pdfCount++;
        if (skipped > 0) {
          setLog(
            `Rendering ${i + 1} / ${exportTargets.length}: ${row.address} (photos: ${rendered} added, ${skipped} skipped)`,
          );
        }
      }

      if (pdfCount === 0) {
        setLog("No letters to export.");
        return;
      }

      setLog("Zipping...");
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `happier-block-letters-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setLog(`Done (${pdfCount} PDFs). Reviewed ${reviewedCount}/${reviewRows.length}.`);
    } catch (e) {
      console.error(e);
      setLog("Error: " + String(e));
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <div className="border-b bg-white px-4 pb-4 pt-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <div>
            <button
              type="button"
              className="text-xs font-semibold text-petrol hover:underline"
              onClick={() => navigate("/admin/walkthrough")}
            >
              ‹ Walkthrough
            </button>
            <h1 className="text-lg font-bold">Letter review &amp; export</h1>
            <p className="mt-0.5 text-sm text-ink-2">
              Review bullets, generate letters, then export PDFs.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-paper"
            onClick={() => void signOut({ redirectUrl: "/" })}
          >
            Logout
          </button>
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
            <Button
              disabled={busy || exportTargets.length === 0}
              onClick={() => void exportZip()}
              className="btn-bounce w-full h-12 text-base font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl shadow-lg"
            >
              {exportBusy ? "Exporting..." : "Download ZIP of PDFs"}
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
