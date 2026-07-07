import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useCachedQuery } from "@/offline/hooks";
import { Chip } from "@/components/ui/chip";
import { PROPERTY_STATUS_CHIP } from "@/lib/propertyUi";

export default function PropertyList() {
  const navigate = useNavigate();
  const { streetId } = useParams<{ streetId: string }>();
  const sid = streetId as Id<"streets">;

  const liveData = useQuery(api.streets.getWithProperties, { streetId: sid });
  // Offline-first: cache each street's property list so a walk survives dead zones.
  const { data } = useCachedQuery(`inspector.street.${sid}`, liveData);

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
    <div className="flex min-h-screen flex-col bg-paper pb-24 text-ink">
      <div
        className="sticky top-0 z-50 shrink-0 border-b bg-white"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto max-w-lg px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="shrink-0 text-sm font-semibold text-ink-2 hover:text-ink"
              onClick={() => navigate("/inspector/streets")}
            >
              ‹ Streets
            </button>
            <h1 className="min-w-0 flex-1 truncate px-1 text-center text-base font-bold">
              {data?.street.name ?? "Loading…"}
            </h1>
            <div className="w-14 shrink-0" aria-hidden />
          </div>
          <p className="mt-1 text-center text-xs text-ink-2">
            Walk order: odd side (ascending), then even side (descending)
          </p>
        </div>
      </div>

      <div className="relative z-0 mx-auto w-full max-w-lg flex-1 space-y-2 px-4 py-4">
        {data === undefined && (
          <p className="py-12 text-center text-sm font-medium text-ink-2">Loading…</p>
        )}
        {(data?.properties ?? []).map((p) => {
          const chip = PROPERTY_STATUS_CHIP[p.status];
          return (
            <button
              key={p._id}
              type="button"
              className="btn-bounce flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-left transition-colors hover:border-petrol/40"
              onClick={() => navigate(`/inspector/property/${p._id}`)}
            >
              <div className="min-w-0">
                <span className="font-bold">{p.houseNumber}</span>
                <span className="ml-2 truncate text-sm text-ink-2">{p.address}</span>
              </div>
              <Chip tone={chip.tone}>{chip.label}</Chip>
            </button>
          );
        })}
        {data && data.properties.length === 0 && (
          <p className="py-12 text-center text-sm font-medium text-ink-2">
            No properties on this street
          </p>
        )}
      </div>

      {hasNotStarted && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <button
              type="button"
              className="btn-bounce w-full rounded-2xl bg-petrol py-3.5 text-base font-bold text-white"
              onClick={handleStartWalk}
            >
              Start walk ▸
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
