import { Link } from "react-router-dom";
import { useHomeProperty } from "./HomeLayout";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  notStarted: { label: "Not yet inspected", className: "bg-slate-100 text-slate-700" },
  inProgress: { label: "Inspection in progress", className: "bg-amber-100 text-amber-800" },
  review: { label: "Awaiting your action", className: "bg-blue-100 text-blue-800" },
  complete: { label: "Complete", className: "bg-green-100 text-green-800" },
};

const TILES = [
  { to: "/home/inspection", icon: "📋", title: "Inspection results", desc: "See findings and upload fix photos" },
  { to: "/home/rules", icon: "📖", title: "Rules & guidelines", desc: "Paint colors, architectural rules" },
  { to: "/home/chat", icon: "💬", title: "Ask the AI assistant", desc: "Questions about HOA rules" },
  { to: "/home/request", icon: "🛠️", title: "Architectural request", desc: "Submit a project for feedback" },
];

export default function HomeDashboard() {
  const { selected } = useHomeProperty();
  const status = selected ? STATUS_LABEL[selected.status] ?? STATUS_LABEL.notStarted : null;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <section className="rounded-2xl bg-white border border-slate-200 p-5">
        <h1 className="text-lg font-bold text-slate-900">{selected?.address}</h1>
        {status && (
          <span
            className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}
          >
            {status.label}
          </span>
        )}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TILES.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="rounded-2xl bg-white border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
          >
            <div className="text-2xl">{t.icon}</div>
            <p className="mt-2 font-semibold text-slate-900">{t.title}</p>
            <p className="text-sm text-slate-500">{t.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
