import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";

export default function PlatformGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const isPlatformAdmin = useQuery(
    api.platform.isPlatformAdminQuery,
    isSignedIn ? {} : "skip",
  );

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !isPlatformAdmin) return;
    navigate("/platform/hoas", { replace: true });
  }, [isLoaded, isSignedIn, isPlatformAdmin, navigate]);

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isSignedIn) {
    persistSignInReturnPath(location.pathname);
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  if (isPlatformAdmin === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isPlatformAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
      <p className="text-white">Redirecting to platform...</p>
    </div>
  );
}
