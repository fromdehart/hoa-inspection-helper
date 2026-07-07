import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { stageDisplay } from "@/lib/caseUi";

type StageOption = {
  key: string;
  label: string;
  statusRollup?: string;
  isCurrent: boolean;
};

type Step = {
  label: string;
  state: "done" | "now" | "future" | "maybe";
  dashed?: boolean;
};

const FOLLOW_UP_KEYS = new Set(["reinspection", "formalWarning"]);
const IF_NEEDED_KEYS = new Set(["hearingNotice", "hearing", "fineAssessed", "escalatedExternal"]);

/**
 * The case's journey, ending at "Resolved". Escalation stages collapse into a
 * single dashed "if needed" step and only unfold when a case actually goes
 * there — the ladder is a quiet fact, not the feature.
 */
export function CaseStepper({ caseId }: { caseId: Id<"cases"> }) {
  const options = useQuery(api.cases.getStageOptions, { caseId });
  if (!options || options.length === 0) return null;

  const steps = buildSteps(options);

  return (
    <div className="flex items-center overflow-x-auto py-1">
      {steps.map((step, i) => (
        <span key={i} className="flex min-w-0 flex-1 items-center last:flex-none">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold",
              step.state === "done" && "text-[#2c6446]",
              step.state === "now" && "text-ink",
              step.state === "future" && "text-ink-2",
              step.state === "maybe" && "italic text-[#b0b6bf]",
            )}
          >
            <span
              className={cn(
                "inline-flex h-[21px] w-[21px] flex-none items-center justify-center rounded-full border-2 bg-white text-[10px] font-bold",
                step.state === "done" && "border-[#4a8a66] bg-[#4a8a66] text-white",
                step.state === "now" && "border-petrol text-petrol ring-[3px] ring-petrol-soft",
                step.state === "future" && "border-border text-ink-2",
                step.state === "maybe" && "border-dashed border-border text-[#b0b6bf]",
              )}
            >
              {step.state === "done" ? "✓" : step.state === "maybe" ? "⋯" : i + 1}
            </span>
            {step.label}
          </span>
          <span
            className={cn(
              "mx-2 hidden h-0.5 min-w-4 flex-1 last:hidden sm:block",
              step.state === "done" ? "bg-[#4a8a66]" : "bg-border",
            )}
          />
        </span>
      ))}
    </div>
  );
}

function buildSteps(options: StageOption[]): Step[] {
  const currentIdx = options.findIndex((o) => o.isCurrent);

  type Group = { label: string; memberIdx: number[]; dashed?: boolean };
  const groups: Group[] = [];
  const push = (label: string, idx: number, dashed = false) => {
    const last = groups[groups.length - 1];
    if (last && last.label === label && last.dashed === dashed) {
      last.memberIdx.push(idx);
    } else {
      groups.push({ label, memberIdx: [idx], dashed });
    }
  };

  const currentInIfNeeded =
    currentIdx >= 0 && IF_NEEDED_KEYS.has(options[currentIdx].key);
  // Past the escalation block (e.g. resolved after a hearing) keeps it unfolded
  // so the record reads truthfully.
  const passedIfNeeded = options.some(
    (o, idx) => IF_NEEDED_KEYS.has(o.key) && currentIdx > idx,
  );
  const unfoldIfNeeded = currentInIfNeeded || passedIfNeeded;

  for (let idx = 0; idx < options.length; idx++) {
    const o = options[idx];
    const rollupResolved = o.statusRollup === "resolved" || o.statusRollup === "closed";
    if (rollupResolved) {
      push("Resolved", idx);
    } else if (FOLLOW_UP_KEYS.has(o.key)) {
      push("Follow-up", idx);
    } else if (IF_NEEDED_KEYS.has(o.key) && !unfoldIfNeeded) {
      push("if needed", idx, true);
    } else {
      push(stageDisplay(o.key) === o.key ? o.label : stageDisplay(o.key), idx);
    }
  }

  return groups.map((g) => {
    const containsCurrent = g.memberIdx.includes(currentIdx);
    const done = currentIdx >= 0 && Math.max(...g.memberIdx) < currentIdx;
    return {
      label: g.label,
      state: containsCurrent ? "now" : done ? "done" : g.dashed ? "maybe" : "future",
      dashed: g.dashed,
    };
  });
}
