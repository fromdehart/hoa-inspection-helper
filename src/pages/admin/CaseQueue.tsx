import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import AdminShell from "@/components/admin/AdminShell";
import { QuarantineStrip } from "@/components/cases/QuarantineStrip";
import { DueDate } from "@/components/ui/due-date";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CASE_TYPE_LABEL,
  OPEN_CASE_STATUSES,
  stageDisplay,
  type CaseStatus,
  type CaseType,
} from "@/lib/caseUi";
import { cn } from "@/lib/utils";

type CaseRow = Doc<"cases"> & { address: string };
type StatusFilter = "all" | "open" | "waiting" | "resolved";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const UNASSIGNED = "__unassigned__";

const FILTER_LABEL: Record<StatusFilter, string> = {
  all: "All",
  open: "Open",
  waiting: "Waiting",
  resolved: "Resolved",
};

function bucketOf(status: CaseStatus): Exclude<StatusFilter, "all"> {
  if (status === "awaitingHomeowner") return "waiting";
  if (status === "resolved" || status === "closed") return "resolved";
  return "open";
}

/** The work queue: a to-do list (past due · this week · email inbox), then the full table. */
export default function CaseQueue() {
  const navigate = useNavigate();
  const viewer = useQuery(api.tenancy.viewerContext, {});
  const emailIntakeEnabled = viewer?.features?.includes("emailIntake") ?? false;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<CaseType | "all">("all");

  const cases = useQuery(api.cases.listForHoa, {}) as CaseRow[] | undefined;
  const upcomingHearings = useQuery(api.hearings.listUpcoming, { withinDays: 7 });
  const quarantined = useQuery(
    api.emailIntake.listQuarantined,
    emailIntakeEnabled ? {} : "skip",
  );
  const members = useQuery(api.members.list, {});
  const assign = useMutation(api.cases.assign);

  const assigneeNames = useQuery(
    api.members.displayNamesByClerkIds,
    cases && cases.some((c) => c.assignedToClerkUserId)
      ? {
          clerkUserIds: [
            ...new Set(
              cases.map((c) => c.assignedToClerkUserId).filter((x): x is string => !!x),
            ),
          ],
        }
      : "skip",
  );

  const now = Date.now();
  const openCase = (c: CaseRow) => navigate(`/admin/property/${c.propertyId}/case/${c._id}`);

  const { pastDue, thisWeek } = useMemo(() => {
    const open = (cases ?? []).filter((c) => OPEN_CASE_STATUSES.has(c.status as CaseStatus));
    return {
      pastDue: open
        .filter((c) => c.actionDueAt !== undefined && c.actionDueAt < now)
        .sort((a, b) => (a.actionDueAt ?? 0) - (b.actionDueAt ?? 0)),
      thisWeek: open
        .filter(
          (c) => c.actionDueAt !== undefined && c.actionDueAt >= now && c.actionDueAt < now + WEEK_MS,
        )
        .sort((a, b) => (a.actionDueAt ?? 0) - (b.actionDueAt ?? 0)),
    };
  }, [cases, now]);

  const counts = useMemo(() => {
    const c = { all: 0, open: 0, waiting: 0, resolved: 0 };
    for (const row of cases ?? []) {
      c.all++;
      c[bucketOf(row.status as CaseStatus)]++;
    }
    return c;
  }, [cases]);

  const rows = useMemo(() => {
    return (cases ?? []).filter((c) => {
      if (statusFilter !== "all" && bucketOf(c.status as CaseStatus) !== statusFilter) return false;
      if (typeFilter !== "all" && c.caseType !== typeFilter) return false;
      return true;
    });
  }, [cases, statusFilter, typeFilter]);

  const laneCols = emailIntakeEnabled ? "md:grid-cols-3" : "md:grid-cols-2";

  return (
    <AdminShell active="cases">
      <div className={cn("mb-4 grid grid-cols-1 gap-3", laneCols)}>
        <Lane title="Past due" count={pastDue.length}>
          {pastDue.length === 0 ? (
            <p className="py-1.5 text-xs text-ink-2">Nothing past due — nice.</p>
          ) : (
            pastDue.slice(0, 6).map((c) => (
              <LaneItem key={c._id} onClick={() => openCase(c)}>
                <span className="truncate">
                  {c.title} · {c.address}
                </span>
                <DueDate at={c.actionDueAt} />
              </LaneItem>
            ))
          )}
        </Lane>

        <Lane title="This week" count={thisWeek.length + (upcomingHearings?.length ?? 0)}>
          {(upcomingHearings ?? []).map((h) => (
            <LaneItem
              key={h._id}
              onClick={() => navigate(`/admin/property/${h.propertyId}/case/${h.caseId}`)}
            >
              <span className="truncate">
                Board review · {h.caseTitle || h.address}
              </span>
              <span className="due due-soon">
                {new Date(h.scheduledFor).toLocaleString(undefined, {
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </LaneItem>
          ))}
          {thisWeek.map((c) => (
            <LaneItem key={c._id} onClick={() => openCase(c)}>
              <span className="truncate">
                {c.title} · {c.address}
              </span>
              <DueDate at={c.actionDueAt} />
            </LaneItem>
          ))}
          {thisWeek.length === 0 && (upcomingHearings?.length ?? 0) === 0 && (
            <p className="py-1.5 text-xs text-ink-2">A quiet week so far.</p>
          )}
        </Lane>

        {emailIntakeEnabled && (
          <Lane title="Email inbox" count={quarantined?.length ?? 0}>
            {(quarantined?.length ?? 0) === 0 ? (
              <p className="py-1.5 text-xs text-ink-2">Inbox clear.</p>
            ) : (
              <QuarantineStrip />
            )}
          </Lane>
        )}
      </div>

      <div className="rounded-xl border bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          {(Object.keys(FILTER_LABEL) as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={cn(
                "chip",
                statusFilter === f
                  ? "bg-ink text-white before:bg-white"
                  : f === "open"
                    ? "chip-open"
                    : f === "waiting"
                      ? "chip-wait"
                      : f === "resolved"
                        ? "chip-ok"
                        : "chip-mute",
              )}
            >
              {FILTER_LABEL[f]} {counts[f]}
            </button>
          ))}
          <div className="ml-auto">
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as CaseType | "all")}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {(Object.keys(CASE_TYPE_LABEL) as CaseType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {CASE_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto">
          {cases === undefined ? (
            <p className="p-4 text-sm text-ink-2">Loading cases…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-ink-2">No cases match this filter.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
                  <th className="px-3.5 py-2.5">Item</th>
                  <th className="px-3.5 py-2.5">Property</th>
                  <th className="px-3.5 py-2.5">Current step</th>
                  <th className="px-3.5 py-2.5">Assignee</th>
                  <th className="px-3.5 py-2.5">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const closed = bucketOf(c.status as CaseStatus) === "resolved";
                  return (
                    <tr
                      key={c._id}
                      className="cursor-pointer border-b last:border-0 hover:bg-paper"
                      onClick={() => openCase(c)}
                    >
                      <td className="px-3.5 py-2.5 font-semibold">{c.title}</td>
                      <td className="px-3.5 py-2.5 text-ink-2">{c.address}</td>
                      <td className="px-3.5 py-2.5 text-ink-2">
                        {closed ? "Resolved ✓" : stageDisplay(c.stageKey)}
                      </td>
                      <td className="px-3.5 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={c.assignedToClerkUserId ?? UNASSIGNED}
                          onValueChange={async (v) => {
                            await assign({
                              caseId: c._id as Id<"cases">,
                              assignedToClerkUserId: v === UNASSIGNED ? undefined : v,
                            });
                          }}
                        >
                          <SelectTrigger
                            className={cn(
                              "h-7 w-36 border-0 bg-transparent px-1 text-xs shadow-none",
                              !c.assignedToClerkUserId && !closed && "font-bold text-overdue",
                            )}
                          >
                            <SelectValue>
                              {c.assignedToClerkUserId
                                ? assigneeNames?.[c.assignedToClerkUserId] ?? "Team member"
                                : closed
                                  ? "—"
                                  : "Unassigned"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                            {(members ?? []).map((m) => (
                              <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                                {m.fullName || m.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <DueDate at={c.actionDueAt ?? (closed ? c.closedAt : undefined)} closed={closed} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

function Lane({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white px-4 py-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-2">{title}</span>
        <span className="text-[17px] font-bold tabular-nums">{count}</span>
      </div>
      {children}
    </div>
  );
}

function LaneItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-baseline justify-between gap-2.5 border-t border-border/60 py-1.5 text-left text-xs first:border-0 hover:bg-paper"
    >
      {children}
    </button>
  );
}
