import { useState } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useHomeProperty } from "./HomeLayout";
import { StatusChip } from "@/components/ui/status-chip";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
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

const PAGE_SIZE = 15;

/** Homeowner plain-language status line per rollup status. */
const STATUS_EXPLAINER: Record<CaseStatus, string> = {
  open: "The HOA is reviewing this item.",
  awaitingHomeowner: "Action needed from you — see the deadline below.",
  resolved: "This item is resolved. No action needed.",
  closed: "This item is closed. No action needed.",
  escalated: "This item is in the formal review process.",
};

function CaseTimelineHomeowner({ caseId }: { caseId: Id<"cases"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.cases.getTimelineForHomeowner,
    { caseId },
    { initialNumItems: PAGE_SIZE },
  );

  if (status === "LoadingFirstPage") {
    return <p className="text-sm text-slate-500">Loading history…</p>;
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
    <div className="space-y-2">
      <Timeline items={items} />
      {status === "CanLoadMore" && (
        <button
          type="button"
          className="text-xs font-semibold text-blue-600"
          onClick={() => loadMore(PAGE_SIZE)}
        >
          Show older history
        </button>
      )}
    </div>
  );
}

export default function MyCases() {
  const { selected } = useHomeProperty();
  const cases = useQuery(
    api.cases.listForHomeowner,
    selected ? { propertyId: selected.propertyId } : "skip",
  );
  const [expandedId, setExpandedId] = useState<Id<"cases"> | null>(null);

  return (
    <div className="space-y-4 pb-4">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">My Cases</h1>
        <p className="text-sm text-slate-500">
          Every open item for your home, what's next, and the full history — nothing here is
          hidden or changed after the fact.
        </p>
      </div>

      {cases === undefined ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : cases.length === 0 ? (
        <div className="rounded-2xl bg-white p-5 text-center shadow-sm">
          <p className="text-3xl" aria-hidden>
            🎉
          </p>
          <p className="mt-1 text-sm font-medium text-slate-700">No cases for your home.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {cases.map((c) => {
            const overdue =
              c.actionDueAt !== undefined &&
              c.actionDueAt < Date.now() &&
              (c.status === "open" || c.status === "awaitingHomeowner" || c.status === "escalated");
            const expanded = expandedId === c._id;
            return (
              <li key={c._id} className="rounded-2xl bg-white p-4 shadow-sm">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setExpandedId(expanded ? null : c._id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{c.title}</p>
                      <p className="text-xs text-slate-500">
                        {CASE_TYPE_LABEL[c.caseType as CaseType]} · {stageLabel(c.stageKey)}
                      </p>
                    </div>
                    <StatusChip config={CASE_STATUS_CONFIG[c.status as CaseStatus]} />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {STATUS_EXPLAINER[c.status as CaseStatus]}
                  </p>
                  {c.actionDueAt !== undefined &&
                    c.status !== "resolved" &&
                    c.status !== "closed" && (
                      <p
                        className={`mt-1 text-sm font-medium ${
                          overdue ? "text-red-600" : "text-blue-700"
                        }`}
                      >
                        {overdue ? "Deadline passed: " : "Please respond by "}
                        {new Date(c.actionDueAt).toLocaleDateString(undefined, {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    )}
                  <p className="mt-2 text-xs font-semibold text-blue-600">
                    {expanded ? "Hide history ▲" : "View history ▼"}
                  </p>
                </button>
                {expanded && (
                  <div className="mt-3 border-t pt-3">
                    <CaseTimelineHomeowner caseId={c._id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
