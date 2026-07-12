import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

/** Board-facing labels for the autonomy action types. */
const ACTION_LABELS: Record<string, { label: string; hint: string }> = {
  internal_note: { label: "Internal notes & filing", hint: "Case links, classifications" },
  board_reminder: { label: "Reminders to the board", hint: "Nudges on the Desk & digest" },
  pm_status_check: { label: "Status checks to the PM", hint: "The follow-up emails" },
  file_intake_case: { label: "Filing email into cases", hint: "Opening cases from intake" },
  homeowner_letter: { label: "Homeowner letters", hint: "Outward, legal weight" },
  stage_transition: { label: "Case stage changes", hint: "Never automatic" },
  hearing_notice: { label: "Hearing scheduling", hint: "Notice math enforced in code" },
  open_motion: { label: "Opening votes", hint: "Voting itself is always human" },
  email_reply: { label: "Replies to homeowners", hint: "Acknowledgments of filed email" },
  record_concurrence: { label: "Recording email votes", hint: "Evidence-linked concurrences" },
};

const LEVEL_LABELS: Record<string, string> = {
  L0: "L0 · watch only",
  L1: "L1 · draft only",
  L2: "L2 · ask first",
  L3: "L3 · auto + log",
};

const LEVELS = ["L0", "L1", "L2", "L3"] as const;

/**
 * The autonomy ladder (PRD §4.2): what the Steward may do on its own, per
 * action type, with each type's track record beside its lever. Ceilings are
 * enforced server-side; this UI just won't offer levels past them.
 */
export function StewardAutonomySection() {
  const rows = useQuery(api.stewardConfig.get, {});
  const setLevel = useMutation(api.stewardConfig.setLevel);

  return (
    <div className="rounded-xl border bg-white p-4" id="steward">
      <h2 className="text-[13px] font-bold">The Steward's autonomy</h2>
      <p className="mt-0.5 text-xs text-ink-2">
        Per action type: watch → draft → ask first → auto. Promote only after a clean track
        record; one tap demotes. Hearings outcomes, fines, and legal escalation are human-only
        and aren't on this list at all.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b text-[10.5px] font-bold uppercase tracking-wider text-ink-2">
              <th className="py-1.5 pr-3">Action</th>
              <th className="py-1.5 pr-3">Level</th>
              <th className="py-1.5">Track record</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => {
              const meta = ACTION_LABELS[row.actionType] ?? {
                label: row.actionType,
                hint: "",
              };
              const ceilingIdx = LEVELS.indexOf(row.ceiling);
              const total = row.stats.approved + row.stats.edited + row.stats.rejected;
              return (
                <tr key={row.actionType} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">
                    <p className="font-semibold">{meta.label}</p>
                    <p className="text-xs text-ink-2">{meta.hint}</p>
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      className="rounded-lg border bg-white px-2 py-1.5 text-sm"
                      value={row.effective}
                      onChange={(e) =>
                        void setLevel({
                          actionType: row.actionType,
                          level: e.target.value as (typeof LEVELS)[number],
                        })
                      }
                    >
                      {LEVELS.slice(0, ceilingIdx + 1).map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {LEVEL_LABELS[lvl]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-xs text-ink-2">
                    {total === 0 ? (
                      "no decisions yet"
                    ) : (
                      <>
                        <b className="text-[#2c6446]">{row.stats.approved} approved</b>
                        {row.stats.edited > 0 && ` · ${row.stats.edited} edited`}
                        {row.stats.rejected > 0 && (
                          <b className="text-overdue"> · {row.stats.rejected} rejected</b>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
