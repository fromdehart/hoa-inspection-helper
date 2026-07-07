import type { Doc } from "../../convex/_generated/dataModel";
import type { ChipTone } from "@/components/ui/chip";

export type PropertyStatus = Doc<"properties">["status"];

/** Staff chip per inspection status (single source — don't duplicate per page). */
export const PROPERTY_STATUS_CHIP: Record<PropertyStatus, { label: string; tone: ChipTone }> = {
  notStarted: { label: "Not started", tone: "mute" },
  inProgress: { label: "In progress", tone: "wait" },
  review: { label: "Ready to review", tone: "wait" },
  complete: { label: "All clear", tone: "ok" },
};

/** Inspected but no letter sent yet — the "Letters to send" definition. */
export function lettersToSend(p: Pick<Doc<"properties">, "status" | "letterSentAt">): boolean {
  return (p.status === "review" || p.status === "complete") && !p.letterSentAt;
}

/** Split stored aiLetterBullets text into display bullets. */
export function parseFindings(aiLetterBullets: string | undefined): string[] {
  return (aiLetterBullets ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}
