import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chip } from "@/components/ui/chip";
import { DueDate } from "@/components/ui/due-date";
import {
  CASE_STATUS_CHIP,
  CASE_TYPE_LABEL,
  stageDisplay,
  type CaseStatus,
  type CaseType,
} from "@/lib/caseUi";
import { ArcApplicationsSection, VERDICT_LABEL } from "./ArcApplicationsSection";

const CASE_TYPES: CaseType[] = [
  "violation",
  "architectural",
  "maintenance",
  "complaint",
  "inquiry",
  "other",
];

/**
 * Current & past matters for this household. Case rows open the case page;
 * ARC submissions appear as request rows opening the existing ARC flow.
 */
export function CasesCard({
  propertyId,
  casesEnabled,
  arcEnabled,
  showForm,
  onFormClosed,
  showToast,
}: {
  propertyId: Id<"properties">;
  casesEnabled: boolean;
  arcEnabled: boolean;
  /** The header's "+ New case" button drives this. */
  showForm: boolean;
  onFormClosed: () => void;
  showToast: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const cases = useQuery(api.cases.listForProperty, casesEnabled ? { propertyId } : "skip");
  const arcSubmissions = useQuery(
    api.arcApplications.listByProperty,
    arcEnabled ? { propertyId } : "skip",
  );
  const createCase = useMutation(api.cases.create);

  const [arcOpen, setArcOpen] = useState(false);
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
      onFormClosed();
      navigate(`/admin/property/${propertyId}/case/${caseId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open case.");
    } finally {
      setCreating(false);
    }
  };

  const caseRows = cases ?? [];
  const arcRows = arcSubmissions ?? [];
  const empty = caseRows.length === 0 && arcRows.length === 0;

  return (
    <div className="rounded-xl border bg-white">
      <div className="flex items-baseline gap-2.5 border-b px-4 py-3">
        <h2 className="text-[13px] font-bold">{casesEnabled ? "Cases" : "Requests"}</h2>
        <span className="text-xs text-ink-2">
          {casesEnabled
            ? "current & past matters for this household"
            : "architectural requests for this household"}
        </span>
      </div>

      {showForm && casesEnabled && (
        <div className="space-y-2 border-b bg-paper px-4 py-3">
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
            <Button size="sm" variant="ghost" onClick={onFormClosed}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}

      <div className="px-4 py-1">
        {casesEnabled && cases === undefined ? (
          <p className="py-2.5 text-sm text-ink-2">Loading cases…</p>
        ) : empty ? (
          <p className="py-2.5 text-sm text-ink-2">
            Nothing on file — quiet household.
          </p>
        ) : (
          <>
            {caseRows.map((c) => {
              const closed = c.status === "resolved" || c.status === "closed";
              return (
                <div
                  key={c._id}
                  className="flex cursor-pointer items-center gap-3 border-b border-border/60 py-2.5 last:border-0 hover:bg-paper"
                  onClick={() => navigate(`/admin/property/${propertyId}/case/${c._id}`)}
                >
                  <Chip tone={CASE_STATUS_CHIP[c.status as CaseStatus].tone}>{c.title}</Chip>
                  <span className="text-xs text-ink-2">{stageDisplay(c.stageKey)}</span>
                  <span className="ml-auto">
                    <DueDate at={c.actionDueAt ?? (closed ? c.closedAt : undefined)} closed={closed} />
                  </span>
                  <span className="text-xs font-semibold text-petrol">open ›</span>
                </div>
              );
            })}
            {arcRows.map((sub) => (
              <div
                key={sub._id}
                className="flex cursor-pointer items-center gap-3 border-b border-border/60 py-2.5 last:border-0 hover:bg-paper"
                onClick={() => setArcOpen(true)}
              >
                <Chip tone="open">ARC application</Chip>
                <span className="text-xs text-ink-2">
                  {sub.verdict ? VERDICT_LABEL[sub.verdict] : sub.status}
                </span>
                <span className="ml-auto text-xs text-ink-2">
                  {new Date(sub.createdAt).toLocaleDateString()}
                </span>
                <span className="text-xs font-semibold text-petrol">open ›</span>
              </div>
            ))}
          </>
        )}
        {arcEnabled && arcRows.length === 0 && (
          <button
            type="button"
            className="w-full border-t border-border/60 py-2 text-left text-xs font-semibold text-petrol hover:underline"
            onClick={() => setArcOpen(true)}
          >
            + New ARC submission
          </button>
        )}
      </div>

      {arcEnabled && (
        <Dialog open={arcOpen} onOpenChange={setArcOpen}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>ARC applications</DialogTitle>
            </DialogHeader>
            <ArcApplicationsSection propertyId={propertyId} showToast={showToast} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
