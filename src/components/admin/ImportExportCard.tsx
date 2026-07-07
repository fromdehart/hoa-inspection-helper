import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { downloadCsv, rowsToCsv } from "@/lib/csvExport";

const CSV_EXPORT_HEADERS = [
  "propertyId",
  "street",
  "houseNumber",
  "address",
  "homeownerNames",
  "email",
  "status",
  "letterSentAt",
  "generatedLetterAt",
  "inspectionDetailsVerifiedAt",
  "inspectionNotesEnteredAt",
  "inspectionNotesLastUpdatedAt",
  "inspectorNotesFront",
  "inspectorNotesSide",
  "inspectorNotesBack",
  "inspectorNotes",
  "aiLetterBullets",
  "previousCitations2024",
  "previousFrontObs",
  "previousBackObs",
  "previousInspectorComments",
  "previousInspectionSummary",
  "priorOwnerLetterNotes2024",
  "priorCompletedWorkResponse",
  "photoCountFront",
  "photoCountSide",
  "photoCountBack",
  "photoCountTotal",
  "fixPhotoCount",
  "fixPhotoPendingCount",
] as const;

function parseCSV(text: string): Array<{
  address: string;
  streetName: string;
  houseNumber: number;
  email?: string;
  homeownerNames?: string;
}> {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const addressIdx = headers.findIndex((h) => h === "address");
  const streetIdx = headers.findIndex((h) => h === "street");
  const houseIdx = headers.findIndex((h) => h === "housenumber");
  const emailIdx = headers.findIndex((h) => h === "email");
  const homeownerIdx = headers.findIndex(
    (h) => h === "homeownernames" || h === "homeowner" || h === "owner",
  );

  if (addressIdx === -1 || streetIdx === -1 || houseIdx === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const address = cols[addressIdx];
    const streetName = cols[streetIdx];
    const houseNumber = parseInt(cols[houseIdx], 10);
    const email = emailIdx >= 0 ? cols[emailIdx] || undefined : undefined;
    const homeownerNames = homeownerIdx >= 0 ? cols[homeownerIdx] || undefined : undefined;
    if (address && streetName && !isNaN(houseNumber)) {
      rows.push({ address, streetName, houseNumber, email, homeownerNames });
    }
  }
  return rows;
}

const sanitizeName = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "-").trim();
const getExtFromPath = (s: string) => {
  const match = s.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? `.${match[1].toLowerCase()}` : ".jpg";
};

/**
 * Bulk utilities, moved off the old dashboard: import addresses CSV, export
 * the full data CSV, export all inspector photos as a ZIP. Utilities, not the
 * job — they live in Settings now.
 */
export function ImportExportCard({ hoaSlug }: { hoaSlug: string | undefined }) {
  const photoExportRows = useQuery(api.photos.listForZipExport);
  const csvExportRows = useQuery(api.properties.listForCsvExport);
  const importFromCSV = useMutation(api.properties.importFromCSV);

  const [csvUploading, setCsvUploading] = useState(false);
  const [photoExporting, setPhotoExporting] = useState(false);
  const [dataExporting, setDataExporting] = useState(false);
  const [log, setLog] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setLog(msg);
    setTimeout(() => setLog((cur) => (cur === msg ? "" : cur)), 6000);
  };

  const handleCSVChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploading(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        flash("No valid rows found in CSV (needs address, street, houseNumber columns)");
        return;
      }
      const result = await importFromCSV({ rows });
      flash(`${result.created} properties imported, ${result.skipped} skipped`);
    } catch (err) {
      flash("Import failed: " + String(err));
    } finally {
      setCsvUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDataExport = () => {
    if (!csvExportRows?.length) {
      flash("No property data found to export");
      return;
    }
    setDataExporting(true);
    try {
      const csvText = rowsToCsv([...CSV_EXPORT_HEADERS], csvExportRows);
      const slug = hoaSlug?.trim() || "community";
      const date = new Date().toISOString().slice(0, 10);
      downloadCsv(`${slug}-inspection-export-${date}.csv`, csvText);
      flash(`Exported ${csvExportRows.length} properties to CSV`);
    } catch (err) {
      console.error(err);
      flash("Data export failed: " + String(err));
    } finally {
      setDataExporting(false);
    }
  };

  const handlePhotoExport = async () => {
    if (!photoExportRows?.length) {
      flash("No inspector photos found to export");
      return;
    }
    setPhotoExporting(true);
    const zip = new JSZip();
    const nameUse = new Map<string, number>();
    let added = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < photoExportRows.length; i++) {
        const row = photoExportRows[i];
        const streetFolder = sanitizeName(row.streetName) || "Unknown Street";
        const houseFolder = sanitizeName(String(row.houseNumber)) || "unknown";
        setLog(`Adding ${i + 1}/${photoExportRows.length}: ${streetFolder}/${houseFolder}/ (${row.section})`);
        try {
          const res = await fetch(row.publicUrl);
          if (!res.ok) {
            skipped++;
            continue;
          }
          const blob = await res.blob();
          const base = sanitizeName(`${row.houseNumber} ${row.streetName}`) || `${row.houseNumber}`;
          const ext = getExtFromPath(row.filePath || row.publicUrl);
          const key = `${streetFolder}/${houseFolder}/${base}`;
          const count = (nameUse.get(key) ?? 0) + 1;
          nameUse.set(key, count);
          const filename = count === 1 ? `${base}${ext}` : `${base} (${count})${ext}`;
          zip.file(`${streetFolder}/${houseFolder}/${filename}`, blob);
          added++;
        } catch {
          skipped++;
        }
      }
      setLog("Zipping…");
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `happier-block-street-photos-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      flash(`Photo export complete: ${added} added${skipped ? `, ${skipped} skipped` : ""}`);
    } catch (err) {
      console.error(err);
      flash("Photo export failed: " + String(err));
    } finally {
      setPhotoExporting(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="text-[13px] font-bold">Import / export</h2>
      <p className="mt-0.5 text-xs text-ink-2">
        Bulk utilities. Import expects CSV columns: address, street, houseNumber (email and
        homeownerNames optional).
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={csvUploading} asChild>
          <label className="cursor-pointer">
            {csvUploading ? "Importing…" : "Import addresses CSV"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCSVChange}
            />
          </label>
        </Button>
        <Button size="sm" variant="outline" disabled={dataExporting} onClick={handleDataExport}>
          {dataExporting ? "Exporting…" : "Export data CSV"}
        </Button>
        <Button size="sm" variant="outline" disabled={photoExporting} onClick={() => void handlePhotoExport()}>
          {photoExporting ? "Exporting…" : "Export photos ZIP"}
        </Button>
      </div>
      {log && <p className="mt-2 text-xs text-ink-2">{log}</p>}
    </section>
  );
}
