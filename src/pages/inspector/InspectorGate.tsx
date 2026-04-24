import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { hasRole } from "@/lib/auth";

export default function InspectorGate() {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const canInspect = hasRole(user, "inspector") || hasRole(user, "admin");

  useEffect(() => {
    if (isLoaded && isSignedIn && canInspect) {
      navigate("/inspector/streets", { replace: true });
    }
  }, [isLoaded, isSignedIn, canInspect, navigate]);

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />;
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
          <h1 className="text-3xl font-extrabold text-white">Inspector Login</h1>
          <p className="text-sky-200 mt-1">Redirecting to streets...</p>
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
