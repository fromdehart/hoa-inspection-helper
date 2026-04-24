import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

const STATUS_DOT: Record<string, string> = {
  notStarted: "bg-gray-400",
  inProgress: "bg-amber-400",
  complete: "bg-green-500",
};

export default function PropertyList() {
  const navigate = useNavigate();
  const { streetId } = useParams<{ streetId: string }>();
  const sid = streetId as Id<"streets">;

  const data = useQuery(api.streets.getWithProperties, { streetId: sid });

  const handleStartWalk = () => {
    const first = data?.properties.find((p) => p.status === "notStarted");
    if (first) {
      navigate(`/inspector/property/${first._id}`);
    } else {
      alert("All properties inspected!");
    }
  };

  const hasNotStarted = (data?.properties ?? []).some((p) => p.status === "notStarted");

  return (
    <div className="flex min-h-screen flex-col bg-[#f8f7ff] pb-24">
      <div className="gradient-inspector sticky top-0 z-50 shrink-0 border-b border-white/15 px-4 pt-8 pb-5 shadow-md">
        <div className="relative z-[1] flex items-center justify-between gap-2 mb-2">
          <button
            type="button"
            className="shrink-0 text-sky-100 hover:text-white text-sm font-medium transition-colors"
            onClick={() => navigate("/inspector/streets")}
          >
            ← Streets
          </button>
          <h1 className="min-w-0 flex-1 font-extrabold text-white text-lg truncate text-center px-1">
            {data?.street.name ?? "Loading…"}
          </h1>
          <div className="w-16 shrink-0" aria-hidden />
        </div>
        <p className="text-sky-200 text-xs text-center">
          Walk order: Odd side (ascending) then Even side (descending)
        </p>
      </div>

      <div className="relative z-0 max-w-lg mx-auto w-full flex-1 px-4 py-4 space-y-2">
        {data === undefined && (
          <div className="text-center py-12">
            <div className="text-4xl mb-2 animate-spin">🔄</div>
            <p className="text-gray-400 font-medium">Loading…</p>
          </div>
        )}
        {(data?.properties ?? []).map((p) => (
          <button
            key={p._id}
            type="button"
            className="btn-bounce w-full text-left bg-white rounded-2xl px-4 py-3 flex items-center justify-between shadow-sm border border-gray-100 hover:shadow-md transition-all"
            onClick={() => navigate(`/inspector/property/${p._id}`)}
          >
            <div>
              <span className="font-bold text-gray-800">{p.houseNumber}</span>
              <span className="ml-2 text-sm text-gray-500">{p.address}</span>
            </div>
            <span className={`w-3 h-3 rounded-full shrink-0 ${STATUS_DOT[p.status]}`} />
          </button>
        ))}
        {data && data.properties.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-2">🏚️</div>
            <p className="text-gray-400 font-medium">No properties on this street</p>
          </div>
        )}
      </div>

      {hasNotStarted && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-3 bg-white/90 backdrop-blur border-t border-gray-100">
          <button
            type="button"
            className="btn-bounce w-full py-4 rounded-2xl font-bold text-lg gradient-success text-white shadow-lg"
            onClick={handleStartWalk}
          >
            Start Walk → 🚶
          </button>
        </div>
      )}
    </div>
  );
}
