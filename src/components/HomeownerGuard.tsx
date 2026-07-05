import { ReactNode } from "react";
import { Navigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";

/**
 * Gate for the /home homeowner area. Unlike RoleGuard (admin/inspector membership),
 * this checks property-scoped homeowner accounts via homeowners.myProperties.
 */
export default function HomeownerGuard({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  const properties = useQuery(api.homeowners.myProperties, isSignedIn ? {} : "skip");

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  if (!isSignedIn) {
    persistSignInReturnPath(location.pathname);
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  if (properties === undefined) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  if (properties.length === 0) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6 py-10">
        <div className="max-w-md w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-center backdrop-blur-sm">
          <h1 className="text-2xl font-bold text-white">No property on file</h1>
          <p className="mt-2 text-sm text-sky-100">
            We couldn’t find a property linked to your account. Open the portal link from your HOA
            letter to connect your home, or contact your HOA if you think this is a mistake.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm font-semibold text-white underline underline-offset-4"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
