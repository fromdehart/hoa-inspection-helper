export type ArcVerdict =
  | "likelyApproved"
  | "needsMoreInformation"
  | "likelyDenied"
  | "uncertain";

export type ArcReviewFeedback = {
  verdict: ArcVerdict;
  missingInformation: string[];
  rationale: string;
  citationsToRules: string[];
};

const VERDICTS: ArcVerdict[] = [
  "likelyApproved",
  "needsMoreInformation",
  "likelyDenied",
  "uncertain",
];

function isVerdict(s: unknown): s is ArcVerdict {
  return typeof s === "string" && (VERDICTS as string[]).includes(s);
}

/** Strip optional markdown code fence and parse JSON object from model output. */
export function parseArcReviewResponse(raw: string): ArcReviewFeedback | null {
  let t = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/m.exec(t);
  if (fence) t = fence[1].trim();
  const objStart = t.indexOf("{");
  const objEnd = t.lastIndexOf("}");
  if (objStart === -1 || objEnd <= objStart) return null;
  t = t.slice(objStart, objEnd + 1);
  try {
    const parsed = JSON.parse(t) as Record<string, unknown>;
    const verdict = parsed.verdict;
    if (!isVerdict(verdict)) return null;
    const missingInformation = Array.isArray(parsed.missingInformation)
      ? parsed.missingInformation.filter((x): x is string => typeof x === "string")
      : [];
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";
    const citationsToRules = Array.isArray(parsed.citationsToRules)
      ? parsed.citationsToRules.filter((x): x is string => typeof x === "string")
      : [];
    return { verdict, missingInformation, rationale, citationsToRules };
  } catch {
    return null;
  }
}

export function fallbackFeedbackFromRaw(raw: string, errorHint?: string): ArcReviewFeedback {
  const trimmed = raw.trim().slice(0, 8000);
  return {
    verdict: "uncertain",
    missingInformation: [],
    rationale:
      (errorHint ? `${errorHint}\n\n` : "") +
      (trimmed
        ? "The model response could not be parsed as JSON. Raw output (truncated):\n\n" + trimmed
        : "The model returned an empty or unreadable response."),
    citationsToRules: [],
  };
}
