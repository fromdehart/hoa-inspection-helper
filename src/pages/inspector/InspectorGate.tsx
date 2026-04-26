import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";
import { authLog, authUserSnapshot } from "@/lib/authLog";

export default function InspectorGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const viewer = useQuery(api.tenancy.viewerContext, isSignedIn ? {} : "skip");
  const canInspect = viewer?.role === "inspector" || viewer?.role === "admin";

  useEffect(() => {
    if (!isLoaded) {
      authLog("InspectorGate", "clerk_loading", { path: location.pathname });
      return;
    }
    authLog("InspectorGate", "state", {
      path: location.pathname,
      isSignedIn,
      canInspect,
      user: authUserSnapshot(user),
    });
  }, [isLoaded, isSignedIn, canInspect, user, location.pathname]);

  useEffect(() => {
    if (isLoaded && isSignedIn && canInspect) {
      authLog("InspectorGate", "redirect_streets", { to: "/inspector/streets" });
      navigate("/inspector/streets", { replace: true });
    }
  }, [isLoaded, isSignedIn, canInspect, navigate]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (canInspect) return;
    authLog("InspectorGate", "blocked_not_inspector", {
      path: location.pathname,
      user: authUserSnapshot(user),
      hint: "Assign inspector or admin via user HOA membership.",
    });
  }, [isLoaded, isSignedIn, canInspect, user, location.pathname]);

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

  if (!canInspect) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-6xl mb-3">🚫</div>
            <h1 className="text-3xl font-extrabold text-white">Inspector Access Required</h1>
            <p className="text-sky-200 mt-1">Your account is not assigned inspector or admin role in Clerk.</p>
          </div>
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
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🚶</div>
          <h1 className="text-3xl font-extrabold text-white">Inspector</h1>
          <p className="text-sky-200 mt-1">Redirecting to streets…</p>
        </div>

        <button
          type="button"
          className="mt-6 w-full text-center text-white/50 hover:text-white/80 text-sm transition-colors"
          onClick={() => navigate("/")}
        >
          ← Back to Home
        </button>
      </div>
    </div>
  );
}
