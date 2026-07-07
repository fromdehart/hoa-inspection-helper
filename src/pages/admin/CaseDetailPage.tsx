import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DueDate } from "@/components/ui/due-date";
import { Chip } from "@/components/ui/chip";
import { CaseStepper } from "@/components/cases/CaseStepper";
import { CaseTimeline } from "@/components/cases/CaseTimeline";
import { StageControls } from "@/components/cases/StageControls";
import { HearingsFines } from "@/components/cases/HearingsFines";
import { FixPhotoReviewStrip } from "@/components/cases/FixPhotoReviewStrip";
import {
  CASE_STATUS_CHIP,
  CASE_TYPE_LABEL,
  OPEN_CASE_STATUSES,
  type CaseStatus,
  type CaseType,
} from "@/lib/caseUi";

const UNASSIGNED = "__unassigned__";

/** Full-page case record: stepper, fix-photo review, actions, timeline. */
export default function CaseDetailPage() {
  const navigate = useNavigate();
  const { propertyId, caseId } = useParams<{ propertyId: string; caseId: string }>();
  const pid = propertyId as Id<"properties">;
  const cid = caseId as Id<"cases">;

  const viewer = useQuery(api.tenancy.viewerContext, {});
  const caseDoc = useQuery(api.cases.get, { caseId: cid });
  const property = useQuery(api.properties.get, { id: pid });
  const stageOptions = useQuery(api.cases.getStageOptions, { caseId: cid });
  const members = useQuery(api.members.list, {});

  const addNote = useMutation(api.cases.addNote);
  const assign = useMutation(api.cases.assign);
  const transitionStage = useMutation(api.cases.transitionStage);

  const nameIds = useMemo(() => {
    if (!caseDoc) return [] as string[];
    return [
      ...new Set(
        [caseDoc.createdByClerkUserId, caseDoc.assignedToClerkUserId].filter(
          (x): x is string => !!x,
        ),
      ),
    ];
  }, [caseDoc]);
  const displayNames = useQuery(
    api.members.displayNamesByClerkIds,
    nameIds.length > 0 ? { clerkUserIds: nameIds } : "skip",
  );
  const nameFor = (id?: string) => (!id ? "" : displayNames?.[id]?.trim() || "Team member");

  const [noteText, setNoteText] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"shared" | "internal">("shared");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [letterPanelOpen, setLetterPanelOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [resolvePrompt, setResolvePrompt] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);

  if (viewer && !viewer.features?.includes("cases")) {
    return <Navigate to={`/admin/property/${pid}`} replace />;
  }
  if (caseDoc === null || (caseDoc && caseDoc.propertyId !== pid)) {
    return <Navigate to={`/admin/property/${pid}`} replace />;
  }

  const isOpen = caseDoc ? OPEN_CASE_STATUSES.has(caseDoc.status as CaseStatus) : false;
  const isClosed = caseDoc ? !isOpen : false;
  const resolvedStage = (stageOptions ?? []).find(
    (o) => o.statusRollup === "resolved" && !o.isCurrent,
  );

  const handleResolve = async () => {
    if (!resolvedStage) return;
    setResolveBusy(true);
    try {
      await transitionStage({ caseId: cid, toStageKey: resolvedStage.key });
      setResolvePrompt(false);
    } finally {
      setResolveBusy(false);
    }
  };

  return (
    <AdminShell active="properties">
      <button
        type="button"
        className="mb-2.5 text-xs font-semibold text-ink-2 hover:text-ink"
        onClick={() => navigate(`/admin/property/${pid}`)}
      >
        ‹ {property?.address ?? "Property"}
      </button>

      {!caseDoc ? (
        <p className="py-16 text-center text-sm text-ink-2">Loading case…</p>
      ) : (
        <>
          <div className="mb-3.5 rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h1 className="text-[15px] font-bold">{caseDoc.title}</h1>
              <Chip tone={CASE_STATUS_CHIP[caseDoc.status as CaseStatus].tone}>
                {CASE_STATUS_CHIP[caseDoc.status as CaseStatus].label}
              </Chip>
              <span className="text-xs text-ink-2">
                {CASE_TYPE_LABEL[caseDoc.caseType as CaseType]} · opened{" "}
                {new Date(caseDoc.openedAt).toLocaleDateString()}
                {caseDoc.createdByClerkUserId && ` · ${nameFor(caseDoc.createdByClerkUserId)}`}
              </span>
              <span className="ml-auto">
                <DueDate at={caseDoc.actionDueAt} closed={isClosed} />
              </span>
            </div>
            {caseDoc.description && (
              <p className="mt-1.5 text-sm text-ink-2">{caseDoc.description}</p>
            )}

            <div className="mt-3.5">
              <CaseStepper caseId={cid} />
            </div>

            {isOpen && (
              <div className="mt-3">
                <FixPhotoReviewStrip propertyId={pid} onApproved={() => setResolvePrompt(true)} />
                {resolvePrompt && resolvedStage && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-[#dbe6dc] bg-[#e5efe8] px-3 py-2.5">
                    <p className="text-sm font-medium text-[#2c6446]">
                      Fix approved — move this case to Resolved?
                    </p>
                    <Button
                      size="sm"
                      className="bg-[#2c6446] hover:bg-[#2c6446]/90"
                      disabled={resolveBusy}
                      onClick={handleResolve}
                    >
                      {resolveBusy ? "Resolving…" : "Yes, resolve it"}
                    </Button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink-2 hover:underline"
                      onClick={() => setResolvePrompt(false)}
                    >
                      not yet
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t pt-3">
              <Button size="sm" variant="outline" onClick={() => setLetterPanelOpen((o) => !o)}>
                {letterPanelOpen ? "Hide letters" : "Generate letter ▸"}
              </Button>
              <button
                type="button"
                className="ml-auto text-xs font-semibold text-petrol hover:underline"
                onClick={() => setMoreOpen((o) => !o)}
              >
                {moreOpen ? "Less ▴" : "More ▾"}
              </button>
            </div>

            {letterPanelOpen && (
              <div className="mt-3 rounded-lg border bg-paper p-3">
                <StageControls caseId={cid} section="notices" />
              </div>
            )}

            {moreOpen && (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border bg-paper p-3">
                  <StageControls caseId={cid} section="stages" />
                </div>
                <div className="rounded-lg border bg-paper p-3">
                  <HearingsFines caseId={cid} />
                </div>
                <div className="rounded-lg border bg-paper p-3">
                  <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
                    Assignee
                  </p>
                  <Select
                    value={caseDoc.assignedToClerkUserId ?? UNASSIGNED}
                    onValueChange={async (v) => {
                      await assign({
                        caseId: cid,
                        assignedToClerkUserId: v === UNASSIGNED ? undefined : v,
                      });
                    }}
                  >
                    <SelectTrigger className="w-56">
                      <SelectValue />
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
                </div>
              </div>
            )}
          </div>

          <div className="mb-3.5 space-y-2 rounded-xl border bg-white p-4">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note to the case record…"
              rows={2}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={noteVisibility === "internal"}
                  onChange={(e) => setNoteVisibility(e.target.checked ? "internal" : "shared")}
                />
                Internal only (hidden from homeowner)
              </label>
              <Button
                size="sm"
                disabled={noteSaving || !noteText.trim()}
                onClick={async () => {
                  setNoteSaving(true);
                  setNoteError(null);
                  try {
                    await addNote({ caseId: cid, text: noteText.trim(), visibility: noteVisibility });
                    setNoteText("");
                  } catch (e) {
                    setNoteError(e instanceof Error ? e.message : "Could not add note.");
                  } finally {
                    setNoteSaving(false);
                  }
                }}
              >
                {noteSaving ? "Adding…" : "Add note"}
              </Button>
            </div>
            {noteError && <p className="text-xs text-red-600">{noteError}</p>}
          </div>

          <div className="rounded-xl border bg-white">
            <div className="flex items-baseline gap-2.5 border-b px-4 py-3">
              <h2 className="text-[13px] font-bold">Timeline</h2>
              <span className="text-xs text-ink-2">kept complete, for everyone's records</span>
            </div>
            <div className="px-4 py-3">
              <CaseTimeline caseId={cid} />
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
