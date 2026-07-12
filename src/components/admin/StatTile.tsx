import { cn } from "@/lib/utils";

/**
 * Dashboard stat card. `attn` renders the number in overdue red — the only
 * loud element on the page. When clickable it doubles as a table filter.
 */
export function StatTile({
  n,
  label,
  attn = false,
  active = false,
  onClick,
}: {
  n: number;
  label: string;
  attn?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border bg-white px-4 py-3 text-left",
        onClick && "cursor-pointer hover:border-petrol/40",
        active && "border-petrol ring-1 ring-petrol",
      )}
    >
      <span
        className={cn(
          "text-2xl font-bold leading-tight tracking-tight tabular-nums",
          attn && n > 0 && "text-overdue",
        )}
      >
        {n}
      </span>
      <span className="text-xs font-semibold text-ink-2">{label}</span>
    </button>
  );
}
