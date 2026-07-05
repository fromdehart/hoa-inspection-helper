import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useHomeProperty } from "./HomeLayout";

const CATEGORY_LABEL: Record<string, string> = {
  paintColors: "🎨 Paint colors",
  architectural: "🏛️ Architectural",
  landscaping: "🌳 Landscaping",
  general: "📄 General",
};

export default function RulesLibrary() {
  const { selected } = useHomeProperty();
  const args = selected ? { propertyId: selected.propertyId } : "skip";
  const docs = useQuery(api.arcReferenceDocs.listForHomeowner, args);
  const rules = useQuery(api.aiConfig.getHomeownerRules, args);

  if (!selected || docs === undefined || rules === undefined) {
    return <div className="py-16 text-center text-slate-500">Loading rules…</div>;
  }

  const grouped = docs.reduce<Record<string, typeof docs>>((acc, d) => {
    (acc[d.category] ??= []).push(d);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort();

  const hasAnything =
    docs.length > 0 || rules.approvedColors || rules.hoaGuidelines || rules.violationRules;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Rules & guidelines</h1>

      {rules.approvedColors && (
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900">🎨 Approved paint colors</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{rules.approvedColors}</p>
        </section>
      )}

      {rules.hoaGuidelines && (
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900">📋 HOA guidelines</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{rules.hoaGuidelines}</p>
        </section>
      )}

      {categories.map((cat) => (
        <section key={cat} className="rounded-2xl bg-white border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900">{CATEGORY_LABEL[cat] ?? cat}</h2>
          <ul className="mt-3 space-y-3">
            {grouped[cat].map((d) => (
              <li key={d._id}>
                <a
                  href={d.sourcePublicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 hover:underline"
                >
                  {d.title}
                </a>
                {d.preview && (
                  <p className="mt-1 line-clamp-3 text-sm text-slate-500">{d.preview}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {!hasAnything && (
        <div className="py-12 text-center text-slate-500">
          <p>No rules published yet</p>
          <p className="text-sm">Your HOA hasn’t added any documents to the library.</p>
        </div>
      )}
    </div>
  );
}
