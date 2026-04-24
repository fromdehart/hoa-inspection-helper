import { useEffect, useMemo } from "react";
import { SignIn, useAuth, useUser } from "@clerk/clerk-react";
import { Navigate, useLocation } from "react-router-dom";
import { authLog, authUserSnapshot } from "@/lib/authLog";
import { resolvePostSignInRedirect } from "@/lib/postSignInRedirect";

export default function SignInPage() {
  const location = useLocation();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();
  const afterSignInPath = useMemo(
    () => resolvePostSignInRedirect(location.state),
    [location.state],
  );
  const afterSignInAbsolute =
    typeof window !== "undefined" ? `${window.location.origin}${afterSignInPath}` : afterSignInPath;

  useEffect(() => {
    if (!isLoaded) {
      authLog("SignInPage", "clerk_loading", { path: window.location.pathname });
      return;
    }
    authLog("SignInPage", "clerk_loaded", {
      path: window.location.pathname,
      isSignedIn,
      clerkUserId: userId ?? user?.id ?? null,
      user: authUserSnapshot(user),
    });
  }, [isLoaded, isSignedIn, userId, user]);

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (isSignedIn) {
    authLog("SignInPage", "post_login_redirect", { to: afterSignInPath });
    return <Navigate to={afterSignInPath} replace />;
  }

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-extrabold text-white">Sign in</h1>
          <p className="text-sky-200 mt-1 text-sm">
            Account creation is admin-managed. Inspectors are provisioned by admin only.
          </p>
        </div>
        <div className="mx-auto flex justify-center">
          <SignIn
            fallbackRedirectUrl={afterSignInAbsolute}
            appearance={{
              elements: {
                footerAction: "hidden",
                footerActionLink: "hidden",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}

