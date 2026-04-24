import { SignIn, useAuth } from "@clerk/clerk-react";
import { Navigate } from "react-router-dom";

export default function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (isSignedIn) {
    return <Navigate to="/" replace />;
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
            fallbackRedirectUrl="/"
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

