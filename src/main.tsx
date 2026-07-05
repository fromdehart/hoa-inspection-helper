import { createRoot } from "react-dom/client";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { BrowserRouter, useNavigate } from "react-router-dom";
// Self-hosted "Plus Jakarta Sans" (offline-safe; preserves the family name).
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import App from "./App.tsx";
import "./index.css";
import { convex } from "@/lib/convexClient";
import { authLog, clerkPublishableKeyHint } from "@/lib/authLog";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

authLog("bootstrap", "clerk_provider_mounting", {
  clerkPublishableKeyHint: clerkPublishableKeyHint(clerkPublishableKey),
  viteMode: import.meta.env.MODE,
});

// In the native shell the app runs from capacitor://localhost (iOS) or
// http(s)://localhost (Android); Clerk must be told these are valid redirect
// targets or it won't hand the session back after sign-in.
const nativeRedirectOrigins = [
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
  "ionic://localhost",
];

/**
 * Clerk wired into React Router. Passing routerPush/routerReplace makes Clerk's
 * post-sign-in redirect a client-side navigation instead of a hard window.location
 * reload — critical in the native WebView, where a reload wipes the in-memory
 * session (cookies don't persist there) and drops the user back to signed-out.
 * Must render inside <BrowserRouter> so useNavigate has router context.
 */
function ClerkWithRouter() {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      allowedRedirectOrigins={nativeRedirectOrigins}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <App />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ClerkWithRouter />
  </BrowserRouter>,
);
