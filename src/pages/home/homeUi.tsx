/** Shared UI helpers for the homeowner area. */

const VERIFICATION_UI: Record<string, { label: string; className: string }> = {
  pending: { label: "Verifying…", className: "bg-amber-100 text-amber-800" },
  resolved: { label: "✓ Resolved", className: "bg-green-100 text-green-800" },
  notResolved: { label: "✗ Still present", className: "bg-red-100 text-red-800" },
  needsReview: { label: "Under review", className: "bg-slate-100 text-slate-700" },
};

export function VerificationBadge({ status }: { status: string }) {
  const ui = VERIFICATION_UI[status] ?? VERIFICATION_UI.needsReview;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${ui.className}`}>
      {ui.label}
    </span>
  );
}

/** Parse a markdown-ish bullet list ("- item") into individual items. */
export function parseBullets(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0);
}
