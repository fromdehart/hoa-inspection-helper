import { parseHouseNumberFromAddress } from "./realNotesDocxParse";

/** CSV postal suffix → `streets.name` from Summer 2025 workbook import. */
export const CSV_SUFFIX_TO_CONVEX_STREET: Record<string, string> = {
  "Abner Avenue": "Abner Ave",
  "Carriage Gate Court": "Carriage Gate",
  "Flower Box Court": "Flower Box",
  "Grover Glen Court": "Grover Glen",
  "Hazelwood Court": "Hazelwood",
  "Sunflower Lane": "Sunflower",
  "Tiger Lily Lane": "Tiger Lily",
  "Zinnia Lane": "Zinnia",
};

export type OwnerContactRow = {
  homeownerNames: string;
  houseNumber: number;
  streetName: string;
  rawAddress: string;
};

export function parseConvexStreetFromAddress(
  address: string,
): { houseNumber: number; streetName: string } | null {
  const trimmed = address.trim();
  const houseNumber = parseHouseNumberFromAddress(trimmed);
  if (houseNumber === null) return null;

  const suffix = trimmed.replace(/^\d+\s*/, "").trim();
  const streetName = CSV_SUFFIX_TO_CONVEX_STREET[suffix];
  if (!streetName) return null;

  return { houseNumber, streetName };
}

export function parseOwnerContactCsv(text: string): {
  rows: OwnerContactRow[];
  warnings: string[];
} {
  const lines = text.trim().split(/\r?\n/);
  const warnings: string[] = [];
  const rows: OwnerContactRow[] = [];

  if (lines.length < 2) {
    return { rows, warnings: ["CSV has no data rows"] };
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const commaIdx = line.indexOf(",");
    if (commaIdx === -1) {
      warnings.push(`Line ${i + 1}: missing comma separator`);
      continue;
    }

    const homeownerNames = line.slice(0, commaIdx).trim();
    const rawAddress = line.slice(commaIdx + 1).split(",")[0]?.trim() ?? "";

    if (!homeownerNames) {
      warnings.push(`Line ${i + 1}: empty owner name`);
      continue;
    }
    if (!rawAddress) {
      warnings.push(`Line ${i + 1}: empty property address`);
      continue;
    }

    const parsed = parseConvexStreetFromAddress(rawAddress);
    if (!parsed) {
      warnings.push(`Line ${i + 1}: could not parse address "${rawAddress}"`);
      continue;
    }

    rows.push({
      homeownerNames,
      houseNumber: parsed.houseNumber,
      streetName: parsed.streetName,
      rawAddress,
    });
  }

  return { rows, warnings };
}
