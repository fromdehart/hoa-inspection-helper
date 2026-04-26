import { createRoot } from "react-dom/client";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
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

createRoot(document.getElementById("root")!).render(
  <ClerkProvider publishableKey={clerkPublishableKey}>
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      <App />
    </ConvexProviderWithClerk>
  </ClerkProvider>,
);
