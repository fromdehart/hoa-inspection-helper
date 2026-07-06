import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { UserButton } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import CompanyGuard from "@/components/CompanyGuard";
import { CopilotPanel } from "@/components/portfolio/CopilotPanel";
import { StatusChip } from "@/components/ui/status-chip";
import {
  CASE_STATUS_CONFIG,
  stageLabel,
  type CaseStatus,
} from "@/lib/caseUi";

export default function PortfolioDashboard() {
  return (
    <CompanyGuard>
      <PortfolioContent />
    </CompanyGuard>
  );
}

function PortfolioContent() {
  const navigate = useNavigate();
  const company = useQuery(api.company.viewerCompanyContext, {});
  const hoas = useQuery(api.company.listMyHoas, {});
  const myQueue = useQuery(api.portfolio.myWorkQueue, {});
  const overdue = useQuery(api.portfolio.overdueCases, {});
  const hearings = useQuery(api.portfolio.hearingsThisWeek, {});
  const split = useQuery(api.portfolio.awaitingSplit, {});
  const setActingHoa = useMutation(api.company.setActingHoa);
  const [entering, setEntering] = useState<Id<"hoas"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enterHoa = async (hoaId: Id<"hoas">) => {
    setEntering(hoaId);
    setError(null);
    try {
      await setActingHoa({ hoaId });
      navigate("/admin/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open community.");
      setEntering(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="gradient-hero sticky top-0 z-10 px-4 py-4 shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-sm font-extrabold text-white">
              🏢 {company?.companyName ?? "Portfolio"}
            </h1>
            <p className="text-xs text-sky-200">Portfolio command center</p>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {/* Top-line tiles */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-white p-4">
            <p className="text-2xl font-extrabold text-slate-900">
              {split ? split.awaitingStaff : "…"}
            </p>
            <p className="text-xs text-slate-500">Waiting on your team</p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-2xl font-extrabold text-slate-900">
              {split ? split.awaitingHomeowner : "…"}
            </p>
            <p className="text-xs text-slate-500">Waiting on homeowners</p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-2xl font-extrabold text-red-600">
              {overdue ? overdue.length : "…"}
            </p>
            <p className="text-xs text-slate-500">Overdue cases</p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-2xl font-extrabold text-violet-700">
              {hearings ? hearings.length : "…"}
            </p>
            <p className="text-xs text-slate-500">Hearings this week</p>
          </div>
        </section>

        <CopilotPanel />

        {/* Communities */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Communities
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hoas === undefined ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : hoas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No communities in your portfolio yet — ask your platform administrator to assign
                them.
              </p>
            ) : (
              hoas.map((hoa) => (
                <div key={hoa.hoaId} className="rounded-xl border bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{hoa.name}</p>
                      <p className="text-xs text-slate-500">
                        {hoa.openCases} open
                        {hoa.overdueCases > 0 && (
                          <span className="font-semibold text-red-600">
                            {" "}
                            · {hoa.overdueCases} overdue
                          </span>
                        )}
                        {hoa.avgResolutionDays !== null && (
                          <> · {hoa.avgResolutionDays.toFixed(0)}d avg resolution</>
                        )}
                      </p>
                      {!hoa.casesEnabled && (
                        <p className="mt-1 text-[11px] text-amber-700">Case tracking not enabled</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={entering !== null}
                      className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                      onClick={() => void enterHoa(hoa.hoaId)}
                    >
                      {entering === hoa.hoaId ? "Opening…" : "Open"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Hearings strip */}
        {hearings && hearings.length > 0 && (
          <section className="rounded-xl border border-violet-200 bg-violet-50 p-3">
            <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-violet-800">
              🗓️ Hearings this week
            </h2>
            <ul className="space-y-1 text-sm text-violet-900">
              {hearings.map((h) => (
                <li key={h._id}>
                  <span className="font-semibold">{h.caseTitle || "Case"}</span>{" "}
                  <span className="text-violet-700">
                    {h.hoaName} · {h.address} ·{" "}
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

        {/* My queue */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            My work queue
          </h2>
          <CaseTable rows={myQueue} empty="No cases are assigned to you." />
        </section>

        {/* Overdue */}
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
            Overdue across the portfolio
          </h2>
          <CaseTable rows={overdue} empty="Nothing is overdue. 🎉" />
        </section>
      </div>
    </div>
  );
}

type PortfolioCaseRow = {
  _id: string;
  title: string;
  stageKey: string;
  status: string;
  actionDueAt?: number;
  address: string;
  hoaName: string;
};

function CaseTable({
  rows,
  empty,
}: {
  rows: PortfolioCaseRow[] | undefined;
  empty: string;
}) {
  if (rows === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (rows.length === 0) {
    return <p className="rounded-xl border bg-white p-4 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2.5">Case</th>
            <th className="px-3 py-2.5">Community</th>
            <th className="px-3 py-2.5">Property</th>
            <th className="px-3 py-2.5">Stage</th>
            <th className="px-3 py-2.5">Due</th>
            <th className="px-3 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const overdue = c.actionDueAt !== undefined && c.actionDueAt < Date.now();
            return (
              <tr key={c._id} className="border-b last:border-0">
                <td className="px-3 py-2.5 font-medium">{c.title}</td>
                <td className="px-3 py-2.5 text-slate-600">{c.hoaName}</td>
                <td className="px-3 py-2.5 text-slate-600">{c.address}</td>
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
    </div>
  );
}
