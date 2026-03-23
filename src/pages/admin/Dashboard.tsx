import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type StatusFilter = "all" | "notStarted" | "inProgress" | "complete";

// Simple CSV parser (handles basic comma-separated values)
// Note: does not handle commas within quoted fields — sufficient for HOA addresses
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

const STATUS_LABELS: Record<string, string> = {
  notStarted: "Not Started",
  inProgress: "In Progress",
  complete: "Complete",
};

const STATUS_VARIANTS: Record<string, "secondary" | "outline" | "default"> = {
  notStarted: "secondary",
  inProgress: "outline",
  complete: "default",
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
      setToast(`${result.created} properties imported, ${result.skipped} skipped`);
    } catch (err) {
      setToast("Import failed: " + String(err));
    } finally {
      setCsvUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTimeout(() => setToast(""), 4000);
    }
  };

  const tabs: StatusFilter[] = ["all", "notStarted", "inProgress", "complete"];

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h1 className="font-bold text-lg">HOA Inspection Helper</h1>
        <div className="flex gap-3 items-center">
          <button
            className="text-sm text-blue-600 hover:underline"
            onClick={() => navigate("/admin/settings")}
          >
            Settings
          </button>
          <button
            className="text-sm text-muted-foreground hover:underline"
            onClick={() => {
              localStorage.removeItem("hoa_admin");
              navigate("/");
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {toast && (
          <div className="mb-4 p-3 bg-green-100 text-green-800 rounded text-sm">{toast}</div>
        )}

        {/* Filter tabs + search + import */}
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <div className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  statusFilter === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-input hover:bg-accent"
                }`}
                onClick={() => setStatusFilter(t)}
              >
                {t === "all" ? "All" : STATUS_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-40">
            <Input
              placeholder="Search address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleCSVChange}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={csvUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {csvUploading ? "Importing..." : "Import CSV"}
          </Button>
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Address</th>
                <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Street</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    {properties === undefined ? "Loading..." : "No properties found"}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p._id} className="hover:bg-accent/50 cursor-pointer" onClick={() => navigate(`/admin/property/${p._id}`)}>
                  <td className="px-4 py-3">{p.address}</td>
                  <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                    {streetMap.get(p.streetId) ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANTS[p.status]}>
                      {STATUS_LABELS[p.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/admin/property/${p._id}`);
                      }}
                    >
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
