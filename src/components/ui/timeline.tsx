import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TimelineItem = {
  key: string;
  icon: ReactNode;
  title: string;
  timestamp: string;
  body?: ReactNode;
  /** Renders a small "Internal" badge (staff-only note). */
  internal?: boolean;
};

/**
 * Presentational vertical timeline (newest first) shared by the admin,
 * homeowner, and board case views. Data shaping happens in the caller.
 */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("relative space-y-0", className)}>
      {items.map((item, idx) => (
        <li key={item.key} className="relative flex gap-3 pb-4 last:pb-0">
          {idx < items.length - 1 && (
            <span
              aria-hidden
              className="absolute left-[13px] top-7 bottom-0 w-px bg-slate-200"
            />
          )}
          <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm">
            {item.icon}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <p className="text-sm font-medium text-slate-900">{item.title}</p>
              {item.internal && (
                <span className="rounded-full bg-slate-200 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-slate-600">
                  Internal
                </span>
              )}
              <span className="text-xs text-muted-foreground">{item.timestamp}</span>
            </div>
            {item.body && (
              <div className="mt-0.5 text-sm text-slate-600 whitespace-pre-wrap break-words">
                {item.body}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
