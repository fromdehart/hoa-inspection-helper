import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App.tsx";
import "./index.css";
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
    <App />
  </ClerkProvider>,
);
