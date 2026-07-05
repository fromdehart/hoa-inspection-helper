import { useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { uploadArcApplicationFile } from "@/lib/uploadClient";
import { useHomeProperty } from "./HomeLayout";

const VERDICT_UI: Record<string, { label: string; className: string }> = {
  likelyApproved: { label: "Looks likely to be approved", className: "bg-green-100 text-green-800" },
  needsMoreInformation: { label: "Needs more information", className: "bg-amber-100 text-amber-800" },
  likelyDenied: { label: "May conflict with the rules", className: "bg-red-100 text-red-800" },
  uncertain: { label: "Needs committee review", className: "bg-slate-100 text-slate-700" },
};

const STATUS_NOTE: Record<string, string> = {
  ready: "Queued for review…",
  reviewing: "AI is reviewing your request…",
  complete: "",
  error: "Something went wrong while reviewing. You can edit and resubmit.",
  draft: "Draft",
};

type Feedback = {
  verdict: string;
  mustHaveNow: string[];
  helpfulButOptional: string[];
  rationale: string;
  citationsToRules: string[];
};

function parseFeedback(json: string | null): Feedback | null {
  if (!json?.trim()) return null;
  try {
    const p = JSON.parse(json);
    const arr = (x: unknown) =>
      Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
    if (!p.verdict) return null;
    return {
      verdict: p.verdict,
      mustHaveNow: arr(p.mustHaveNow).length ? arr(p.mustHaveNow) : arr(p.missingInformation),
      helpfulButOptional: arr(p.helpfulButOptional),
      rationale: typeof p.rationale === "string" ? p.rationale : "",
      citationsToRules: arr(p.citationsToRules),
    };
  } catch {
    return null;
  }
}

export default function ArcRequest() {
  const { selected } = useHomeProperty();
  const args = selected ? { propertyId: selected.propertyId } : "skip";
  const submissions = useQuery(api.arcApplications.listByHomeowner, args);
  const createByHomeowner = useMutation(api.arcApplications.createByHomeowner);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const [projectType, setProjectType] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<{ publicUrl: string; filePath: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadPhotos = async (files: FileList) => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const up = await uploadArcApplicationFile(selected.propertyId, file);
        setPhotos((p) => [...p, { publicUrl: up.publicUrl, filePath: up.filePath }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!selected || !description.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createByHomeowner({
        propertyId: selected.propertyId,
        projectType: projectType.trim(),
        projectDescription: description.trim(),
        homeownerPhotos: photos,
      });
      setProjectType("");
      setDescription("");
      setPhotos([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Architectural request</h1>
      <p className="text-sm text-slate-500">
        Describe a project (paint, fence, addition…) and get instant AI feedback on how it lines up
        with your HOA’s rules. This is guidance, not an official approval.
      </p>

      <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-700">Project type</label>
          <input
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
            placeholder="e.g. Exterior paint, Fence, Deck"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Describe your project</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Colors, materials, dimensions, location on the property…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          >
            📎 Add photos
          </button>
          {photos.map((p) => (
            <img
              key={p.filePath}
              src={p.publicUrl}
              alt="Project photo"
              loading="lazy"
              className="h-12 w-12 rounded border object-cover"
            />
          ))}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !description.trim()}
          className="btn-bounce w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Working…" : "Submit for AI feedback"}
        </button>
      </section>

      <div className="space-y-3">
        {(submissions ?? []).map((s) => {
          const fb = parseFeedback(s.aiFeedbackJson);
          const verdict = s.verdict ? VERDICT_UI[s.verdict] : null;
          return (
            <section key={s._id} className="rounded-2xl bg-white border border-slate-200 p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  {s.projectType || "Request"}
                </p>
                {verdict ? (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdict.className}`}>
                    {verdict.label}
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">{STATUS_NOTE[s.status] ?? s.status}</span>
                )}
              </div>
              {s.projectDescription && (
                <p className="mt-1 text-sm text-slate-600">{s.projectDescription}</p>
              )}

              {fb && (
                <div className="mt-3 space-y-3 text-sm">
                  {fb.mustHaveNow.length > 0 && (
                    <div>
                      <p className="font-medium text-slate-800">Needed before approval</p>
                      <ul className="mt-1 list-disc pl-5 text-slate-700">
                        {fb.mustHaveNow.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    </div>
                  )}
                  {fb.helpfulButOptional.length > 0 && (
                    <div>
                      <p className="font-medium text-slate-800">Helpful but optional</p>
                      <ul className="mt-1 list-disc pl-5 text-slate-700">
                        {fb.helpfulButOptional.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    </div>
                  )}
                  {fb.rationale && (
                    <div>
                      <p className="font-medium text-slate-800">Summary</p>
                      <p className="text-slate-700">{fb.rationale}</p>
                    </div>
                  )}
                  {fb.citationsToRules.length > 0 && (
                    <div>
                      <p className="font-medium text-slate-800">Based on these rules</p>
                      <ul className="mt-1 list-disc pl-5 text-slate-600">
                        {fb.citationsToRules.map((x, i) => <li key={i}>{x}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {s.status === "error" && (
                <p className="mt-2 text-sm text-red-600">{STATUS_NOTE.error}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
