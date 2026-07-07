import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DueInfo = {
  label: string;
  tone: "late" | "soon" | "fine";
};

/**
 * Single source for due-date countdown math. `closed` renders the date in
 * quiet ink regardless of how far past it is.
 */
export function describeDue(at: number | undefined, closed = false): DueInfo | null {
  if (at === undefined) return null;
  const now = Date.now();
  if (closed || at >= now + 7 * DAY_MS) {
    return { label: new Date(at).toLocaleDateString(), tone: "fine" };
  }
  if (at < now) {
    const days = Math.max(1, Math.floor((now - at) / DAY_MS));
    return { label: `${days}d past due`, tone: "late" };
  }
  const days = Math.ceil((at - now) / DAY_MS);
  return { label: days <= 1 ? "due tomorrow" : `${days}d left`, tone: "soon" };
}

export function DueDate({
  at,
  closed = false,
  className,
}: {
  at: number | undefined;
  /** True when the case/property is resolved or closed — dates render quiet. */
  closed?: boolean;
  className?: string;
}) {
  const due = describeDue(at, closed);
  if (!due) return <span className={cn("due due-fine", className)}>—</span>;
  return <span className={cn("due", `due-${due.tone}`, className)}>{due.label}</span>;
}
