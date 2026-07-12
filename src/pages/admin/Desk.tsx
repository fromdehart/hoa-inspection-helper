import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/ui/chip";

type Finding = Doc<"findings">;
type Motion = Doc<"motions">;

/** Per-kind presentation + where "open" goes. Unknown kinds get a plain chip. */
const KIND_META: Record<
  string,
  { label: string; tone: "open" | "wait" | "proc" | "ok" | "mute"; link?: (f: Finding) => string | null }
> = {
  case_overdue: {
    label: "Case overdue",
    tone: "proc",
    link: (f) => (f.caseId && f.propertyId ? `/admin/property/${f.propertyId}/case/${f.caseId}` : null),
  },
  arc_aging: {
    label: "ARC waiting",
    tone: "wait",
    link: (f) => (f.propertyId ? `/admin/property/${f.propertyId}` : null),
  },
  deadline_unverified: { label: "Deadline", tone: "proc" },
  motion_stalled: { label: "Vote stalled", tone: "wait" },
  email_quarantined: { label: "Unfiled email", tone: "wait", link: () => "/admin/cases" },
  fix_photo_pending: {
    label: "Fix photo",
    tone: "wait",
    link: (f) => (f.propertyId ? `/admin/property/${f.propertyId}` : null),
  },
  inspection_ready_for_review: {
    label: "Inspection",
    tone: "open",
    link: (f) => (f.propertyId ? `/admin/property/${f.propertyId}` : null),
  },
};

function timeAgo(at: number): string {
  const mins = Math.max(1, Math.floor((Date.now() - at) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function FindingRow({ finding }: { finding: Finding }) {
  const dismiss = useMutation(api.findings.dismiss);
  const meta = KIND_META[finding.kind] ?? { label: finding.kind, tone: "mute" as const };
  const href = meta.link?.(finding) ?? null;
  return (
    <li className="flex items-center gap-2.5 border-t border-border/60 py-2 first:border-0">
      <Chip tone={meta.tone}>{meta.label}</Chip>
      <p className="min-w-0 flex-1 truncate text-[13px]">{finding.title}</p>
      <span className="flex-none text-xs text-ink-2">{timeAgo(finding.detectedAt)}</span>
      {href && (
        <Link to={href} className="flex-none text-xs font-semibold text-petrol hover:underline">
          open ›
        </Link>
      )}
      <button
        type="button"
        className="flex-none text-xs text-ink-2 hover:text-ink hover:underline"
        title="Dismiss — stays quiet while this condition persists"
        onClick={() => void dismiss({ findingId: finding._id })}
      >
        dismiss
      </button>
    </li>
  );
}

function MotionCard({
  motion,
  ownClerkUserId,
  nameFor,
}: {
  motion: Motion;
  ownClerkUserId: string;
  nameFor: (id: string) => string;
}) {
  const vote = useMutation(api.motions.vote);
  const expire = useMutation(api.motions.expire);
  const [busy, setBusy] = useState(false);
  const own = motion.votes.find((entry) => entry.clerkUserId === ownClerkUserId)?.vote;
  const yes = motion.votes.filter((entry) => entry.vote === "yes").length;

  const cast = async (choice: "yes" | "no" | "abstain") => {
    setBusy(true);
    try {
      await vote({ motionId: motion._id, vote: choice });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border bg-paper p-3">
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 text-[13.5px] font-semibold">{motion.title}</p>
        <span className="flex-none font-mono text-xs tabular-nums text-ink-2">
          {yes}/{motion.quorumRequired} to pass
        </span>
      </div>
      {motion.context && <p className="mt-1 text-xs text-ink-2">{motion.context}</p>}
      {motion.votes.length > 0 && (
        <p className="mt-1.5 text-xs text-ink-2">
          {motion.votes
            .map((entry) => `${nameFor(entry.clerkUserId)}: ${entry.vote}`)
            .join(" · ")}
        </p>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        {(["yes", "no", "abstain"] as const).map((choice) => (
          <Button
            key={choice}
            size="sm"
            variant={own === choice ? "default" : "outline"}
            disabled={busy}
            onClick={() => void cast(choice)}
          >
            {choice === "yes" ? "Concur" : choice === "no" ? "Object" : "Abstain"}
          </Button>
        ))}
        <button
          type="button"
          className="ml-auto text-xs text-ink-2 hover:text-ink hover:underline"
          onClick={() => void expire({ motionId: motion._id })}
        >
          withdraw
        </button>
      </div>
    </div>
  );
}

function NewMotionForm({ onDone }: { onDone: () => void }) {
  const open = useMutation(api.motions.open);
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 space-y-2 rounded-lg border bg-paper p-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What's being decided? (e.g. Approve tree remediation proposal)"
      />
      <Textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        rows={2}
        placeholder="Context for the record (optional)"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!title.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await open({
                title: title.trim(),
                context: context.trim() || undefined,
                method: "in_app",
              });
              setTitle("");
              setContext("");
              onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          Open for votes
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Doc<"stewardProposals"> }) {
  const approve = useMutation(api.proposals.approve);
  const reject = useMutation(api.proposals.reject);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(proposal.draftBody);
  const [showContext, setShowContext] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const failed = proposal.status === "needs_human";

  return (
    <div className={`rounded-lg border p-3 ${failed ? "border-overdue/40 bg-white" : "bg-paper"}`}>
      <div className="flex items-baseline gap-2">
        <Chip tone={failed ? "proc" : "wait"}>{failed ? "Needs human" : "Draft ready"}</Chip>
        <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
          {proposal.draftSubject || "Follow-up"}
        </p>
        <span className="flex-none text-xs text-ink-2">{timeAgo(proposal.createdAt)}</span>
      </div>
      {failed ? (
        <p className="mt-1.5 text-xs text-ink-2">
          The Reviewer rejected the Steward's draft {proposal.attempts}× — reasons:{" "}
          {proposal.verdictReasons ?? "unknown"}. Handle this one yourself.
        </p>
      ) : editing ? (
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          className="mt-2 bg-white text-sm"
        />
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-[13px]">{proposal.draftBody}</p>
      )}
      <button
        type="button"
        className="mt-1.5 text-xs text-ink-2 hover:text-ink hover:underline"
        onClick={() => setShowContext((s) => !s)}
      >
        {showContext ? "hide what the Steward saw" : "what the Steward saw ›"}
      </button>
      {showContext && (
        <pre className="mt-1.5 overflow-x-auto rounded-lg border bg-white p-2 text-[11px] text-ink-2">
          {proposal.contextSummary}
        </pre>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!failed && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await approve({
                    proposalId: proposal._id,
                    editedBody: editing ? body : undefined,
                  });
                  try {
                    await navigator.clipboard.writeText(
                      `Subject: ${r.subject}\n\n${r.body}`,
                    );
                    setCopied(true);
                  } catch {
                    // Clipboard can fail (permissions); the note is on the case either way.
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              Approve{editing ? " edited" : ""} & copy
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
              {editing ? "Discard edits" : "Edit"}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void reject({ proposalId: proposal._id })}
        >
          {failed ? "Dismiss" : "Reject"}
        </Button>
        {copied && <span className="text-xs text-ink-2">Copied — paste it into an email to the PM.</span>}
      </div>
    </div>
  );
}

function DeadlinesCard() {
  const deadlines = useQuery(api.deadlines.listForHoa, {});
  const add = useMutation(api.deadlines.add);
  const verify = useMutation(api.deadlines.verify);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [verifyingId, setVerifyingId] = useState<Id<"deadlines"> | null>(null);
  const [evidence, setEvidence] = useState("");

  const open = (deadlines ?? []).filter((d) => d.verificationState !== "verified");

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-bold">Deadlines</h2>
        <button
          type="button"
          className="text-xs font-semibold text-petrol hover:underline"
          onClick={() => setAdding((a) => !a)}
        >
          {adding ? "cancel" : "+ add"}
        </button>
      </div>
      {adding && (
        <div className="mt-2 space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's due? (e.g. DPOR license renewal)"
          />
          <div className="flex gap-2">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            <Button
              size="sm"
              disabled={!title.trim() || !due}
              onClick={async () => {
                await add({ title: title.trim(), dueAt: new Date(`${due}T12:00:00`).getTime() });
                setTitle("");
                setDue("");
                setAdding(false);
              }}
            >
              Add
            </Button>
          </div>
        </div>
      )}
      <ul className="mt-1">
        {open.map((d) => (
          <li key={d._id} className="border-t border-border/60 py-2 first:border-0">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[13px]">{d.title}</p>
              <span
                className={`flex-none font-mono text-xs tabular-nums ${
                  d.verificationState === "escalated" ? "text-overdue font-semibold" : "text-ink-2"
                }`}
              >
                {new Date(d.dueAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                className="flex-none text-xs font-semibold text-petrol hover:underline"
                onClick={() => {
                  setVerifyingId(verifyingId === d._id ? null : d._id);
                  setEvidence("");
                }}
              >
                verify
              </button>
            </div>
            {verifyingId === d._id && (
              <div className="mt-2 flex gap-2">
                <Input
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="Evidence it's done (required)"
                />
                <Button
                  size="sm"
                  disabled={!evidence.trim()}
                  onClick={async () => {
                    await verify({ deadlineId: d._id, evidenceNote: evidence.trim() });
                    setVerifyingId(null);
                  }}
                >
                  ✓
                </Button>
              </div>
            )}
          </li>
        ))}
        {open.length === 0 && (
          <p className="pt-2 text-xs text-ink-2">Nothing unverified on the calendar.</p>
        )}
      </ul>
    </div>
  );
}

function AgendaCard() {
  const items = useQuery(api.agendaItems.listForHoa, {});
  const add = useMutation(api.agendaItems.add);
  const setStatus = useMutation(api.agendaItems.setStatus);
  const [title, setTitle] = useState("");
  return (
    <div className="rounded-xl border bg-white p-4">
      <h2 className="text-[13px] font-bold">Next meeting's agenda</h2>
      <div className="mt-2 flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a topic…"
          onKeyDown={async (e) => {
            if (e.key === "Enter" && title.trim()) {
              await add({ title: title.trim() });
              setTitle("");
            }
          }}
        />
        <Button
          size="sm"
          disabled={!title.trim()}
          onClick={async () => {
            await add({ title: title.trim() });
            setTitle("");
          }}
        >
          Add
        </Button>
      </div>
      <ul className="mt-1">
        {(items ?? []).map((item) => (
          <li
            key={item._id}
            className="flex items-center gap-2 border-t border-border/60 py-2 first:border-0"
          >
            <p className="min-w-0 flex-1 truncate text-[13px]">{item.title}</p>
            <button
              type="button"
              className="flex-none text-xs text-ink-2 hover:text-ink hover:underline"
              onClick={() => void setStatus({ itemId: item._id, status: "done" })}
            >
              done
            </button>
          </li>
        ))}
        {(items ?? []).length === 0 && (
          <p className="pt-2 text-xs text-ink-2">Nothing gathered yet — topics accrete here all cycle.</p>
        )}
      </ul>
    </div>
  );
}

/**
 * The Desk (PRD §6): the one place a board member starts. Votes that need
 * you, findings the monitors surfaced, what's queued for the Steward, and
 * the audit trail of everything the agents did.
 */
export default function Desk() {
  const viewer = useQuery(api.tenancy.viewerContext);
  const findings = useQuery(api.findings.listOpen, {});
  const proposals = useQuery(api.proposals.listPending, {});
  const openMotions = useQuery(api.motions.listForHoa, { status: "open" });
  const ratifiable = useQuery(api.motions.ratificationList, {});
  const activity = useQuery(api.steward.listRecentActions, { limit: 12 });
  const markRatified = useMutation(api.motions.markRatified);
  const addAgenda = useMutation(api.agendaItems.add);
  const [showNewMotion, setShowNewMotion] = useState(false);

  const clerkIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of openMotions ?? []) for (const entry of m.votes) ids.add(entry.clerkUserId);
    return [...ids];
  }, [openMotions]);
  const displayNames = useQuery(
    api.members.displayNamesByClerkIds,
    clerkIds.length > 0 ? { clerkUserIds: clerkIds } : "skip",
  );
  const nameFor = (id: string) => displayNames?.[id] ?? "member";

  const needsHuman = (findings ?? []).filter((f) => f.status === "awaiting_human");
  const forAgent = (findings ?? []).filter(
    (f) => f.status === "awaiting_agent" || f.status === "new",
  );

  return (
    <AdminShell active="desk">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-4">
          <h1 className="text-lg font-bold">The Desk</h1>
          <p className="text-sm text-ink-2">
            What needs the board — watched continuously by the Steward.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {(proposals ?? []).length > 0 && (
              <div className="rounded-xl border bg-white p-4">
                <h2 className="text-[13px] font-bold">
                  For your approval{" "}
                  <span className="font-mono text-xs tabular-nums text-ink-2">
                    · {(proposals ?? []).length}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-ink-2">
                  Drafted by the Steward, verified by the Reviewer. Approving logs it on the
                  case record and copies it for sending.
                </p>
                <div className="mt-2 space-y-2">
                  {(proposals ?? []).map((p) => (
                    <ProposalCard key={p._id} proposal={p} />
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-bold">Your vote</h2>
                <button
                  type="button"
                  className="text-xs font-semibold text-petrol hover:underline"
                  onClick={() => setShowNewMotion((s) => !s)}
                >
                  {showNewMotion ? "cancel" : "+ new motion"}
                </button>
              </div>
              {showNewMotion && <NewMotionForm onDone={() => setShowNewMotion(false)} />}
              <div className="mt-2 space-y-2">
                {(openMotions ?? []).map((m) => (
                  <MotionCard
                    key={m._id}
                    motion={m}
                    ownClerkUserId={viewer?.clerkUserId ?? ""}
                    nameFor={nameFor}
                  />
                ))}
                {(openMotions ?? []).length === 0 && !showNewMotion && (
                  <p className="pt-1 text-xs text-ink-2">
                    No open motions. Decisions made here become the board's durable record —
                    no more concurrences lost in reply chains.
                  </p>
                )}
              </div>
              {(ratifiable ?? []).length > 0 && (
                <div className="mt-3 border-t pt-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
                    Passed — needs ratification at the next meeting
                  </p>
                  <ul>
                    {(ratifiable ?? []).map((m) => (
                      <li
                        key={m._id}
                        className="flex items-center gap-2 border-t border-border/60 py-2 first:border-0"
                      >
                        <p className="min-w-0 flex-1 truncate text-[13px]">{m.title}</p>
                        <button
                          type="button"
                          className="flex-none text-xs font-semibold text-petrol hover:underline"
                          onClick={() =>
                            void addAgenda({
                              title: `Ratify: ${m.title}`,
                              sourceMotionId: m._id,
                            })
                          }
                        >
                          + agenda
                        </button>
                        <button
                          type="button"
                          className="flex-none text-xs text-ink-2 hover:text-ink hover:underline"
                          onClick={() =>
                            void markRatified({
                              motionId: m._id,
                              note: `Ratified ${new Date().toLocaleDateString()}`,
                            })
                          }
                        >
                          mark ratified
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-white p-4">
              <h2 className="text-[13px] font-bold">
                Needs you{" "}
                {needsHuman.length > 0 && (
                  <span className="font-mono text-xs tabular-nums text-ink-2">
                    · {needsHuman.length}
                  </span>
                )}
              </h2>
              <ul className="mt-1">
                {needsHuman.map((f) => (
                  <FindingRow key={f._id} finding={f} />
                ))}
                {needsHuman.length === 0 && (
                  <p className="pt-2 text-xs text-ink-2">
                    All clear — the monitors found nothing that needs a human right now.
                  </p>
                )}
              </ul>
            </div>

            <div className="rounded-xl border bg-white p-4">
              <h2 className="text-[13px] font-bold">
                Queued for the Steward{" "}
                {forAgent.length > 0 && (
                  <span className="font-mono text-xs tabular-nums text-ink-2">
                    · {forAgent.length}
                  </span>
                )}
              </h2>
              <p className="mt-0.5 text-xs text-ink-2">
                The Steward drafts follow-ups for these; drafts arrive here for approval.
              </p>
              <ul className="mt-1">
                {forAgent.map((f) => (
                  <FindingRow key={f._id} finding={f} />
                ))}
                {forAgent.length === 0 && (
                  <p className="pt-2 text-xs text-ink-2">Nothing queued.</p>
                )}
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <DeadlinesCard />
            <AgendaCard />
            <div className="rounded-xl border bg-white p-4">
              <h2 className="text-[13px] font-bold">Steward activity</h2>
              <ul className="mt-1">
                {(activity ?? []).map((a) => (
                  <li key={a._id} className="border-t border-border/60 py-2 first:border-0">
                    <p className="text-xs">{a.argsSummary}</p>
                    <p className="mt-0.5 text-[11px] text-ink-2">
                      {a.toolName} · {timeAgo(a.createdAt)}
                    </p>
                  </li>
                ))}
                {(activity ?? []).length === 0 && (
                  <p className="pt-2 text-xs text-ink-2">
                    No agent activity yet — the first daily sweep will show up here.
                  </p>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
