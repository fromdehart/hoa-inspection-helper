/**
 * One-time import: Summer 2025 Inspections.xlsx → Convex `properties.bulkUpsertSummer2025`.
 *
 * Usage (from repo root, with Convex dev deployed or prod URL):
 *   VITE_CONVEX_URL="https://....convex.cloud" npx tsx scripts/import-summer-2025.ts
 *
 * Also seeds the default letter template if missing.
 *
 * Upsert key: (street name from sheet tab, houseNumber). Re-run updates spreadsheet-sourced fields.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

// xlsx CJS build — ESM named exports are unreliable under tsx/Node 18
const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as {
  readFile: (path: string) => import("xlsx").WorkBook;
  utils: { sheet_to_json: (sheet: unknown, opts?: object) => unknown[][] };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const XLSX_PATH = path.join(REPO_ROOT, "Summer 2025 Inspections.xlsx");

type SummerRow = {
  streetName: string;
  sourceRow: number;
  address: string;
  houseNumber: number;
  email?: string;
  priorCompletedWorkResponse?: string;
  previousCitations2024?: string;
  previousFrontObs?: string;
  previousBackObs?: string;
  previousInspectorComments?: string;
  previousInspectionSummary?: string;
};

function parseHouseNumber(cell: unknown): number | null {
  if (cell === "" || cell === null || cell === undefined) return null;
  const s = String(cell).trim();
  if (!s) return null;
  const m = s.match(/^(\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function trimCell(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s.length ? s : undefined;
}

function buildSummary(parts: {
  previousFrontObs?: string;
  previousBackObs?: string;
  previousInspectorComments?: string;
  priorCompletedWorkResponse?: string;
}): string | undefined {
  const blocks: string[] = [];
  if (parts.previousFrontObs) blocks.push(`Front (2024): ${parts.previousFrontObs}`);
  if (parts.previousBackObs) blocks.push(`Back (2024): ${parts.previousBackObs}`);
  if (parts.previousInspectorComments) blocks.push(`Comments: ${parts.previousInspectorComments}`);
  if (parts.priorCompletedWorkResponse) blocks.push(`Completed work / email follow-up (2024): ${parts.priorCompletedWorkResponse}`);
  if (blocks.length === 0) return undefined;
  return blocks.join("\n\n");
}

function parseAbner(streetName: string, data: unknown[][]): SummerRow[] {
  const out: SummerRow[] = [];
  for (let i = 2; i < data.length; i++) {
    const row = data[i] as unknown[];
    const hn = parseHouseNumber(row[0]);
    if (hn === null) continue;
    const previousFrontObs = trimCell(row[2]);
    const previousBackObs = trimCell(row[3]);
    const priorCompletedWorkResponse = trimCell(row[4]);
    const previousInspectorComments = trimCell(row[5]);
    out.push({
      streetName,
      sourceRow: i + 1,
      houseNumber: hn,
      address: `${hn} ${streetName}`,
      priorCompletedWorkResponse,
      previousFrontObs,
      previousBackObs,
      previousInspectorComments,
      previousInspectionSummary: buildSummary({
        previousFrontObs,
        previousBackObs,
        previousInspectorComments,
        priorCompletedWorkResponse,
      }),
    });
  }
  return out;
}

function parseCarriageOrFlower(streetName: string, data: unknown[][]): SummerRow[] {
  const out: SummerRow[] = [];
  for (let i = 2; i < data.length; i++) {
    const row = data[i] as unknown[];
    const hn = parseHouseNumber(row[0]);
    if (hn === null) continue;
    const previousFrontObs = trimCell(row[2]);
    const priorCompletedWorkResponse = trimCell(row[3]);
    const previousInspectorComments = trimCell(row[4]);
    out.push({
      streetName,
      sourceRow: i + 1,
      houseNumber: hn,
      address: `${hn} ${streetName}`,
      previousFrontObs,
      priorCompletedWorkResponse,
      previousInspectorComments,
      previousInspectionSummary: buildSummary({
        previousFrontObs,
        previousInspectorComments,
        priorCompletedWorkResponse,
      }),
    });
  }
  return out;
}

function parseStandard(streetName: string, data: unknown[][]): SummerRow[] {
  const out: SummerRow[] = [];
  for (let i = 2; i < data.length; i++) {
    const row = data[i] as unknown[];
    const hn = parseHouseNumber(row[0]);
    if (hn === null) continue;
    const previousFrontObs = trimCell(row[2]);
    const priorCompletedWorkResponse = trimCell(row[3]);
    out.push({
      streetName,
      sourceRow: i + 1,
      houseNumber: hn,
      address: `${hn} ${streetName}`,
      previousFrontObs,
      priorCompletedWorkResponse,
      previousInspectionSummary: buildSummary({
        previousFrontObs,
        priorCompletedWorkResponse,
      }),
    });
  }
  return out;
}

function parseSheet(name: string, data: unknown[][]): SummerRow[] {
  if (name === "Abner Ave") return parseAbner(name, data);
  if (name === "Carriage Gate" || name === "Flower Box") return parseCarriageOrFlower(name, data);
  return parseStandard(name, data);
}

async function main() {
  const url = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    console.error("Set VITE_CONVEX_URL or CONVEX_URL to your Convex deployment URL.");
    process.exit(1);
  }
  if (!fs.existsSync(XLSX_PATH)) {
    console.error("Missing file:", XLSX_PATH);
    process.exit(1);
  }

  const wb = XLSX.readFile(XLSX_PATH);
  const allRows: SummerRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
    const rows = parseSheet(sheetName, data);
    console.log(sheetName, "→", rows.length, "properties");
    allRows.push(...rows);
  }
  console.log("Total rows", allRows.length);

  const client = new ConvexHttpClient(url);
  const seed = await client.mutation(api.templates.seedDefaultLetterIfNeeded, {});
  console.log("Letter template seed:", seed);

  const result = await client.mutation(api.properties.bulkUpsertSummer2025, { rows: allRows });
  console.log("bulkUpsertSummer2025:", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
