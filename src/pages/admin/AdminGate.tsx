import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";
import { authLog, authUserSnapshot } from "@/lib/authLog";
import { ConvexAuthHelp } from "@/components/ConvexAuthHelp";

export default function AdminGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const viewer = useQuery(api.tenancy.viewerContext, isSignedIn ? {} : "skip");
  const role = viewer?.role ?? null;
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!isLoaded) {
      authLog("AdminGate", "clerk_loading", { path: location.pathname });
      return;
    }
    authLog("AdminGate", "state", {
      path: location.pathname,
      isSignedIn,
      primaryRole: role,
      user: authUserSnapshot(user),
    });
  }, [isLoaded, isSignedIn, role, user, location.pathname]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !isAdmin) return;
    authLog("AdminGate", "redirect_dashboard", { to: "/admin/dashboard" });
    navigate("/admin/dashboard", { replace: true });
  }, [isLoaded, isSignedIn, isAdmin, navigate]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (isAdmin) return;
    authLog("AdminGate", "blocked_not_admin", {
      path: location.pathname,
      primaryRole: role,
      user: authUserSnapshot(user),
      hint: "Assign a user HOA membership with admin role.",
    });
  }, [isLoaded, isSignedIn, role, isAdmin, user, location.pathname]);

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

  if (!isAdmin) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-6xl mb-3">🚫</div>
            <h1 className="text-3xl font-extrabold text-white">Admin Access Required</h1>
            <p className="text-purple-200 mt-1">
              Your HOA membership does not include admin access for this community.
            </p>
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
          <div className="text-6xl mb-3">👔</div>
          <h1 className="text-3xl font-extrabold text-white">Admin Portal</h1>
          <p className="text-purple-200 mt-1">Redirecting to dashboard...</p>
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
