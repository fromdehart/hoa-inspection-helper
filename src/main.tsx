import { createRoot } from "react-dom/client";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
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

createRoot(document.getElementById("root")!).render(
  <ClerkProvider
    publishableKey={clerkPublishableKey}
    allowedRedirectOrigins={nativeRedirectOrigins}
  >
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <App />
    </ConvexProviderWithClerk>
  </ClerkProvider>,
);
