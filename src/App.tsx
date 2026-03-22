import { useState, useCallback } from "react";
import { ConvexProvider } from "convex/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { convex } from "./lib/convexClient";
import { VoteATron3000 } from "./components/VoteATron3000";
import { VoteATronErrorBoundary } from "./components/VoteATronErrorBoundary";
import { GateScreen } from "./components/GateScreen";
import Index from "./pages/Index";

const GATE_STORAGE_KEY = "one-shot-gate";

function useGateAccess(challengeId: string) {
  const storageKey = `${GATE_STORAGE_KEY}-${challengeId || "default"}`;
  const [granted, setGranted] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "true";
  });
  const grantAccess = useCallback(() => setGranted(true), []);
  return { granted, grantAccess };
}

const App = () => {
  const challengeId = import.meta.env.VITE_CHALLENGE_ID ?? "default";
  const { granted, grantAccess } = useGateAccess(challengeId);

  return (
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              granted ? (
                <Index />
              ) : (
                <GateScreen challengeId={challengeId} onAccessGranted={grantAccess} />
              )
            }
          />
        </Routes>
        <VoteATronErrorBoundary>
          <VoteATron3000 />
        </VoteATronErrorBoundary>
      </BrowserRouter>
    </ConvexProvider>
  );
};

export default App;
