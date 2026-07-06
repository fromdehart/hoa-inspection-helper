import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { CaseDetail } from "@/components/cases/CaseDetail";
import {
  CASE_STATUS_CONFIG,
  CASE_TYPE_LABEL,
  stageLabel,
  type CaseStatus,
  type CaseType,
} from "@/lib/caseUi";

const CASE_TYPES: CaseType[] = [
  "violation",
  "architectural",
  "maintenance",
  "complaint",
  "inquiry",
  "other",
];

/** Cases card for a single property: list + open-case form + detail drawer. */
export function CaseList({ propertyId }: { propertyId: Id<"properties"> }) {
  const cases = useQuery(api.cases.listForProperty, { propertyId });
  const createCase = useMutation(api.cases.create);

  const [selectedCaseId, setSelectedCaseId] = useState<Id<"cases"> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [caseType, setCaseType] = useState<CaseType>("violation");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const caseId = await createCase({ propertyId, caseType, title: title.trim() });
      setTitle("");
      setShowForm(false);
      setSelectedCaseId(caseId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open case.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Cases</h2>
        <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "Open case"}
        </Button>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Case title (e.g. Fence staining needed)"
          />
          <div className="flex items-center gap-2">
            <Select value={caseType} onValueChange={(v) => setCaseType(v as CaseType)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CASE_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleCreate} disabled={creating || !title.trim()}>
              {creating ? "Opening…" : "Create"}
            </Button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      {cases === undefined ? (
        <p className="text-sm text-muted-foreground">Loading cases…</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No cases yet. Open one to start the tracked record for this household.
        </p>
      ) : (
        <ul className="divide-y">
          {cases.map((c) => (
            <li key={c._id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1"
                onClick={() => setSelectedCaseId(c._id)}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {CASE_TYPE_LABEL[c.caseType as CaseType]} · {stageLabel(c.stageKey)}
                    {c.actionDueAt && (
                      <span className={c.actionDueAt < Date.now() ? " text-red-600 font-medium" : ""}>
                        {" "}
                        · due {new Date(c.actionDueAt).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                </div>
                <StatusChip config={CASE_STATUS_CONFIG[c.status as CaseStatus]} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <CaseDetail
        caseId={selectedCaseId}
        open={selectedCaseId !== null}
        onOpenChange={(open) => !open && setSelectedCaseId(null)}
      />
    </div>
  );
}
