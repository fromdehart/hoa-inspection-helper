import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { StatusChip } from "@/components/ui/status-chip";
import { CaseDetail } from "@/components/cases/CaseDetail";
import { QuarantineStrip } from "@/components/cases/QuarantineStrip";
import {
  CASE_STATUS_CONFIG,
  CASE_TYPE_LABEL,
  stageLabel,
  type CaseStatus,
  type CaseType,
} from "@/lib/caseUi";

type StatusFilter = "all" | "overdue" | CaseStatus;

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "awaitingHomeowner", label: "Awaiting homeowner" },
  { key: "escalated", label: "Escalated" },
  { key: "overdue", label: "Overdue" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
];

export default function CaseQueue() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<CaseType | "all">("all");
  const [selectedCaseId, setSelectedCaseId] = useState<Id<"cases"> | null>(null);

  const cases = useQuery(api.cases.listForHoa, {
    status:
      statusFilter === "all" || statusFilter === "overdue" ? undefined : statusFilter,
    caseType: typeFilter === "all" ? undefined : typeFilter,
  });

  const upcomingHearings = useQuery(api.hearings.listUpcoming, { withinDays: 7 });

  const rows = useMemo(() => {
    if (!cases) return undefined;
    if (statusFilter !== "overdue") return cases;
    const now = Date.now();
    return cases.filter(
      (c) =>
        c.actionDueAt !== undefined &&
        c.actionDueAt < now &&
        (c.status === "open" || c.status === "awaitingHomeowner" || c.status === "escalated"),
    );
  }, [cases, statusFilter]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="gradient-admin sticky top-0 z-10 px-4 py-4 shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <button
            type="button"
            className="text-sm font-semibold text-white/90 hover:text-white"
            onClick={() => navigate("/admin/dashboard")}
          >
            ← Dashboard
          </button>
          <h1 className="text-sm font-extrabold text-white">Case Queue</h1>
          <div className="w-24" />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        <QuarantineStrip />

        {upcomingHearings && upcomingHearings.length > 0 && (
          <section className="rounded-xl border border-violet-200 bg-violet-50 p-3">
            <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-violet-800">
              🗓️ Hearings this week
            </h2>
            <ul className="space-y-1">
              {upcomingHearings.map((h) => (
                <li key={h._id} className="flex flex-wrap items-center gap-x-2 text-sm text-violet-900">
                  <button
                    type="button"
                    className="font-semibold underline-offset-2 hover:underline"
                    onClick={() => setSelectedCaseId(h.caseId)}
                  >
                    {h.caseTitle || "Case"}
                  </button>
                  <span className="text-violet-700">
                    {h.address} ·{" "}
                    {new Date(h.scheduledFor).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {h.location ? ` · ${h.location}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === tab.key
                  ? "bg-violet-600 text-white"
                  : "bg-white text-slate-600 border hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as CaseType | "all")}
            className="ml-auto rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
          >
            <option value="all">All types</option>
            {(Object.keys(CASE_TYPE_LABEL) as CaseType[]).map((t) => (
              <option key={t} value={t}>
                {CASE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </section>

        <section className="overflow-x-auto rounded-xl border bg-white">
          {rows === undefined ? (
            <p className="p-4 text-sm text-muted-foreground">Loading cases…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No cases match this filter.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">Case</th>
                  <th className="px-3 py-2.5">Property</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Stage</th>
                  <th className="px-3 py-2.5">Due</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const overdue =
                    c.actionDueAt !== undefined &&
                    c.actionDueAt < Date.now() &&
                    c.status !== "resolved" &&
                    c.status !== "closed";
                  return (
                    <tr
                      key={c._id}
                      className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                      onClick={() => setSelectedCaseId(c._id)}
                    >
                      <td className="px-3 py-2.5 font-medium">{c.title}</td>
                      <td className="px-3 py-2.5 text-slate-600">{c.address}</td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {CASE_TYPE_LABEL[c.caseType as CaseType]}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{stageLabel(c.stageKey)}</td>
                      <td className={`px-3 py-2.5 ${overdue ? "font-semibold text-red-600" : "text-slate-600"}`}>
                        {c.actionDueAt ? new Date(c.actionDueAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip config={CASE_STATUS_CONFIG[c.status as CaseStatus]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <CaseDetail
        caseId={selectedCaseId}
        open={selectedCaseId !== null}
        onOpenChange={(open) => !open && setSelectedCaseId(null)}
      />
    </div>
  );
}
