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
  recipientName?: string;
  recipientStreet?: string;
  recipientCityStateZip?: string;
  inspectorNotes?: string;
  previousFrontObs?: string;
  previousBackObs?: string;
  previousInspectorComments?: string;
  previousInspectionSummary?: string;
  previousCitations2024?: string;
};

function htmlListItemsFromPlain(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return `<li>No exterior routine maintenance items were listed for this inspection.</li>`;
  }
  return lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n");
}

export function buildLetterHtmlSync(args: {
  templateContent: string;
  property: LetterPropertyFields;
  publicBaseUrl: string;
  /** When true, {{violations}} is filled from open violation list HTML; otherwise from inspector notes */
  violationsOrFindingsHtml: string;
  /** Plain text for {{inspectorFindings}}; defaults to `property.inspectorNotes` */
  inspectorFindingsPlain?: string;
  /** Plain bullet list text for sample-2025 maintenance list section. */
  maintenanceItemsPlain?: string;
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

  const findingsPlain =
    args.inspectorFindingsPlain !== undefined
      ? args.inspectorFindingsPlain
      : (property.inspectorNotes ?? "");
  const findingsFromNotes = paragraphsFromPlainText(findingsPlain);
  const maintenanceItemsPlain = args.maintenanceItemsPlain ?? findingsPlain;
  const maintenanceItemsHtml = htmlListItemsFromPlain(maintenanceItemsPlain);
  const recipientStreet = property.recipientStreet ?? property.address;
  const recipientName = property.recipientName?.trim() || "Homeowner";
  const recipientCityStateZip = property.recipientCityStateZip?.trim() || "Fairfax, VA 22030";

  return templateContent
    .replace(/\{\{address\}\}/g, escapeHtml(property.address))
    .replace(/\{\{violations\}\}/g, violationsOrFindingsHtml)
    .replace(/\{\{inspectorFindings\}\}/g, findingsFromNotes)
    .replace(/\{\{maintenanceItems\}\}/g, maintenanceItemsHtml)
    .replace(/\{\{priorInspectionReference\}\}/g, priorHtml)
    .replace(/\{\{portalLink\}\}/g, `<a href="${escapeHtml(portalLink)}">${escapeHtml(portalLink)}</a>`)
    .replace(/\{\{recipientName\}\}/g, escapeHtml(recipientName))
    .replace(/\{\{recipientStreet\}\}/g, escapeHtml(recipientStreet))
    .replace(/\{\{recipientCityStateZip\}\}/g, escapeHtml(recipientCityStateZip))
    .replace(/\{\{date\}\}/g, escapeHtml(dateStr));
}

export const DEFAULT_LETTER_TEMPLATE = `<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.35; color: #000; max-width: 720px; margin: 0 auto; padding: 28px 36px;">
  <p style="margin: 0 0 8px 0;">{{date}}</p>
  <p style="margin: 0 0 12px 0; font-weight: bold;">TIME SENSITIVE CONTENT</p>
  <p style="margin: 0;">{{recipientName}}</p>
  <p style="margin: 0;">{{recipientStreet}}</p>
  <p style="margin: 0 0 16px 0;">{{recipientCityStateZip}}</p>

  <p style="margin: 0 0 12px 0;">Dear Homeowner(s):</p>

  <p style="margin: 0 0 12px 0;">The Covenants Committee, as directed by the Board of Directors for the Ridge Top Terrace Homeowners Association, has recently conducted a walkthrough of the property in order to ensure that our community has a well-maintained, cohesive, and attractive appearance. Inspections continued to focus on the fronts and sides of homes, as well as rears and fencing that are visible from the street. Overall, our community looks great, and we are pleased to have noticed many homeowners working on the exterior of their homes over the last few months.</p>

  <p style="margin: 0 0 12px 0;">The Board of Directors would like to thank you for your continued commitment to maintaining the appearance and integrity of our community. As part of our annual property review, we are pleased to report that no major structural issues or significant repairs were identified at your home.</p>

  <p style="margin: 0 0 12px 0;">Any needs observed at your property relate to general, routine maintenance, which helps preserve curb appeal and prevent future deterioration. These may include any of the following:</p>
  <ul style="margin: 0 0 12px 20px; padding: 0 0 0 14px;">
    {{maintenanceItems}}
  </ul>

  <p style="margin: 0 0 12px 0;">We understand that seasonal weather conditions and current supply delays may make immediate completion difficult. Accordingly, these items are not required to be addressed right away. However, we do ask that all listed maintenance be completed before the next inspection cycle in Spring 2026.</p>

  <p style="margin: 0 0 12px 0;">Thank you for your attention to these routine items and for your continued efforts to keep our community beautiful. If you have any questions or require clarification, please feel free to contact Krystal Hudson with Capitol Management at Krystal@capitolmanagementcorp.net.</p>

  <div style="page-break-inside: avoid; margin-top: 14px;">
    <p style="margin: 0 0 10px 0;">Thank you again for your cooperation and commitment to helping keep Ridge Top Terrace HOA a pleasant and attractive community.</p>
    <p style="margin: 0;">Covenants Committee<br/>Ridge Top Terrace HOA</p>
  </div>
</div>`;
