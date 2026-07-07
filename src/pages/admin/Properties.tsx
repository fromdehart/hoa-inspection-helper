import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import AdminShell from "@/components/admin/AdminShell";
import { StatTile } from "@/components/admin/StatTile";
import { Chip } from "@/components/ui/chip";
import { DueDate } from "@/components/ui/due-date";
import {
  CASE_STATUS_CHIP,
  OPEN_CASE_STATUSES,
  stageDisplay,
  type CaseStatus,
} from "@/lib/caseUi";

type PropertyDoc = Doc<"properties">;
type CaseRow = Doc<"cases"> & { address: string };

type Filter = "attention" | "openItems" | "letters" | "fixPhotos" | "review" | "inProgress" | null;

const PROPERTY_STATUS_CHIP: Record<PropertyDoc["status"], { label: string; tone: "open" | "wait" | "proc" | "ok" | "mute" }> = {
  notStarted: { label: "Not started", tone: "mute" },
  inProgress: { label: "In progress", tone: "wait" },
  review: { label: "Ready to review", tone: "wait" },
  complete: { label: "All clear", tone: "ok" },
};

function lettersToSend(p: PropertyDoc): boolean {
  return (p.status === "review" || p.status === "complete") && !p.letterSentAt;
}

export default function Properties() {
  const navigate = useNavigate();
  const viewer = useQuery(api.tenancy.viewerContext);
  const casesEnabled = viewer?.features?.includes("cases") ?? false;

  const properties = useQuery(api.properties.list, {});
  const streets = useQuery(api.streets.list);
  const cases = useQuery(api.cases.listForHoa, casesEnabled ? {} : "skip");
  const pendingFixPhotos = useQuery(api.fixPhotos.listPendingForHoa, {});

  const [filter, setFilter] = useState<Filter>(null);
  const [search, setSearch] = useState("");

  const streetNames = useMemo(() => {
    const map = new Map<Id<"streets">, string>();
    for (const s of streets ?? []) map.set(s._id, s.name);
    return map;
  }, [streets]);

  const casesByProperty = useMemo(() => {
    const map = new Map<Id<"properties">, CaseRow[]>();
    for (const c of (cases ?? []) as CaseRow[]) {
      const list = map.get(c.propertyId) ?? [];
      list.push(c);
      map.set(c.propertyId, list);
    }
    return map;
  }, [cases]);

  const fixPhotoProps = useMemo(
    () => new Set((pendingFixPhotos ?? []).map((p) => p.propertyId)),
    [pendingFixPhotos],
  );

  const now = Date.now();

  const rows = useMemo(() => {
    if (!properties) return undefined;
    const decorated = properties.map((p) => {
      const propCases = (casesByProperty.get(p._id) ?? []).filter((c) =>
        OPEN_CASE_STATUSES.has(c.status as CaseStatus),
      );
      // Most urgent open case: earliest due date first, undated last.
      const urgent = [...propCases].sort(
        (a, b) => (a.actionDueAt ?? Infinity) - (b.actionDueAt ?? Infinity),
      )[0];
      const overdue = propCases.some((c) => c.actionDueAt !== undefined && c.actionDueAt < now);
      const needsAttention = overdue || fixPhotoProps.has(p._id);
      const lastActivity = Math.max(
        ...propCases.map((c) => c.updatedAt ?? 0),
        p.inspectionNotesLastUpdatedAt ?? 0,
        p.inspectionNotesEnteredAt ?? 0,
        p.letterSentAt ?? 0,
        0,
      );
      return { p, openCases: propCases, urgent, overdue, needsAttention, lastActivity };
    });

    const filtered = decorated.filter((r) => {
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.p.address} ${r.p.homeownerNames ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (filter) {
        case "attention":
          return r.needsAttention;
        case "openItems":
          return r.openCases.length > 0;
        case "letters":
          return lettersToSend(r.p);
        case "fixPhotos":
          return fixPhotoProps.has(r.p._id);
        case "review":
          return r.p.status === "review";
        case "inProgress":
          return r.p.status === "inProgress";
        default:
          return true;
      }
    });

    return filtered.sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      const dueA = a.urgent?.actionDueAt ?? Infinity;
      const dueB = b.urgent?.actionDueAt ?? Infinity;
      if (dueA !== dueB) return dueA - dueB;
      return a.p.address.localeCompare(b.p.address);
    });
  }, [properties, casesByProperty, fixPhotoProps, filter, search, now]);

  const stats = useMemo(() => {
    if (!properties) return null;
    const openCaseCount = (cases ?? []).filter((c) =>
      OPEN_CASE_STATUSES.has(c.status as CaseStatus),
    ).length;
    const attention = properties.filter((p) => {
      const overdue = (casesByProperty.get(p._id) ?? []).some(
        (c) =>
          OPEN_CASE_STATUSES.has(c.status as CaseStatus) &&
          c.actionDueAt !== undefined &&
          c.actionDueAt < now,
      );
      return overdue || fixPhotoProps.has(p._id);
    }).length;
    return {
      attention,
      openCaseCount,
      letters: properties.filter(lettersToSend).length,
      fixPhotos: pendingFixPhotos?.length ?? 0,
      review: properties.filter((p) => p.status === "review").length,
      inProgress: properties.filter((p) => p.status === "inProgress").length,
      inspected: properties.filter((p) => p.status === "review" || p.status === "complete").length,
      total: properties.length,
    };
  }, [properties, cases, casesByProperty, fixPhotoProps, pendingFixPhotos, now]);

  const toggle = (f: Filter) => setFilter((cur) => (cur === f ? null : f));

  return (
    <AdminShell active="properties">
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {casesEnabled ? (
            <>
              <StatTile n={stats.attention} label="Need attention" attn active={filter === "attention"} onClick={() => toggle("attention")} />
              <StatTile n={stats.openCaseCount} label="Open items" active={filter === "openItems"} onClick={() => toggle("openItems")} />
              <StatTile n={stats.letters} label="Letters to send" active={filter === "letters"} onClick={() => toggle("letters")} />
              <StatTile n={stats.fixPhotos} label="Fix photos to review" active={filter === "fixPhotos"} onClick={() => toggle("fixPhotos")} />
            </>
          ) : (
            <>
              <StatTile n={stats.review} label="Ready to review" attn active={filter === "review"} onClick={() => toggle("review")} />
              <StatTile n={stats.inProgress} label="In progress" active={filter === "inProgress"} onClick={() => toggle("inProgress")} />
              <StatTile n={stats.letters} label="Letters to send" active={filter === "letters"} onClick={() => toggle("letters")} />
              <StatTile n={stats.fixPhotos} label="Fix photos to review" active={filter === "fixPhotos"} onClick={() => toggle("fixPhotos")} />
            </>
          )}
        </div>
      )}

      <div className="rounded-xl border bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <h2 className="text-sm font-bold">Properties</h2>
          {stats && (
            <span className="text-xs text-ink-2">
              {stats.total} homes · needs-attention first
            </span>
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by address or owner…"
            className="ml-auto w-56 rounded-lg border bg-paper px-3 py-1.5 text-sm"
          />
        </div>
        <div className="overflow-x-auto">
          {rows === undefined ? (
            <p className="p-4 text-sm text-ink-2">Loading properties…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-ink-2">No properties match.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
                  <th className="px-3.5 py-2.5">Address</th>
                  <th className="px-3.5 py-2.5">Owner</th>
                  <th className="px-3.5 py-2.5">Open items</th>
                  <th className="px-3.5 py-2.5">Current step</th>
                  <th className="px-3.5 py-2.5">Date</th>
                  <th className="px-3.5 py-2.5">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, openCases, urgent, lastActivity }) => {
                  const statusChip = PROPERTY_STATUS_CHIP[p.status];
                  return (
                    <tr
                      key={p._id}
                      className="cursor-pointer border-b last:border-0 hover:bg-paper"
                      onClick={() => navigate(`/admin/property/${p._id}`)}
                    >
                      <td className="px-3.5 py-2.5 font-semibold">
                        {p.address}
                        <span className="ml-2 text-xs font-normal text-ink-2">
                          {streetNames.get(p.streetId) ?? ""}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-ink-2">{p.homeownerNames || "—"}</td>
                      <td className="px-3.5 py-2.5">
                        {openCases.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {openCases.slice(0, 2).map((c) => (
                              <Chip key={c._id} tone={CASE_STATUS_CHIP[c.status as CaseStatus].tone}>
                                {c.title}
                              </Chip>
                            ))}
                            {openCases.length > 2 && (
                              <span className="text-xs text-ink-2">+{openCases.length - 2}</span>
                            )}
                          </span>
                        ) : p.status === "complete" ? (
                          <Chip tone="ok">All clear</Chip>
                        ) : (
                          <Chip tone={statusChip.tone}>{statusChip.label}</Chip>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-ink-2">
                        {urgent
                          ? stageDisplay(urgent.stageKey)
                          : lettersToSend(p)
                            ? "Letter to send"
                            : "—"}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <DueDate at={urgent?.actionDueAt} />
                      </td>
                      <td className="px-3.5 py-2.5 text-xs text-ink-2">
                        {lastActivity > 0 ? new Date(lastActivity).toLocaleDateString() : "—"}
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
