import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

type Role = "admin" | "inspector";

function parseMembershipArg(raw: string): { clerkUserId: string; role: Role } {
  const [clerkUserId, roleRaw] = raw.split(":");
  const role = roleRaw === "admin" || roleRaw === "inspector" ? roleRaw : null;
  if (!clerkUserId || !role) {
    throw new Error(`Invalid membership "${raw}". Expected format: <clerkUserId>:admin|inspector`);
  }
  return { clerkUserId, role };
}

async function main() {
  const url = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) {
    throw new Error("Set VITE_CONVEX_URL or CONVEX_URL.");
  }
  const rawMemberships = process.argv.slice(2);
  if (rawMemberships.length === 0) {
    throw new Error("Pass at least one membership: npx tsx scripts/seed-ridge-top-terrace.ts user_123:admin");
  }
  const memberships = rawMemberships.map(parseMembershipArg);
  const client = new ConvexHttpClient(url);
  const result = await client.mutation(api.multiHoa.seedRidgeTopTerraceAndBackfill, {
    hoaName: "Ridge Top Terrace",
    hoaSlug: "ridge-top-terrace",
    memberships,
  });
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

