import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useHomeProperty } from "./HomeLayout";
import { parseBullets } from "./homeUi";

export default function InspectionFindings() {
  const { selected } = useHomeProperty();
  const [showLetter, setShowLetter] = useState(false);
  const view = useQuery(
    api.properties.getHomeownerView,
    selected ? { propertyId: selected.propertyId } : "skip",
  );

  if (!selected || view === undefined) {
    return <div className="py-16 text-center text-slate-500">Loading inspection…</div>;
  }
  if (view === null) {
    return <div className="py-16 text-center text-slate-500">Property not found.</div>;
  }

  const bullets = parseBullets(view.violationBullets);
  const noItems =
    bullets.length === 0 ||
    (bullets.length === 1 && /no exterior items/i.test(bullets[0]));

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Inspection results</h1>

      <section className="rounded-2xl bg-white border border-slate-200 p-5">
        {noItems ? (
          <div className="text-center py-6">
            <div className="text-4xl">✅</div>
            <p className="mt-2 font-semibold text-slate-900">No items to address</p>
            <p className="text-sm text-slate-500">
              Your most recent exterior inspection didn’t flag anything. Nice work!
            </p>
          </div>
        ) : (
          <>
            <p className="font-semibold text-slate-900">Items to address</p>
            <p className="text-sm text-slate-500">
              Please resolve these and upload photos so the HOA can verify.
            </p>
            <ul className="mt-3 space-y-2">
              {bullets.map((b, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-800">
                  <span aria-hidden className="text-blue-500">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <Link
              to="/home/fix-photos"
              className="mt-4 inline-block rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Upload fix photos →
            </Link>
          </>
        )}
      </section>

      {view.generatedLetterHtml ? (
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <button
            type="button"
            onClick={() => setShowLetter((s) => !s)}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={showLetter}
          >
            <span className="font-semibold text-slate-900">Letter from your HOA</span>
            <span className="text-slate-400">{showLetter ? "▲" : "▼"}</span>
          </button>
          {showLetter && (
            <div
              className="prose prose-sm mt-3 max-w-none text-slate-800"
              // Letter HTML is HOA-authored + server-escaped for merged fields.
              dangerouslySetInnerHTML={{ __html: view.generatedLetterHtml }}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
