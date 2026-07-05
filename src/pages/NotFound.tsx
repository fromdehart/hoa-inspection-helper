import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full rounded-2xl border border-white/20 bg-white/10 p-6 text-center backdrop-blur-sm">
        <div className="text-6xl mb-3">🧭</div>
        <h1 className="text-2xl font-bold text-white">Page not found</h1>
        <p className="mt-2 text-sm text-sky-100">
          The link may be outdated or mistyped.
        </p>
        <Link
          to="/"
          className="mt-5 inline-block rounded-xl bg-white/90 px-4 py-2.5 font-semibold text-slate-900"
        >
          Go to home
        </Link>
      </div>
    </div>
  );
}
