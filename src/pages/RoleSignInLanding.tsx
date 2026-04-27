import { useNavigate, Link } from "react-router-dom";
import { ONE_SHOT_VERSION } from "@/version";
import { clearSignInReturnPath } from "@/lib/postSignInRedirect";

/**
 * Role choice before Clerk: Admin vs Inspector (same flow as the original home page).
 */
export default function RoleSignInLanding() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen gradient-hero flex flex-col items-center justify-center px-6 py-12">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <Link
          to="/"
          className="text-sm font-semibold text-white/80 hover:text-white underline-offset-4 hover:underline"
        >
          ← Back to home
        </Link>
      </div>

      <div className="text-center mb-10">
        <div className="text-7xl mb-4 animate-bounce">🏘️</div>
        <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">Happier Block</h1>
        <p className="text-blue-200 text-lg font-medium">Making neighborhoods look good, one house at a time</p>
        <p className="mt-3 text-white/70 text-sm">Choose how you’re signing in</p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4">
        <button
          type="button"
          className="btn-bounce w-full gradient-admin rounded-2xl p-5 text-left shadow-xl border border-white/20 group"
          onClick={() => {
            clearSignInReturnPath();
            navigate("/admin");
          }}
        >
          <div className="flex items-center gap-4">
            <span className="text-4xl">👔</span>
            <div>
              <p className="text-white font-bold text-xl">Admin</p>
              <p className="text-purple-200 text-sm">Dashboard, reports & settings</p>
            </div>
            <span className="ml-auto text-white/60 group-hover:translate-x-1 transition-transform text-xl">→</span>
          </div>
        </button>

        <button
          type="button"
          className="btn-bounce w-full gradient-inspector rounded-2xl p-5 text-left shadow-xl border border-white/20 group"
          onClick={() => {
            clearSignInReturnPath();
            navigate("/inspector");
          }}
        >
          <div className="flex items-center gap-4">
            <span className="text-4xl">🚶</span>
            <div>
              <p className="text-white font-bold text-xl">Inspector</p>
              <p className="text-sky-100 text-sm">Walk the streets, snap photos</p>
            </div>
            <span className="ml-auto text-white/60 group-hover:translate-x-1 transition-transform text-xl">→</span>
          </div>
        </button>
      </div>

      <p className="mt-10 text-white/20 text-xs">Happier Block v{ONE_SHOT_VERSION}</p>
    </div>
  );
}
