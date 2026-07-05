import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { persistSignInReturnPath } from "@/lib/postSignInRedirect";

type ClaimState =
  | { phase: "loading" }
  | { phase: "needsSignIn" }
  | { phase: "claiming" }
  | { phase: "error"; message: string };

/**
 * Landing for the emailed portal link (/portal/:token). Signs the homeowner in
 * (Clerk), then claims the property (email must match properties.email) and sends
 * them to /home. Offers a no-account guest fallback for fix-photo upload only.
 */
export default function ClaimProperty() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAuth();
  const claim = useMutation(api.homeowners.claimPropertyByToken);
  const [state, setState] = useState<ClaimState>({ phase: "loading" });

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setState({ phase: "needsSignIn" });
      return;
    }
    let cancelled = false;
    setState({ phase: "claiming" });
    claim({ token })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          navigate("/home", { replace: true });
        } else {
          setState({ phase: "error", message: res.error });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          phase: "error",
          message: e instanceof Error ? e.message : "Something went wrong. Please try again.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, token, claim, navigate]);

  const goSignIn = () => {
    persistSignInReturnPath(`/portal/${token}`);
    navigate("/sign-in", { state: { from: `/portal/${token}` } });
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-center backdrop-blur-sm">
        <div className="text-5xl mb-3">🏡</div>
        <h1 className="text-2xl font-bold text-white">Your HOA portal</h1>

        {state.phase === "loading" || state.phase === "claiming" ? (
          <p className="mt-3 text-sm text-sky-100">
            {state.phase === "claiming" ? "Connecting your home…" : "Loading…"}
          </p>
        ) : null}

        {state.phase === "needsSignIn" ? (
          <>
            <p className="mt-3 text-sm text-sky-100">
              Sign in or create an account with the email your HOA has on file to see your
              inspection, upload fix photos, browse the rules, and more.
            </p>
            <button
              type="button"
              onClick={goSignIn}
              className="btn-bounce mt-5 w-full gradient-admin rounded-xl p-3.5 font-semibold text-white shadow-lg"
            >
              Sign in / create account
            </button>
            <Link
              to={`/portal/${token}/guest`}
              className="mt-4 inline-block text-xs text-white/70 underline underline-offset-4"
            >
              Just upload a photo without an account
            </Link>
          </>
        ) : null}

        {state.phase === "error" ? (
          <>
            <p className="mt-3 text-sm text-red-100">{state.message}</p>
            <button
              type="button"
              onClick={goSignIn}
              className="btn-bounce mt-5 w-full gradient-admin rounded-xl p-3.5 font-semibold text-white shadow-lg"
            >
              Try a different account
            </button>
            <Link
              to={`/portal/${token}/guest`}
              className="mt-4 inline-block text-xs text-white/70 underline underline-offset-4"
            >
              Continue without an account
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
