import type { Doc } from "../_generated/dataModel";

export function hasLetterBullets(property: Doc<"properties">): boolean {
  return !!(property.aiLetterBullets?.trim());
}

export function isNoViolationsConfirmed(property: Doc<"properties">): boolean {
  return property.noViolationsConfirmed === true;
}

/** Home is done with the letter-review portion of the workflow. */
export function isLetterWorkflowReady(property: Doc<"properties">): boolean {
  return hasLetterBullets(property) || isNoViolationsConfirmed(property);
}

export function shouldSkipLetterGeneration(property: Doc<"properties">): boolean {
  return isNoViolationsConfirmed(property);
}
