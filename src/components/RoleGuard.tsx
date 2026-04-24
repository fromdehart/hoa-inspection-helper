import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { AppRole, getUserRoles } from "@/lib/auth";

type RoleGuardProps = {
  allow: AppRole | AppRole[];
  children: ReactNode;
};

export default function RoleGuard({ allow, children }: RoleGuardProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const location = useLocation();

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }

  const roles = getUserRoles(user);
  const allowed = Array.isArray(allow) ? allow : [allow];
  if (!allowed.some((role) => roles.includes(role))) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-center backdrop-blur-sm">
          <h1 className="text-2xl font-bold text-white">Access denied</h1>
          <p className="mt-2 text-sm text-sky-100">
            Your account does not have permission for this area. Ask an admin to assign your role in Clerk.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

