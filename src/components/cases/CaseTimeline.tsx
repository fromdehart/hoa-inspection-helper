import { usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import {
  CASE_EVENT_CONFIG,
  formatEventTime,
  stageLabel,
  type CaseEventType,
} from "@/lib/caseUi";

const PAGE_SIZE = 20;

/** Staff-facing paginated case timeline (includes internal events). */
export function CaseTimeline({ caseId }: { caseId: Id<"cases"> }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.cases.getTimeline,
    { caseId },
    { initialNumItems: PAGE_SIZE },
  );

  if (status === "LoadingFirstPage") {
    return <p className="text-sm text-muted-foreground">Loading timeline…</p>;
  }
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
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
      internal: event.visibility === "internal",
    };
  });

  return (
    <div className="space-y-3">
      <Timeline items={items} />
      {status === "CanLoadMore" && (
        <Button variant="outline" size="sm" onClick={() => loadMore(PAGE_SIZE)}>
          Load older activity
        </Button>
      )}
      {status === "LoadingMore" && (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
