/**
 * Import real-notes/*.docx (2024 owner letter tables) → Convex `priorOwnerLetterNotes2024`.
 *
 * Usage (from repo root):
 *   VITE_CONVEX_URL="https://....convex.cloud" npx tsx scripts/import-real-notes-docx.ts
 *
 * Dry run (no Convex write):
 *   npx tsx scripts/import-real-notes-docx.ts --dry-run
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { parseRealNotesDocx } from "./realNotesDocxParse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const REAL_NOTES_DIR = path.join(REPO_ROOT, "real-notes");

/**
 * Filename stem after "Summer 2024 Inspections - " → `streets.name` from Summer 2025 workbook import.
 * Adjust if a doc fails to match properties.
 */
const DOC_STEM_TO_CONVEX_STREET: Record<string, string> = {
  "Abner Ave": "Abner Ave",
  "Carriage Gate Ct": "Carriage Gate",
  "Flower Box Ct": "Flower Box",
  "Grover Glen Ct": "Grover Glen",
  "Hazelwood Ct": "Hazelwood",
  "Sunflower Ln": "Sunflower",
  "Tiger Lily Ln": "Tiger Lily",
  "Zinnia Ln": "Zinnia",
};

function stemFromFilename(base: string): string | null {
  const m = base.match(/^Summer\s+2024\s+Inspections\s+-\s*(.+)\.docx$/i);
  return m ? m[1].trim() : null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;

  if (!fs.existsSync(REAL_NOTES_DIR)) {
    console.error("Missing directory:", REAL_NOTES_DIR);
    process.exit(1);
  }

  const files = fs
    .readdirSync(REAL_NOTES_DIR)
    .filter((f) => f.endsWith(".docx") && !f.startsWith("~$"));

  type Row = {
    streetName: string;
    houseNumber: number;
    priorOwnerLetterNotes2024: string;
  };
  const allRows: Row[] = [];
  const warnings: string[] = [];

  for (const fname of files.sort()) {
    const stem = stemFromFilename(fname);
    if (!stem) {
      warnings.push(`Skip (unrecognized name pattern): ${fname}`);
      continue;
    }
    const streetName = DOC_STEM_TO_CONVEX_STREET[stem];
    if (!streetName) {
      warnings.push(`No street map for stem "${stem}" (${fname}); add to DOC_STEM_TO_CONVEX_STREET`);
      continue;
    }

    const buf = fs.readFileSync(path.join(REAL_NOTES_DIR, fname));
    const parsed = await parseRealNotesDocx(buf);
    console.log(fname, "→", parsed.length, "rows");
    for (const r of parsed) {
      if (!r.notesMarkdown.trim()) {
        warnings.push(`${fname} #${r.houseNumber}: empty notes`);
      }
      allRows.push({
        streetName,
        houseNumber: r.houseNumber,
        priorOwnerLetterNotes2024: r.notesMarkdown,
      });
    }
  }

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const w of warnings) console.log(" -", w);
  }

  console.log("\nTotal Convex rows:", allRows.length);
  if (dryRun) {
    console.log("Dry run — no mutation.");
    process.exit(0);
  }

  if (!url) {
    console.error("Set VITE_CONVEX_URL or CONVEX_URL to your Convex deployment URL.");
    process.exit(1);
  }

  const client = new ConvexHttpClient(url);
  const result = await client.mutation(api.properties.bulkPatchPriorOwnerLetterNotes2024, {
    rows: allRows,
  });
  console.log("bulkPatchPriorOwnerLetterNotes2024:", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
