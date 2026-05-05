import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { useClerk } from "@clerk/clerk-react";
import { Menu } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import JSZip from "jszip";

type StatusFilter = "all" | "notStarted" | "inProgress" | "review" | "complete";
type LetterFilter = "all" | "needsGeneration" | "generated" | "sent";

function parseCSV(text: string): Array<{
  address: string;
  streetName: string;
  houseNumber: number;
  email?: string;
}> {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const addressIdx = headers.findIndex((h) => h === "address");
  const streetIdx = headers.findIndex((h) => h === "street");
  const houseIdx = headers.findIndex((h) => h === "housenumber");
  const emailIdx = headers.findIndex((h) => h === "email");

  if (addressIdx === -1 || streetIdx === -1 || houseIdx === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const address = cols[addressIdx];
    const streetName = cols[streetIdx];
    const houseNumber = parseInt(cols[houseIdx], 10);
    const email = emailIdx >= 0 ? cols[emailIdx] || undefined : undefined;
    if (address && streetName && !isNaN(houseNumber)) {
      rows.push({ address, streetName, houseNumber, email });
    }
  }
  return rows;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  notStarted: { label: "Not Started", color: "text-gray-600", bg: "bg-gray-100", emoji: "⏳" },
  inProgress: { label: "In Progress", color: "text-amber-700", bg: "bg-amber-100", emoji: "🔍" },
  review: { label: "Review", color: "text-violet-800", bg: "bg-violet-100", emoji: "👀" },
  complete: { label: "Complete", color: "text-green-700", bg: "bg-green-100", emoji: "✅" },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const viewer = useQuery(api.tenancy.viewerContext, {});
  const canInspect = viewer?.role === "inspector" || viewer?.role === "admin";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [letterFilter, setLetterFilter] = useState<LetterFilter>("all");
  const [search, setSearch] = useState("");
  const [csvUploading, setCsvUploading] = useState(false);
  const [photoExporting, setPhotoExporting] = useState(false);
  const [photoExportLog, setPhotoExportLog] = useState("");
  const [toast, setToast] = useState("");
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const properties = useQuery(api.properties.list, {
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const streets = useQuery(api.streets.list);
  const photoExportRows = useQuery(api.photos.listForZipExport);
  const importFromCSV = useMutation(api.properties.importFromCSV);

  const streetMap = new Map(streets?.map((s) => [s._id, s.name]) ?? []);

  const filtered = (properties ?? []).filter((p) => {
    const searchMatch = p.address.toLowerCase().includes(search.toLowerCase());
    const letterMatch =
      letterFilter === "all"
        ? true
        : letterFilter === "needsGeneration"
          ? (p.status === "complete" || p.status === "review") && !p.generatedLetterAt
          : letterFilter === "generated"
            ? !!p.generatedLetterAt && !p.letterSentAt
            : !!p.letterSentAt;
    return searchMatch && letterMatch;
  });

  const handleCSVChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploading(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setToast("No valid rows found in CSV");
        return;
      }
      const result = await importFromCSV({ rows });
      setToast(`🎉 ${result.created} properties imported, ${result.skipped} skipped`);
    } catch (err) {
      setToast("Import failed: " + String(err));
    } finally {
      setCsvUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => setToast(""), 4000);
    }
  };

  const sanitizeName = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "-").trim();
  const getExtFromPath = (s: string) => {
    const match = s.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    return match ? `.${match[1].toLowerCase()}` : ".jpg";
  };

  const handlePhotoExport = async () => {
    if (!photoExportRows?.length) {
      setToast("No inspector photos found to export");
      setTimeout(() => setToast(""), 4000);
      return;
    }

    setPhotoExporting(true);
    setPhotoExportLog("");
    const zip = new JSZip();
    const nameUse = new Map<string, number>();
    let added = 0;
    let skipped = 0;

    try {
      for (let i = 0; i < photoExportRows.length; i++) {
        const row = photoExportRows[i];
        const streetFolder = sanitizeName(row.streetName) || "Unknown Street";
        const houseFolder = sanitizeName(String(row.houseNumber)) || "unknown";
        setPhotoExportLog(
          `Adding ${i + 1}/${photoExportRows.length}: ${streetFolder}/${houseFolder}/ (${row.section})`,
        );
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

      setPhotoExportLog("Zipping…");
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `happier-block-street-photos-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setToast(`Photo export complete: ${added} added${skipped ? `, ${skipped} skipped` : ""}`);
      setTimeout(() => setToast(""), 5000);
      setPhotoExportLog(`Done. Added ${added}${skipped ? `, skipped ${skipped}` : ""}.`);
    } catch (err) {
      console.error(err);
      setToast("Photo export failed: " + String(err));
      setTimeout(() => setToast(""), 5000);
      setPhotoExportLog("Error during export.");
    } finally {
      setPhotoExporting(false);
    }
  };

  const tabs: { value: StatusFilter; label: string; emoji: string }[] = [
    { value: "all", label: "All", emoji: "🏘️" },
    { value: "notStarted", label: "Not Started", emoji: "⏳" },
    { value: "inProgress", label: "In Progress", emoji: "🔍" },
    { value: "review", label: "Review", emoji: "👀" },
    { value: "complete", label: "Complete", emoji: "✅" },
  ];
  const letterTabs: { value: LetterFilter; label: string; emoji: string }[] = [
    { value: "all", label: "All Letters", emoji: "📬" },
    { value: "needsGeneration", label: "Needs Generation", emoji: "📝" },
    { value: "generated", label: "Generated", emoji: "📄" },
    { value: "sent", label: "Sent", emoji: "✅" },
  ];

  const totalComplete = (properties ?? []).filter((p) => p.status === "complete").length;
  const totalAll = (properties ?? []).length;

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f7ff]">
      <div className="gradient-admin sticky top-0 z-50 shrink-0 border-b border-white/10 px-4 pt-10 pb-6 shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pr-1">
            <p className="text-purple-200 text-sm font-medium uppercase tracking-widest">Happier Block</p>
            <h1 className="text-white font-extrabold text-2xl">Admin dashboard 📋</h1>
          </div>
          <div className="relative z-[1] flex shrink-0 items-center gap-2">
            <Sheet open={adminMenuOpen} onOpenChange={setAdminMenuOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/35 bg-white/15 text-white hover:bg-white/25 transition-colors md:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" strokeWidth={2.25} />
                </button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="z-[100] w-[min(100vw-1rem,20rem)] border-l border-gray-200 bg-white sm:max-w-sm"
              >
                <SheetHeader>
                  <SheetTitle className="text-left text-gray-900">Menu</SheetTitle>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-2" aria-label="Dashboard actions">
                  <button
                    type="button"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100 transition-colors"
                    onClick={() => {
                      setAdminMenuOpen(false);
                      navigate("/admin/settings");
                    }}
                  >
                    ⚙️ Settings
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100 transition-colors"
                    onClick={() => {
                      setAdminMenuOpen(false);
                      navigate("/admin/members");
                    }}
                  >
                    👥 Team Members
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100 transition-colors"
                    onClick={() => {
                      setAdminMenuOpen(false);
                      navigate("/admin/letter-export");
                    }}
                  >
                    📄 Export PDFs
                  </button>
                  <button
                    type="button"
                    disabled={photoExporting || !photoExportRows}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-50"
                    onClick={() => {
                      setAdminMenuOpen(false);
                      void handlePhotoExport();
                    }}
                  >
                    {photoExporting ? "📸 Exporting Photos…" : "📸 Export Photos ZIP"}
                  </button>
                  {canInspect && (
                    <button
                      type="button"
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100 transition-colors"
                      onClick={() => {
                        setAdminMenuOpen(false);
                        navigate("/inspector/streets");
                      }}
                    >
                      🚶 Inspector Mode
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                    onClick={() => {
                      setAdminMenuOpen(false);
                      void signOut({ redirectUrl: "/" });
                    }}
                  >
                    Logout
                  </button>
                </nav>
              </SheetContent>
            </Sheet>
            <div className="hidden md:flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors"
                onClick={() => navigate("/admin/settings")}
              >
                ⚙️ Settings
              </button>
              <button
                type="button"
                className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors"
                onClick={() => navigate("/admin/letter-export")}
              >
                📄 Export PDFs
              </button>
              <button
                type="button"
                className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors"
                onClick={() => navigate("/admin/members")}
              >
                👥 Team Members
              </button>
              <button
                type="button"
                disabled={photoExporting || !photoExportRows}
                className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors disabled:opacity-50"
                onClick={() => void handlePhotoExport()}
              >
                {photoExporting ? "📸 Exporting Photos…" : "📸 Export Photos ZIP"}
              </button>
              {canInspect && (
                <button
                  type="button"
                  className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors"
                  onClick={() => navigate("/inspector/streets")}
                >
                  🚶 Inspector Mode
                </button>
              )}
              <button
                type="button"
                className="text-sm bg-white/10 hover:bg-white/20 text-white/70 px-3 py-1.5 rounded-full border border-white/20 transition-colors"
                onClick={() => void signOut({ redirectUrl: "/" })}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
        {totalAll > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-sm text-purple-200 mb-1.5">
              <span>Overall progress</span>
              <span>
                {totalComplete}/{totalAll} complete
              </span>
            </div>
            <div className="w-full bg-white/20 rounded-full h-2">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-yellow-400 to-lime-400 transition-all duration-500"
                style={{ width: `${totalAll > 0 ? (totalComplete / totalAll) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="relative z-0 max-w-5xl mx-auto w-full flex-1 px-4 py-5">
        {toast && (
          <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-xl border border-green-200 text-sm font-medium">
            {toast}
          </div>
        )}
        {photoExportLog && (
          <div className="mb-4 p-3 bg-white text-gray-700 rounded-xl border border-gray-200 text-xs font-mono whitespace-pre-wrap">
            {photoExportLog}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center mb-4">
          <div className="flex gap-1.5 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`btn-bounce px-3 py-1.5 text-sm rounded-full font-semibold transition-all ${
                  statusFilter === t.value
                    ? "bg-violet-600 text-white shadow-md"
                    : "bg-white text-gray-600 border border-gray-200 hover:border-violet-300"
                }`}
                onClick={() => setStatusFilter(t.value)}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-40">
            <input
              placeholder="🔍 Search address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-full border border-gray-200 bg-white focus:outline-none focus:border-violet-400 transition-colors"
            />
          </div>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVChange} />
          <button
            type="button"
            className="btn-bounce px-4 py-1.5 text-sm rounded-full bg-violet-600 text-white font-semibold shadow-sm hover:bg-violet-700 transition-colors disabled:opacity-50"
            disabled={csvUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {csvUploading ? "Importing..." : "📥 Import CSV"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-center mb-4">
          {letterTabs.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`btn-bounce px-3 py-1.5 text-sm rounded-full font-semibold transition-all ${
                letterFilter === t.value
                  ? "bg-sky-600 text-white shadow-md"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-sky-300"
              }`}
              onClick={() => setLetterFilter(t.value)}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                  Address
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden sm:table-cell">
                  Street
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide hidden md:table-cell">
                  Letter
                </th>
                <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="text-4xl mb-2">{properties === undefined ? "⏳" : "🏚️"}</div>
                    <p className="text-gray-400 font-medium">
                      {properties === undefined ? "Loading..." : "No properties found"}
                    </p>
                  </td>
                </tr>
              )}
              {filtered.map((p) => {
                const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.notStarted;
                return (
                  <tr
                    key={p._id}
                    className="hover:bg-violet-50/50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/admin/property/${p._id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-800">{p.address}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-gray-400 text-xs">
                      {streetMap.get(p.streetId) ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}
                      >
                        {cfg.emoji} {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {p.letterSentAt ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                          ✅ Sent
                        </span>
                      ) : p.generatedLetterAt ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-100 text-sky-700">
                          📄 Generated
                        </span>
                      ) : p.status === "complete" || p.status === "review" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          📝 Needs Generation
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                          — Not Ready
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="btn-bounce px-3 py-1.5 text-xs rounded-full bg-violet-100 text-violet-700 font-semibold hover:bg-violet-200 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/admin/property/${p._id}`);
                        }}
                      >
                        Review →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
