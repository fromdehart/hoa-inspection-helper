/** Pure letter HTML merge (no network) — used from mutations and actions. */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function paragraphsFromPlainText(text: string): string {
  const t = text.trim();
  if (!t) return "<p><em>No new observations recorded for this inspection.</em></p>";
  return t
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

export type LetterPropertyFields = {
  address: string;
  accessToken: string;
  inspectorNotes?: string;
  previousFrontObs?: string;
  previousBackObs?: string;
  previousInspectorComments?: string;
  previousInspectionSummary?: string;
  previousCitations2024?: string;
};

export function buildLetterHtmlSync(args: {
  templateContent: string;
  property: LetterPropertyFields;
  publicBaseUrl: string;
  /** When true, {{violations}} is filled from open violation list HTML; otherwise from inspector notes */
  violationsOrFindingsHtml: string;
}): string {
  const { templateContent, property, publicBaseUrl, violationsOrFindingsHtml } = args;
  const portalLink = `${publicBaseUrl.replace(/\/$/, "")}/portal/${property.accessToken}`;
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const priorParts: string[] = [];
  if (property.previousInspectionSummary?.trim()) {
    priorParts.push(property.previousInspectionSummary.trim());
  } else {
    if (property.previousCitations2024?.trim()) {
      priorParts.push(`<strong>Prior citations (2024):</strong> ${escapeHtml(property.previousCitations2024.trim())}`);
    }
    if (property.previousFrontObs?.trim()) {
      priorParts.push(`<strong>Front (prior):</strong> ${escapeHtml(property.previousFrontObs.trim())}`);
    }
    if (property.previousBackObs?.trim()) {
      priorParts.push(`<strong>Back (prior):</strong> ${escapeHtml(property.previousBackObs.trim())}`);
    }
    if (property.previousInspectorComments?.trim()) {
      priorParts.push(`<strong>Prior comments:</strong> ${escapeHtml(property.previousInspectorComments.trim())}`);
    }
  }
  const priorHtml =
    priorParts.length > 0 ? priorParts.map((p) => `<p>${p}</p>`).join("\n") : "<p><em>None on file.</em></p>";

  const findingsFromNotes = paragraphsFromPlainText(property.inspectorNotes ?? "");

  return templateContent
    .replace(/\{\{address\}\}/g, escapeHtml(property.address))
    .replace(/\{\{violations\}\}/g, violationsOrFindingsHtml)
    .replace(/\{\{inspectorFindings\}\}/g, findingsFromNotes)
    .replace(/\{\{priorInspectionReference\}\}/g, priorHtml)
    .replace(/\{\{portalLink\}\}/g, `<a href="${escapeHtml(portalLink)}">${escapeHtml(portalLink)}</a>`)
    .replace(/\{\{date\}\}/g, escapeHtml(dateStr));
}

export const DEFAULT_LETTER_TEMPLATE = `<div style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 24px; line-height: 1.5;">
  <p>{{date}}</p>
  <p>Re: Individual inspection — {{address}}</p>
  <p>Dear Homeowner,</p>
  <p>The Association has completed its periodic exterior inspection of your lot. The following reflects observations from this inspection and reference information from our records.</p>
  <h3 style="margin-top:1.25em;">Current inspection findings</h3>
  {{inspectorFindings}}
  <h3 style="margin-top:1.25em;">Reference — prior inspection notes</h3>
  {{priorInspectionReference}}
  <p style="margin-top:1.25em;">Please review any items that apply to your property. Where corrections are required, you may submit photos showing completed work through the homeowner portal:</p>
  <p>{{portalLink}}</p>
  <p>Thank you for helping keep the community in good repair.</p>
  <p>Sincerely,<br/>Association Inspection Committee</p>
</div>`;
