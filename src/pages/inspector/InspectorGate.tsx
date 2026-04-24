import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function InspectorGate() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("hoa_inspector") === "true") {
      navigate("/inspector/streets", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === import.meta.env.VITE_INSPECTOR_PASSWORD) {
      localStorage.setItem("hoa_inspector", "true");
      navigate("/inspector/streets");
    } else {
      setError("Wrong password — try again!");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-6">
      <div className={`w-full max-w-sm ${shake ? "animate-shake" : ""}`}>
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🚶</div>
          <h1 className="text-3xl font-extrabold text-white">Inspector Login</h1>
          <p className="text-sky-200 mt-1">Ready to hit the streets?</p>
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-6 border border-white/20 shadow-2xl">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/40 border border-white/30 focus:outline-none focus:border-cyan-300 focus:bg-white/25 text-base transition-all"
            />
            {error && (
              <p className="text-red-300 text-sm font-medium text-center">{error}</p>
            )}
            <button
              type="submit"
              className="btn-bounce w-full gradient-inspector py-3 rounded-xl text-white font-bold text-lg shadow-lg border border-white/20"
            >
              Start Inspecting →
            </button>
          </form>
        </div>

        <button
          type="button"
          className="mt-6 w-full text-center text-white/50 hover:text-white/80 text-sm transition-colors"
          onClick={() => navigate("/")}
        >
          ← Back to Home
        </button>
      </div>
    </div>
  );
}
