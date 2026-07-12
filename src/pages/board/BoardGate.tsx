import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";
import { ConvexAuthHelp } from "@/components/ConvexAuthHelp";

/** Redirect landing page at /board (mirrors AdminGate): board or admin → /board/cases. */
export default function BoardGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const viewer = useQuery(api.tenancy.viewerContext, isSignedIn ? {} : "skip");
  const role = viewer?.role ?? null;
  const canView = role === "board" || role === "admin";

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !canView) return;
    navigate("/board/cases", { replace: true });
  }, [isLoaded, isSignedIn, canView, navigate]);

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isSignedIn) {
    persistSignInReturnPath(location.pathname);
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  if (viewer === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (viewer === null) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6 py-10">
        <ConvexAuthHelp />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="text-6xl mb-3">🚫</div>
          <h1 className="text-3xl font-extrabold text-white">Board Access Required</h1>
          <p className="text-purple-200 mt-1">
            Your HOA membership does not include board access for this community.
          </p>
          <button
            type="button"
            className="mt-6 w-full text-center text-white/70 hover:text-white text-sm transition-colors"
            onClick={() => navigate("/")}
          >
            ← Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-6xl mb-3">🏛️</div>
        <h1 className="text-3xl font-extrabold text-white">Board Portal</h1>
        <p className="text-purple-200 mt-1">Redirecting to cases…</p>
      </div>
    </div>
  );
}
