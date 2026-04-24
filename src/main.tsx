import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
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
  <BrowserRouter>
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-in"
      afterSignOutUrl="/"
    >
      <App />
    </ClerkProvider>
  </BrowserRouter>,
);
