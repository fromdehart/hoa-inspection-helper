import { ReactNode, useEffect, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AppRole } from "@/lib/auth";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";
import { authLog, authUserSnapshot } from "@/lib/authLog";
import { ConvexAuthHelp } from "@/components/ConvexAuthHelp";

type RoleGuardProps = {
  allow: AppRole | AppRole[];
  children: ReactNode;
};

export default function RoleGuard({ allow, children }: RoleGuardProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const location = useLocation();
  const viewer = useQuery(api.tenancy.viewerContext, isSignedIn ? {} : "skip");
  const roles = useMemo(() => (viewer?.role ? [viewer.role] : []), [viewer?.role]);
  const allowedList = useMemo(() => (Array.isArray(allow) ? allow : [allow]), [allow]);
  const allowedOk = useMemo(
    () => allowedList.some((role) => roles.includes(role)),
    [allowedList, roles],
  );

  useEffect(() => {
    if (!isLoaded) {
      authLog("RoleGuard", "clerk_loading", { path: location.pathname, allow: allowedList });
      return;
    }
    authLog("RoleGuard", "state", {
      path: location.pathname,
      allow: allowedList,
      isSignedIn,
      user: authUserSnapshot(user),
      resolvedRoles: roles,
      allowedOk,
    });
  }, [isLoaded, isSignedIn, allowedList, roles, allowedOk, user, location.pathname]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || allowedOk) return;
    authLog("RoleGuard", "access_denied", {
      path: location.pathname,
      needOneOf: allowedList,
      resolvedRoles: roles,
      user: authUserSnapshot(user),
    });
  }, [isLoaded, isSignedIn, allowedOk, allowedList, roles, user, location.pathname]);

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

  if (!allowedOk) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-center backdrop-blur-sm">
          <h1 className="text-2xl font-bold text-white">Access denied</h1>
          <p className="mt-2 text-sm text-sky-100">
            Your HOA membership does not include permission for this area. Ask an admin to update your role in
            Convex.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

