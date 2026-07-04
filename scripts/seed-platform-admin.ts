import * as fs from "node:fs";
import * as path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
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

async function main() {
  loadEnvLocal();
  const url = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("Set VITE_CONVEX_URL or CONVEX_URL to your Convex deployment URL.");
  }
  const secret = process.env.PLATFORM_BOOTSTRAP_SECRET;
  if (!secret) {
    throw new Error(
      "Set PLATFORM_BOOTSTRAP_SECRET in your shell (must match Convex env PLATFORM_BOOTSTRAP_SECRET).",
    );
  }

  const argv = process.argv.slice(2);
  const clerkUserId = argv[0];
  if (!clerkUserId) {
    throw new Error("Usage: npm run seed:platform-admin -- <clerkUserId> [email] [fullName]");
  }
  const email = argv[1];
  const fullName = argv[2];

  const client = new ConvexHttpClient(url);
  const result = await client.mutation(api.platform.bootstrapPlatformAdmin, {
    secret,
    clerkUserId,
    ...(email ? { email } : {}),
    ...(fullName ? { fullName } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
