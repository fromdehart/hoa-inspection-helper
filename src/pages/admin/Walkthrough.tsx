import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import AdminShell from "@/components/admin/AdminShell";
import { Chip, type ChipTone } from "@/components/ui/chip";

type PropertyDoc = Doc<"properties">;

const STATUS_CHIP: Record<PropertyDoc["status"], { label: string; tone: ChipTone }> = {
  notStarted: { label: "Not started", tone: "mute" },
  inProgress: { label: "In progress", tone: "wait" },
  review: { label: "Ready to review", tone: "wait" },
  complete: { label: "Inspected", tone: "ok" },
};

const EXPAND_CAP = 10;

function firstBullet(p: PropertyDoc): string | null {
  const src = p.aiLetterBullets ?? "";
  const line = src
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .find(Boolean);
  return line ?? null;
}

/** Two-segment season progress bar: green = complete, gold = ready to review. */
function ProgressBar({
  complete,
  review,
  total,
  className,
}: {
  complete: number;
  review: number;
  total: number;
  className?: string;
}) {
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
  return (
    <div className={`flex h-2 overflow-hidden rounded bg-secondary ${className ?? ""}`}>
      <span style={{ width: pct(complete), background: "#4a8a66" }} />
      <span style={{ width: pct(review), background: "#c9a53f" }} />
    </div>
  );
}

export default function Walkthrough() {
  const navigate = useNavigate();
  const properties = useQuery(api.properties.list, {});
  const streets = useQuery(api.streets.list);
  const [expanded, setExpanded] = useState<Id<"streets"> | null>(null);

  const byStreet = useMemo(() => {
    const map = new Map<Id<"streets">, PropertyDoc[]>();
    for (const p of properties ?? []) {
      const list = map.get(p.streetId) ?? [];
      list.push(p);
      map.set(p.streetId, list);
    }
    return map;
  }, [properties]);

  const season = useMemo(() => {
    const all = properties ?? [];
    const complete = all.filter((p) => p.status === "complete").length;
    const review = all.filter((p) => p.status === "review").length;
    return { complete, review, inspected: complete + review, total: all.length };
  }, [properties]);

  const year = new Date().getFullYear();

  return (
    <AdminShell active="walkthrough">
      <div className="mb-4 rounded-xl border bg-white px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-base font-bold">{year} walkthrough</h2>
          <span className="text-xs text-ink-2">
            the season's inspection, street by street
          </span>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              className="rounded-lg border bg-white px-3.5 py-1.5 text-xs font-semibold hover:bg-paper"
              onClick={() => navigate("/admin/letter-export")}
            >
              Review letters ▸
            </button>
            <button
              type="button"
              className="rounded-lg bg-petrol px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              onClick={() => navigate("/inspector/streets")}
            >
              Continue in the field ▸
            </button>
          </span>
        </div>
        <div className="mt-3.5 flex items-center gap-3">
          <ProgressBar
            complete={season.complete}
            review={season.review}
            total={season.total}
            className="h-2.5 flex-1"
          />
          <span className="whitespace-nowrap font-mono text-xs text-ink-2">
            <b className="text-ink">{season.inspected}</b> of {season.total} inspected ·{" "}
            {season.review} ready to review
          </span>
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <h2 className="text-sm font-bold">Streets</h2>
          <span className="text-xs text-ink-2">walk order · click to expand</span>
        </div>
        <div className="overflow-x-auto">
          {streets === undefined || properties === undefined ? (
            <p className="p-4 text-sm text-ink-2">Loading streets…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
                  <th className="px-3.5 py-2.5">Street</th>
                  <th className="w-1/3 px-3.5 py-2.5">Progress</th>
                  <th className="px-3.5 py-2.5">Inspected</th>
                  <th className="px-3.5 py-2.5">Ready to review</th>
                  <th className="px-3.5 py-2.5">Letters</th>
                </tr>
              </thead>
              <tbody>
                {streets.map((s) => {
                  const props = byStreet.get(s._id) ?? [];
                  const complete = props.filter((p) => p.status === "complete").length;
                  const review = props.filter((p) => p.status === "review").length;
                  const sent = props.filter((p) => p.letterSentAt).length;
                  const drafts = props.filter(
                    (p) => p.generatedLetterAt && !p.letterSentAt,
                  ).length;
                  const isOpen = expanded === s._id;
                  const shown = isOpen ? props.slice(0, EXPAND_CAP) : [];
                  return (
                    <FragmentRow
                      key={s._id}
                      isOpen={isOpen}
                      onToggle={() => setExpanded(isOpen ? null : s._id)}
                      street={s.name}
                      bar={
                        <ProgressBar complete={complete} review={review} total={props.length} />
                      }
                      inspected={`${complete + review} / ${props.length}`}
                      review={review}
                      letters={
                        sent === 0 && drafts === 0
                          ? props.length === 0 || complete + review === 0
                            ? "not started"
                            : "—"
                          : [sent > 0 ? `${sent} sent` : null, drafts > 0 ? `${drafts} drafts` : null]
                              .filter(Boolean)
                              .join(" · ")
                      }
                      expansion={
                        isOpen ? (
                          <td colSpan={5} className="bg-paper px-3.5 pb-3 pt-0.5">
                            <div className="pl-4">
                              {shown.map((p) => {
                                const chip = STATUS_CHIP[p.status];
                                const teaser = firstBullet(p);
                                return (
                                  <div
                                    key={p._id}
                                    className="flex cursor-pointer items-center gap-3 border-b border-border/60 py-2 last:border-0 hover:bg-white"
                                    onClick={() => navigate(`/admin/property/${p._id}`)}
                                  >
                                    <span className="text-[12.5px] font-semibold">{p.address}</span>
                                    <Chip tone={chip.tone}>{chip.label}</Chip>
                                    {teaser && (
                                      <span className="hidden max-w-md truncate text-xs text-ink-2 md:inline">
                                        {teaser}
                                      </span>
                                    )}
                                    <span className="ml-auto text-xs font-semibold text-petrol">
                                      open ›
                                    </span>
                                  </div>
                                );
                              })}
                              {props.length > EXPAND_CAP && (
                                <p className="pt-2 text-xs text-ink-2">
                                  + {props.length - EXPAND_CAP} more on this street — see
                                  Properties
                                </p>
                              )}
                            </div>
                          </td>
                        ) : null
                      }
                    />
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

/** A street row + its optional expansion row (kept together for the table). */
function FragmentRow({
  street,
  bar,
  inspected,
  review,
  letters,
  isOpen,
  onToggle,
  expansion,
}: {
  street: string;
  bar: React.ReactNode;
  inspected: string;
  review: number;
  letters: string;
  isOpen: boolean;
  onToggle: () => void;
  expansion: React.ReactNode;
}) {
  return (
    <>
      <tr
        className={`cursor-pointer border-b last:border-0 ${isOpen ? "bg-paper" : "hover:bg-paper"}`}
        onClick={onToggle}
      >
        <td className="px-3.5 py-2.5 font-semibold">
          <span className="mr-1.5 inline-block w-3 text-ink-2">{isOpen ? "▾" : "▸"}</span>
          {street}
        </td>
        <td className="px-3.5 py-2.5">{bar}</td>
        <td className="px-3.5 py-2.5 font-mono text-xs tabular-nums">{inspected}</td>
        <td className="px-3.5 py-2.5 font-mono text-xs tabular-nums">{review > 0 ? review : "—"}</td>
        <td className="px-3.5 py-2.5 text-xs text-ink-2">{letters}</td>
      </tr>
      {expansion && <tr className="border-b last:border-0">{expansion}</tr>}
    </>
  );
}
