import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CASE_TYPE_LABEL, type CaseStatus, type CaseType } from "@/lib/caseUi";

type StageDraft = {
  key: string;
  label: string;
  statusRollup: CaseStatus;
  dueInDays?: number;
  requiresNotice?: boolean;
  requiresHearing?: boolean;
  requiresPhotoEvidence?: boolean;
  fineAmount?: number;
  noticeTemplateKey?: string;
};

const ROLLUPS: CaseStatus[] = ["open", "awaitingHomeowner", "resolved", "closed", "escalated"];

/**
 * Per-caseType escalation-ladder editor (Settings). Simple form over the
 * stages array — due-process steps vary by state/governing docs, so the
 * ladder is data, not code. Removing a stage that open cases sit in is
 * rejected server-side.
 */
export function WorkflowEditor() {
  const [caseType, setCaseType] = useState<CaseType>("violation");
  const workflow = useQuery(api.caseWorkflows.getForType, { caseType });
  const update = useMutation(api.caseWorkflows.update);

  const [stages, setStages] = useState<StageDraft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Reset drafts when the loaded workflow changes (type switch or remote edit).
  useEffect(() => {
    if (workflow) setStages(workflow.stages as StageDraft[]);
  }, [workflow?.caseType, workflow?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchStage = (idx: number, patch: Partial<StageDraft>) => {
    setStages((prev) => prev?.map((s, i) => (i === idx ? { ...s, ...patch } : s)) ?? prev);
  };

  const moveStage = (idx: number, dir: -1 | 1) => {
    setStages((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const removeStage = (idx: number) => {
    setStages((prev) => prev?.filter((_, i) => i !== idx) ?? prev);
  };

  const addStage = () => {
    setStages((prev) => [
      ...(prev ?? []),
      { key: `stage${(prev?.length ?? 0) + 1}`, label: "New stage", statusRollup: "open" },
    ]);
  };

  const handleSave = async () => {
    if (!stages || !workflow) return;
    setSaving(true);
    setMessage(null);
    try {
      await update({ caseType, name: workflow.name, stages });
      setMessage("Workflow saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save workflow.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={caseType} onValueChange={(v) => setCaseType(v as CaseType)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CASE_TYPE_LABEL) as CaseType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {CASE_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={addStage}>
          Add stage
        </Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || !stages}>
          {saving ? "Saving…" : "Save workflow"}
        </Button>
        {message && <span className="text-xs text-gray-600">{message}</span>}
      </div>

      {!stages ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ol className="space-y-2">
          {stages.map((stage, idx) => (
            <li key={idx} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-center text-xs font-bold text-gray-400">{idx + 1}</span>
                <Input
                  className="w-40 bg-white"
                  value={stage.label}
                  onChange={(e) => patchStage(idx, { label: e.target.value })}
                  placeholder="Stage label"
                />
                <Input
                  className="w-32 bg-white font-mono text-xs"
                  value={stage.key}
                  onChange={(e) => patchStage(idx, { key: e.target.value.replace(/\s/g, "") })}
                  placeholder="key"
                />
                <Select
                  value={stage.statusRollup}
                  onValueChange={(v) => patchStage(idx, { statusRollup: v as CaseStatus })}
                >
                  <SelectTrigger className="w-44 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLLUPS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  Window (days)
                  <Input
                    type="number"
                    className="w-16 bg-white"
                    value={stage.dueInDays ?? ""}
                    onChange={(e) =>
                      patchStage(idx, {
                        dueInDays: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  Fine $
                  <Input
                    type="number"
                    className="w-20 bg-white"
                    value={stage.fineAmount ?? ""}
                    onChange={(e) =>
                      patchStage(idx, {
                        fineAmount: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </label>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => moveStage(idx, -1)} disabled={idx === 0}>
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moveStage(idx, 1)}
                    disabled={idx === stages.length - 1}
                  >
                    ↓
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => removeStage(idx)}>
                    ✕
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-4 pl-8 text-xs text-gray-600">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!stage.requiresNotice}
                    onChange={(e) => patchStage(idx, { requiresNotice: e.target.checked || undefined })}
                  />
                  Requires notice sent
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!stage.requiresHearing}
                    onChange={(e) => patchStage(idx, { requiresHearing: e.target.checked || undefined })}
                  />
                  Requires hearing decision
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!stage.requiresPhotoEvidence}
                    onChange={(e) =>
                      patchStage(idx, { requiresPhotoEvidence: e.target.checked || undefined })
                    }
                  />
                  Requires photo evidence
                </label>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
