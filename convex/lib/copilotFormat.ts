import type { Doc } from "../_generated/dataModel";

/** Human label for a stage key, falling back to the key itself. */
export function stageLabelFromWorkflow(
  workflow: Doc<"caseWorkflows"> | null,
  stageKey: string,
): string {
  return workflow?.stages.find((s) => s.key === stageKey)?.label ?? stageKey;
}
