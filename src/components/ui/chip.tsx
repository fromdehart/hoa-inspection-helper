import { cn } from "@/lib/utils";

export type ChipTone = "open" | "wait" | "proc" | "ok" | "mute";

/**
 * Calm status chip from the staff design language. Tones map to the mockup
 * palette; red is intentionally absent — overdue ink lives in <DueDate>.
 */
export function Chip({
  tone,
  children,
  className,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("chip", `chip-${tone}`, className)}>{children}</span>;
}
