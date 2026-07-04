import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";
import { ConvexAuthHelp } from "@/components/ConvexAuthHelp";

type PlatformGuardProps = {
  children: ReactNode;
};

export default function PlatformGuard({ children }: PlatformGuardProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading: convexAuthLoading, isAuthenticated: convexAuthenticated } = useConvexAuth();
  const location = useLocation();
  const isPlatformAdmin = useQuery(
    api.platform.isPlatformAdminQuery,
    isLoaded && isSignedIn && convexAuthenticated ? {} : "skip",
  );

  if (!isLoaded || (isSignedIn && convexAuthLoading)) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isSignedIn) {
    persistSignInReturnPath(location.pathname);
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  if (!convexAuthenticated) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <ConvexAuthHelp />
      </div>
    );
  }

  if (isPlatformAdmin === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isPlatformAdmin) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-center backdrop-blur-sm">
          <h1 className="text-2xl font-bold text-white">Platform access required</h1>
          <p className="mt-2 text-sm text-sky-100">
            Your account is not a platform super admin. Contact the platform owner for access.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
