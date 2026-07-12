import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";
import { ConvexAuthHelp } from "@/components/ConvexAuthHelp";

type CompanyGuardProps = {
  children: ReactNode;
};

/** Gate for management-company staff pages (mirrors PlatformGuard). */
export default function CompanyGuard({ children }: CompanyGuardProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading: convexAuthLoading, isAuthenticated: convexAuthenticated } = useConvexAuth();
  const location = useLocation();
  const companyContext = useQuery(
    api.company.viewerCompanyContext,
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

  if (companyContext === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (companyContext === null) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-center backdrop-blur-sm">
          <h1 className="text-2xl font-bold text-white">Management company access required</h1>
          <p className="mt-2 text-sm text-sky-100">
            Your account is not part of a management company. Contact your platform administrator
            for access.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
