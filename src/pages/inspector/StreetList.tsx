import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { api } from "../../../convex/_generated/api";
import { hasRole } from "@/lib/auth";

const PROGRESS_COLORS = [
  "from-violet-500 to-purple-500",
  "from-sky-500 to-cyan-500",
  "from-emerald-500 to-green-500",
  "from-orange-500 to-amber-500",
  "from-pink-500 to-rose-500",
];

export default function StreetList() {
  const navigate = useNavigate();
  const { signOut } = useClerk();
  const { user } = useUser();
  const canAdmin = hasRole(user, "admin");

  const streets = useQuery(api.streets.list);

  const allDone =
    streets && streets.length > 0 && streets.every((s) => s.complete === s.total && s.total > 0);

  return (
    <div className="min-h-screen bg-[#f8f7ff]">
      <div className="gradient-inspector px-4 pt-10 pb-6">
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-sky-100 text-sm font-medium uppercase tracking-widest">Inspector Mode</p>
            <h1 className="text-white font-extrabold text-2xl">Your Streets 🗺️</h1>
          </div>
          <div className="flex gap-2">
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
        {streets && (
          <p className="text-sky-200 text-sm mt-2">
            {streets.filter((s) => s.complete === s.total && s.total > 0).length}/{streets.length} streets done
            {allDone ? " 🎉" : ""}
          </p>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-3">
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
        {streets?.map((street, i) => {
          const pct = street.total > 0 ? (street.complete / street.total) * 100 : 0;
          const isDone = pct === 100 && street.total > 0;
          const color = PROGRESS_COLORS[i % PROGRESS_COLORS.length];

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
                    {street.complete}/{street.total}
                  </span>
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full bg-gradient-to-r ${color} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
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
