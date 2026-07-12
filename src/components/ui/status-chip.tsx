import { cn } from "@/lib/utils";
import type { StatusChipConfig } from "@/lib/caseUi";

/** Small rounded status pill; config comes from a shared map (see src/lib/caseUi.ts). */
export function StatusChip({
  config,
  className,
}: {
  config: StatusChipConfig;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        config.className,
        className,
      )}
    >
      {config.emoji && <span aria-hidden>{config.emoji}</span>}
      {config.label}
    </span>
  );
}
