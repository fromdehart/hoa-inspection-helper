import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import { useCachedQuery } from "@/offline/hooks";
import {
  pendingCaseEventCount,
  pendingNoteCount,
  pendingPhotoCount,
} from "@/offline/outbox";
import { isOnline } from "@/native/network";
import { Chip } from "@/components/ui/chip";

export default function StreetList() {
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const { user } = useUser();
  const viewer = useQuery(api.tenancy.viewerContext, {});
  const canAdmin = viewer?.role === "admin";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [queued, setQueued] = useState(0);
  const [offline, setOffline] = useState(false);

  const liveStreets = useQuery(api.streets.list);
  // Offline-first: browse cached streets with no signal; refresh from Convex when online.
  const { data: streets } = useCachedQuery("inspector.streets.list", liveStreets);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const [p, n, c] = await Promise.all([
        pendingPhotoCount(),
        pendingNoteCount(),
        pendingCaseEventCount(),
      ]);
      if (!cancelled) {
        setQueued(p + n + c);
        setOffline(!isOnline());
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const doneCount = (streets ?? []).filter((s) => s.complete === s.total && s.total > 0).length;
  const allDone = streets && streets.length > 0 && doneCount === streets.length;

  const initials = (() => {
    const name = user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "";
    const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
    return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase() || "·";
  })();

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <div
        className="sticky top-0 z-50 shrink-0 border-b bg-white"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-2.5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10.5px] font-bold uppercase tracking-widest text-petrol">
              Field mode
            </p>
            <h1 className="text-lg font-bold">Your streets</h1>
          </div>
          {(offline || queued > 0) && (
            <Chip tone="wait">
              {offline ? "Offline" : "Syncing"}
              {queued > 0 ? ` · ${queued} queued` : ""}
            </Chip>
          )}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-petrol text-[11px] font-bold text-white"
              aria-label="Account menu"
            >
              {initials}
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-30 w-44 rounded-lg border bg-white py-1 shadow-medium">
                {canAdmin && (
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                    onClick={() => navigate("/admin/properties")}
                  >
                    Admin mode
                  </button>
                )}
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-destructive hover:bg-secondary"
                  onClick={() => void signOut({ redirectUrl: "/" })}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
        {streets && (
          <p className="mx-auto max-w-lg px-4 pb-2.5 text-xs text-ink-2">
            {doneCount}/{streets.length} streets done{allDone ? " — season wrapped ✓" : ""}
          </p>
        )}
      </div>

      <div className="relative z-0 mx-auto w-full max-w-lg flex-1 space-y-2.5 px-4 py-4">
        {streets === undefined && (
          <p className="py-16 text-center text-sm font-medium text-ink-2">Loading streets…</p>
        )}
        {streets?.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-semibold text-ink-2">No streets yet</p>
            <p className="mt-1 text-sm text-ink-2">Ask an admin to import properties</p>
          </div>
        )}
        {streets?.map((street) => {
          const { total, complete, inProgress } = street;
          const isDone = total > 0 && complete === total;
          const greenPct = total > 0 ? (complete / total) * 100 : 0;
          const yellowPct = total > 0 ? (inProgress / total) * 100 : 0;

          return (
            <button
              key={street._id}
              type="button"
              className="btn-bounce w-full rounded-xl border bg-white p-4 text-left transition-colors hover:border-petrol/40"
              onClick={() => navigate(`/inspector/street/${street._id}`)}
            >
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="text-[15px] font-bold">{street.name}</span>
                <span
                  className={`font-mono text-xs font-semibold tabular-nums ${isDone ? "text-[#2c6446]" : "text-ink-2"}`}
                >
                  {complete}/{total}
                  {isDone ? " ✓" : ""}
                </span>
              </div>
              <div
                className="flex h-2 w-full overflow-hidden rounded bg-secondary"
                title={
                  total === 0
                    ? "No houses"
                    : `${complete} complete, ${inProgress} in progress, ${total - complete - inProgress} not started`
                }
              >
                <div
                  className="h-full shrink-0 transition-[width] duration-500"
                  style={{ width: `${greenPct}%`, background: "#4a8a66" }}
                />
                <div
                  className="h-full shrink-0 transition-[width] duration-500"
                  style={{ width: `${yellowPct}%`, background: "#c9a53f" }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
