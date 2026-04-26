/** Shown when Clerk session exists but Convex has no JWT / no HOA viewer context. */
export function ConvexAuthHelp() {
  return (
    <div className="max-w-md w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-center backdrop-blur-sm">
      <h1 className="text-xl font-bold text-white">HOA access could not be loaded</h1>
      <p className="mt-3 text-left text-sm text-sky-100 space-y-2">
        <span className="block">
          Convex did not receive a valid Clerk session. Finish wiring Clerk → Convex, then redeploy:
        </span>
        <span className="block">
          1. In the{" "}
          <a
            href="https://dashboard.clerk.com"
            className="text-white underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            Clerk dashboard
          </a>
          , enable the Convex integration and ensure a JWT template named{" "}
          <code className="rounded bg-black/30 px-1 py-0.5">convex</code> exists.
        </span>
        <span className="block">
          2. In the{" "}
          <a
            href="https://dashboard.convex.dev"
            className="text-white underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            Convex dashboard
          </a>
          , set env <code className="rounded bg-black/30 px-1 py-0.5">CLERK_JWT_ISSUER_DOMAIN</code> to your
          Clerk Frontend API URL (issuer), e.g.{" "}
          <code className="rounded bg-black/30 px-1 py-0.5">https://your-app.clerk.accounts.dev</code>.
        </span>
        <span className="block">
          3. Run <code className="rounded bg-black/30 px-1 py-0.5">npx convex dev</code> (or deploy) so{" "}
          <code className="rounded bg-black/30 px-1 py-0.5">convex/auth.config.ts</code> is applied.
        </span>
        <span className="block pt-1 text-sky-200/90">
          If auth is already configured, you may need an HOA membership row for your Clerk user in Convex.
        </span>
      </p>
    </div>
  );
}
