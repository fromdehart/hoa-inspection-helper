import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

const STATUS_DOT: Record<string, string> = {
  notStarted: "bg-gray-400",
  inProgress: "bg-amber-400",
  complete: "bg-green-500",
};

export default function PropertyList() {
  const navigate = useNavigate();
  const { streetId } = useParams<{ streetId: string }>();
  const sid = streetId as Id<"streets">;

  useEffect(() => {
    if (localStorage.getItem("hoa_inspector") !== "true") {
      navigate("/inspector");
    }
  }, [navigate]);

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
    <div className="min-h-screen bg-background pb-20">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <button
          className="text-sm text-blue-600 hover:underline"
          onClick={() => navigate("/inspector/streets")}
        >
          ← Streets
        </button>
        <h1 className="font-semibold">{data?.street.name ?? "Loading..."}</h1>
        <div className="w-16" />
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">
        <p className="text-xs text-muted-foreground mb-3">
          Walk order: Odd side (ascending) then Even side (descending)
        </p>

        <div className="space-y-2">
          {(data?.properties ?? []).map((p) => (
            <button
              key={p._id}
              className="w-full text-left border rounded-lg px-4 py-3 flex items-center justify-between hover:bg-accent transition-colors"
              onClick={() => navigate(`/inspector/property/${p._id}`)}
            >
              <div>
                <span className="font-medium">{p.houseNumber}</span>
                <span className="ml-2 text-sm text-muted-foreground">{p.address}</span>
              </div>
              <span className={`w-3 h-3 rounded-full ${STATUS_DOT[p.status]}`} />
            </button>
          ))}
          {data?.properties.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No properties on this street</p>
          )}
        </div>
      </div>

      {hasNotStarted && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t">
          <Button className="w-full h-12 text-base bg-green-600 hover:bg-green-700" onClick={handleStartWalk}>
            Start Walk
          </Button>
        </div>
      )}
    </div>
  );
}
