import { useMemo, useState } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { UserButton } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CASE_EVENT_CONFIG,
  CASE_STATUS_CONFIG,
  CASE_TYPE_LABEL,
  formatEventTime,
  stageLabel,
  type CaseEventType,
  type CaseStatus,
  type CaseType,
} from "@/lib/caseUi";

type StatusFilter = "all" | "open" | "awaitingHomeowner" | "escalated" | "resolved" | "closed";

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "awaitingHomeowner", label: "Awaiting homeowner" },
  { key: "escalated", label: "Escalated" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
];

const PAGE_SIZE = 20;

/** Board timeline: server already filters to shared-visibility events. */
function BoardTimeline({ caseId }: { caseId: Id<"cases"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.cases.getTimeline,
    { caseId },
    { initialNumItems: PAGE_SIZE },
  );

  if (status === "LoadingFirstPage") {
    return <p className="text-sm text-muted-foreground">Loading timeline…</p>;
  }

  const items: TimelineItem[] = results.map((event) => {
    const config = CASE_EVENT_CONFIG[event.type as CaseEventType] ?? {
      label: event.type,
      emoji: "•",
    };
    const title =
      event.type === "stageChanged" && event.fromStageKey && event.toStageKey
        ? `${stageLabel(event.fromStageKey)} → ${stageLabel(event.toStageKey)}`
        : config.label;
    return {
      key: event._id,
      icon: <span aria-hidden>{config.emoji}</span>,
      title,
      timestamp: formatEventTime(event.createdAt),
      body: event.summary !== title ? event.summary : undefined,
    };
  });

  return (
    <div className="space-y-3">
      <Timeline items={items} />
      {status === "CanLoadMore" && (
        <button
          type="button"
          className="text-xs font-semibold text-violet-700"
          onClick={() => loadMore(PAGE_SIZE)}
        >
          Load older activity
        </button>
      )}
    </div>
  );
}

/** Read-only board oversight: case queue + shared timeline. No action controls render, and the server rejects board writes anyway. */
export default function BoardCases() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedCaseId, setSelectedCaseId] = useState<Id<"cases"> | null>(null);

  const cases = useQuery(api.cases.listForHoa, {
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const upcomingHearings = useQuery(api.hearings.listUpcoming, { withinDays: 14 });
  const selectedCase = useQuery(
    api.cases.get,
    selectedCaseId ? { caseId: selectedCaseId } : "skip",
  );
  const hearings = useQuery(
    api.hearings.listForCase,
    selectedCaseId ? { caseId: selectedCaseId } : "skip",
  );
  const fines = useQuery(
    api.fines.listForCase,
    selectedCaseId ? { caseId: selectedCaseId } : "skip",
  );

  const rows = useMemo(() => cases ?? undefined, [cases]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="gradient-admin sticky top-0 z-10 px-4 py-4 shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <h1 className="text-sm font-extrabold text-white">🏛️ Board — Case Oversight</h1>
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <p className="text-xs text-slate-500">
          Read-only view. Every entry below is part of the permanent case record.
        </p>

        {upcomingHearings && upcomingHearings.length > 0 && (
          <section className="rounded-xl border border-violet-200 bg-violet-50 p-3">
            <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-violet-800">
              🗓️ Upcoming hearings
            </h2>
            <ul className="space-y-1">
              {upcomingHearings.map((h) => (
                <li key={h._id} className="text-sm text-violet-900">
                  <span className="font-semibold">{h.caseTitle || "Case"}</span>{" "}
                  <span className="text-violet-700">
                    {h.address} ·{" "}
                    {new Date(h.scheduledFor).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-wrap gap-2">
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
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
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
                    <td className="px-3 py-2.5">
                      <StatusChip config={CASE_STATUS_CONFIG[c.status as CaseStatus]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <Sheet open={selectedCaseId !== null} onOpenChange={(o) => !o && setSelectedCaseId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {!selectedCase ? (
            <p className="mt-8 text-sm text-muted-foreground">Loading case…</p>
          ) : (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>{selectedCase.title}</SheetTitle>
                <SheetDescription asChild>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <StatusChip config={CASE_STATUS_CONFIG[selectedCase.status as CaseStatus]} />
                    <span className="text-xs text-muted-foreground">
                      {CASE_TYPE_LABEL[selectedCase.caseType as CaseType]} · Stage:{" "}
                      {stageLabel(selectedCase.stageKey)}
                    </span>
                  </div>
                </SheetDescription>
              </SheetHeader>

              {(hearings ?? []).length > 0 && (
                <div className="mt-4 rounded-xl border bg-white p-3">
                  <h3 className="mb-2 text-sm font-semibold">Hearings</h3>
                  <ul className="space-y-1.5 text-sm">
                    {(hearings ?? []).map((h) => (
                      <li key={h._id}>
                        <span className="font-medium">
                          {new Date(h.scheduledFor).toLocaleDateString()}
                        </span>
                        {h.outcome && (
                          <span className="capitalize text-slate-600"> · {h.outcome}</span>
                        )}
                        {h.decisionText && (
                          <p className="text-xs text-slate-600">{h.decisionText}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(fines ?? []).length > 0 && (
                <div className="mt-4 rounded-xl border bg-white p-3">
                  <h3 className="mb-2 text-sm font-semibold">Fines</h3>
                  <ul className="space-y-1 text-sm">
                    {(fines ?? []).map((f) => (
                      <li key={f._id} className="flex items-center justify-between">
                        <span>
                          <span className="font-semibold">${f.amount.toFixed(2)}</span> — {f.reason}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize">
                          {f.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5">
                <h3 className="mb-3 text-sm font-semibold">Timeline</h3>
                <BoardTimeline caseId={selectedCase._id} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
