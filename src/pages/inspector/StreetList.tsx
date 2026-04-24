import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { Menu } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { hasRole } from "@/lib/auth";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export default function StreetList() {
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const { user } = useUser();
  const canAdmin = hasRole(user, "admin");
  const [inspectorMenuOpen, setInspectorMenuOpen] = useState(false);

  const streets = useQuery(api.streets.list);

  const allDone =
    streets && streets.length > 0 && streets.every((s) => s.complete === s.total && s.total > 0);

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f7ff]">
      <div className="gradient-inspector sticky top-0 z-50 shrink-0 border-b border-white/15 px-4 pt-10 pb-6 shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 pr-1">
            <p className="text-sky-100 text-sm font-medium uppercase tracking-widest">Inspector Mode</p>
            <h1 className="text-white font-extrabold text-2xl">Your Streets 🗺️</h1>
          </div>
          <div className="relative z-[1] flex shrink-0 items-center gap-2">
            <Sheet open={inspectorMenuOpen} onOpenChange={setInspectorMenuOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/35 bg-white/15 text-white hover:bg-white/25 transition-colors md:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" strokeWidth={2.25} />
                </button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="z-[100] w-[min(100vw-1rem,20rem)] border-l border-gray-200 bg-white sm:max-w-sm"
              >
                <SheetHeader>
                  <SheetTitle className="text-left text-gray-900">Menu</SheetTitle>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-2" aria-label="Inspector actions">
                  {canAdmin && (
                    <button
                      type="button"
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-gray-100 transition-colors"
                      onClick={() => {
                        setInspectorMenuOpen(false);
                        navigate("/admin/dashboard");
                      }}
                    >
                      👔 Admin Mode
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                    onClick={() => {
                      setInspectorMenuOpen(false);
                      void signOut({ redirectUrl: "/" });
                    }}
                  >
                    Logout
                  </button>
                </nav>
              </SheetContent>
            </Sheet>
            <div className="hidden md:flex flex-wrap items-center justify-end gap-2">
              {canAdmin && (
                <button
                  type="button"
                  className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors"
                  onClick={() => navigate("/admin/dashboard")}
                >
                  👔 Admin Mode
                </button>
              )}
              <button
                type="button"
                className="text-sm bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-full border border-white/30 transition-colors"
                onClick={() => void signOut({ redirectUrl: "/" })}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
        {streets && (
          <p className="text-sky-200 text-sm mt-2">
            {streets.filter((s) => s.complete === s.total && s.total > 0).length}/{streets.length} streets done
            {allDone ? " 🎉" : ""}
          </p>
        )}
      </div>

      <div className="relative z-0 max-w-lg mx-auto w-full flex-1 px-4 py-5 space-y-3">
        {streets === undefined && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3 animate-spin">🔄</div>
            <p className="text-gray-400 font-medium">Loading streets...</p>
          </div>
        )}
        {streets?.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">🏗️</div>
            <p className="text-gray-500 font-semibold">No streets yet</p>
            <p className="text-gray-400 text-sm mt-1">Ask admin to import properties</p>
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
              className="btn-bounce w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-all"
              onClick={() => navigate(`/inspector/street/${street._id}`)}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{isDone ? "✅" : "🏠"}</span>
                  <span className="font-bold text-gray-800 text-base">{street.name}</span>
                </div>
                <div className="text-right">
                  <span
                    className={`text-sm font-semibold ${isDone ? "text-green-600" : "text-gray-500"}`}
                  >
                    {complete}/{total}
                  </span>
                </div>
              </div>
              <div
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-200"
                title={
                  total === 0
                    ? "No houses"
                    : `${complete} complete, ${inProgress} in progress, ${total - complete - inProgress} not started`
                }
              >
                <div
                  className="h-full shrink-0 bg-gradient-to-b from-emerald-400 to-emerald-600 transition-[width] duration-500"
                  style={{ width: `${greenPct}%` }}
                />
                <div
                  className="h-full shrink-0 bg-gradient-to-b from-amber-300 to-amber-500 transition-[width] duration-500"
                  style={{ width: `${yellowPct}%` }}
                />
              </div>
              {isDone && (
                <p className="text-green-600 text-xs font-semibold mt-2">Complete! 🎉</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
