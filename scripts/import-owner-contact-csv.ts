/**
 * Import RTT owner contact CSV → Convex `properties.homeownerNames`.
 *
 * Usage (from repo root):
 *   VITE_CONVEX_URL="https://....convex.cloud" npx tsx scripts/import-owner-contact-csv.ts
 *
 * Dry run (parse only, no Convex write):
 *   npx tsx scripts/import-owner-contact-csv.ts --dry-run
 *
 * Custom file:
 *   npx tsx scripts/import-owner-contact-csv.ts --file="path/to/owners.csv"
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { parseOwnerContactCsv } from "./ownerContactCsvParse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CSV = path.join(
  REPO_ROOT,
  "RTT Owner Contact List for Mike deHart for Inspection App 06212026.csv",
);

/** Load `.env.local` when keys are unset. */
function loadEnvLocal() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function csvPathFromArgs(): string {
  const fileArg = process.argv.find((a) => a.startsWith("--file="));
  if (fileArg) return path.resolve(fileArg.slice("--file=".length));
  return DEFAULT_CSV;
}

async function main() {
  loadEnvLocal();
  const dryRun = process.argv.includes("--dry-run");
  const csvPath = csvPathFromArgs();
  const url = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  const secret = process.env.DEMO_SEED_SECRET;

  if (!fs.existsSync(csvPath)) {
    console.error("Missing file:", csvPath);
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, "utf8");
  const { rows, warnings } = parseOwnerContactCsv(text);

  console.log("CSV:", csvPath);
  console.log("Parsed rows:", rows.length);

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const w of warnings) console.log(" -", w);
  }

  console.log("\nSample (first 5):");
  for (const row of rows.slice(0, 5)) {
    console.log(`  ${row.streetName} #${row.houseNumber} → ${row.homeownerNames}`);
  }

  const convexRows = rows.map((r) => ({
    streetName: r.streetName,
    houseNumber: r.houseNumber,
    homeownerNames: r.homeownerNames,
  }));

  if (dryRun) {
    console.log("\nDry run — no mutation.");
    process.exit(0);
  }

  if (!url) {
    console.error("Set VITE_CONVEX_URL or CONVEX_URL to your Convex deployment URL.");
    process.exit(1);
  }
  if (!secret) {
    console.error("Set DEMO_SEED_SECRET in .env.local (must match Convex env DEMO_SEED_SECRET).");
    process.exit(1);
  }

  const client = new ConvexHttpClient(url);
  const result = await client.mutation(api.properties.bulkPatchHomeownerNamesWithSecret, {
    secret,
    rows: convexRows,
  });
  console.log("\nbulkPatchHomeownerNames:", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
