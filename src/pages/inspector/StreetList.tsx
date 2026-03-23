import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export default function StreetList() {
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem("hoa_inspector") !== "true") {
      navigate("/inspector");
    }
  }, [navigate]);

  const streets = useQuery(api.streets.list);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h1 className="font-bold text-lg">Streets</h1>
        <button
          className="text-sm text-muted-foreground hover:underline"
          onClick={() => {
            localStorage.removeItem("hoa_inspector");
            navigate("/");
          }}
        >
          Logout
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {streets === undefined && (
          <p className="text-center text-muted-foreground py-8">Loading...</p>
        )}
        {streets?.length === 0 && (
          <p className="text-center text-muted-foreground py-8">No streets found</p>
        )}
        {streets?.map((street) => {
          const pct = street.total > 0 ? (street.complete / street.total) * 100 : 0;
          return (
            <button
              key={street._id}
              className="w-full text-left border rounded-xl p-4 min-h-16 hover:bg-accent transition-colors"
              onClick={() => navigate(`/inspector/street/${street._id}`)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-base">{street.name}</span>
                <span className="text-sm text-muted-foreground">
                  {street.complete}/{street.total} complete
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
