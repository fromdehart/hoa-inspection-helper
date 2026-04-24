import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { getUserRole } from "@/lib/auth";

export default function AdminGate() {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const role = getUserRole(user);

  useEffect(() => {
    if (isLoaded && isSignedIn && role === "admin") {
      navigate("/admin/dashboard", { replace: true });
    }
  }, [isLoaded, isSignedIn, role, navigate]);

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  if (role !== "admin") {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-6xl mb-3">🚫</div>
            <h1 className="text-3xl font-extrabold text-white">Admin Access Required</h1>
            <p className="text-purple-200 mt-1">Your account is not assigned the admin role in Clerk.</p>
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
