import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

type StatusFilter = "all" | "notStarted" | "inProgress" | "complete";

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
  complete: { label: "Complete", color: "text-green-700", bg: "bg-green-100", emoji: "✅" },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [csvUploading, setCsvUploading] = useState(false);
  const [toast, setToast] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (localStorage.getItem("hoa_admin") !== "true") {
      navigate("/admin");
    }
  }, [navigate]);

  const properties = useQuery(api.properties.list, {
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const streets = useQuery(api.streets.list);
  const importFromCSV = useMutation(api.properties.importFromCSV);

  const streetMap = new Map(streets?.map((s) => [s._id, s.name]) ?? []);

  const filtered = (properties ?? []).filter((p) =>
    p.address.toLowerCase().includes(search.toLowerCase()),
  );

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

  const tabs: { value: StatusFilter; label: string; emoji: string }[] = [
    { value: "all", label: "All", emoji: "🏘️" },
    { value: "notStarted", label: "Not Started", emoji: "⏳" },
    { value: "inProgress", label: "In Progress", emoji: "🔍" },
    { value: "complete", label: "Complete", emoji: "✅" },
  ];

  const totalComplete = (properties ?? []).filter((p) => p.status === "complete").length;
  const totalAll = (properties ?? []).length;

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-admin px-4 pt-10 pb-6">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-purple-200 text-sm font-medium uppercase tracking-widest">Admin</p>
            <h1 className="text-white font-extrabold text-2xl">HOA Dashboard 📋</h1>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
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
              className="text-sm bg-white/10 hover:bg-white/20 text-white/70 px-3 py-1.5 rounded-full border border-white/20 transition-colors"
              onClick={() => {
                localStorage.removeItem("hoa_admin");
                navigate("/");
              }}
            >
              Logout
            </button>
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

      <div className="max-w-5xl mx-auto px-4 py-5">
        {toast && (
          <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-xl border border-green-200 text-sm font-medium">
            {toast}
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
                <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
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
