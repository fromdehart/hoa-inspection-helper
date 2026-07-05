import { useOnline, useSyncStatus } from "@/offline/hooks";
import { syncNow } from "@/offline/syncManager";

/**
 * Floating status pill for offline / queued / syncing state. Bottom-center so it
 * never collides with page headers or the homeowner bottom nav. Hidden when
 * online with nothing pending.
 */
export default function SyncStatusBanner() {
  const online = useOnline();
  const { syncing, pendingPhotos, pendingNotes, lastError } = useSyncStatus();
  const pending = pendingPhotos + pendingNotes;

  if (online && pending === 0 && !syncing) return null;

  let label: string;
  let tone: string;
  if (!online) {
    tone = "bg-slate-800 text-white";
    label = pending > 0 ? `Offline — ${pending} change${pending > 1 ? "s" : ""} queued` : "Offline";
  } else if (syncing) {
    tone = "bg-blue-600 text-white";
    label = `Syncing${pending > 0 ? ` ${pending}…` : "…"}`;
  } else if (lastError) {
    tone = "bg-amber-600 text-white";
    label = `${pending} queued — tap to retry`;
  } else {
    tone = "bg-blue-600 text-white";
    label = `${pending} queued`;
  }

  return (
    <div
      className="fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <button
        type="button"
        onClick={() => online && void syncNow()}
        disabled={!online || syncing}
        className={`pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${tone}`}
      >
        {syncing && (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        )}
        {label}
      </button>
    </div>
  );
}
