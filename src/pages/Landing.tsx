import { useNavigate } from "react-router-dom";
import { ONE_SHOT_VERSION } from "@/version";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen gradient-hero flex flex-col items-center justify-center px-6 py-12">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="text-7xl mb-4 animate-bounce">🏘️</div>
        <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">
          HOA Inspector
        </h1>
        <p className="text-blue-200 text-lg font-medium">
          Making neighborhoods look good, one house at a time
        </p>
      </div>

      {/* Role cards */}
      <div className="w-full max-w-sm flex flex-col gap-4">
        <button
          type="button"
          className="btn-bounce w-full gradient-admin rounded-2xl p-5 text-left shadow-xl border border-white/20 group"
          onClick={() => navigate("/admin")}
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
          onClick={() => navigate("/inspector")}
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

      <p className="mt-10 text-white/20 text-xs">HOA Inspection Helper v{ONE_SHOT_VERSION}</p>
    </div>
  );
}
