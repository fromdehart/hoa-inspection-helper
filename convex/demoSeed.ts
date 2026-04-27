import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { buildLetterHtmlSync, DEFAULT_LETTER_TEMPLATE } from "./letterBody";

const DEMO_SLUG = "demo-happier-block";
const DEMO_NAME = "Demo HOA (Happier Block)";
const MIN_PROPERTIES_FOR_SKIP = 12;

const DEMO_STREETS = ["Demo Maple Lane", "Demo Oak Court", "Demo Pine Row"] as const;

const DEMO_AI_CONFIG: Array<{ key: string; value: string }> = [
  {
    key: "violationRules",
    value:
      "Demo HOA rules: keep exteriors tidy, address peeling paint and wood rot promptly, keep walks clear, and store trash cans out of sight except on pickup day.",
  },
  {
    key: "approvedColors",
    value: "Demo palette: warm white trim (#F5F0E6), slate blue siding (#4A6FA5), charcoal shutters (#2F3542).",
  },
  {
    key: "hoaGuidelines",
    value:
      "Demo guidelines: routine maintenance is expected before each inspection cycle; homeowners may reply via the portal link included in letters.",
  },
];

const DEMO_BULLET_SETS = [
  `- Touch up trim paint on front elevation\n- Clear gutters and downspouts\n- Pressure wash walkway`,
  `- Replace loose porch rail fasteners\n- Remove cobwebs from entry light\n- Trim foundation plantings`,
  `- Repair minor wood rot on window sill\n- Clean garage door exterior\n- Reset mailbox post if leaning`,
] as const;

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function requireDemoSeedSecret(provided: string) {
  const expected = process.env.DEMO_SEED_SECRET;
  if (!expected || expected.length < 6) {
    throw new Error(
      "DEMO_SEED_SECRET is not configured on Convex (set a non-empty value; use a long random string on shared deployments).",
    );
  }
  if (!timingSafeEqualString(provided, expected)) {
    throw new Error("Invalid demo seed secret.");
  }
}

async function upsertAdminMembership(
  ctx: MutationCtx,
  args: {
    clerkUserId: string;
    hoaId: Id<"hoas">;
    email: string;
    fullName?: string;
  },
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("userHoaMemberships")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", args.clerkUserId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      hoaId: args.hoaId,
      role: "admin",
      email: args.email,
      fullName: args.fullName,
      invitedByClerkUserId: args.clerkUserId,
      updatedAt: now,
    });
    return { membershipId: existing._id, membershipCreated: false as const };
  }

  const membershipId = await ctx.db.insert("userHoaMemberships", {
    clerkUserId: args.clerkUserId,
    hoaId: args.hoaId,
    role: "admin",
    email: args.email,
    fullName: args.fullName,
    invitedByClerkUserId: args.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  return { membershipId, membershipCreated: true as const };
}

async function ensureHoaTemplates(ctx: MutationCtx, hoaId: Id<"hoas">, now: number) {
  let letterCreated = 0;
  let reportCreated = 0;
  const letter = await ctx.db
    .query("templates")
    .withIndex("by_hoa_type", (q) => q.eq("hoaId", hoaId).eq("type", "letter"))
    .first();
  if (!letter) {
    await ctx.db.insert("templates", {
      hoaId,
      type: "letter",
      content: DEFAULT_LETTER_TEMPLATE,
      updatedAt: now,
    });
    letterCreated++;
  }
  const report = await ctx.db
    .query("templates")
    .withIndex("by_hoa_type", (q) => q.eq("hoaId", hoaId).eq("type", "report"))
    .first();
  if (!report) {
    await ctx.db.insert("templates", {
      hoaId,
      type: "report",
      content: "Demo HOA — inspection summary template (edit in Settings as needed).",
      updatedAt: now,
    });
    reportCreated++;
  }
  return { letterCreated, reportCreated };
}

async function ensureHoaAiConfig(ctx: MutationCtx, hoaId: Id<"hoas">, now: number) {
  let rows = 0;
  for (const { key, value } of DEMO_AI_CONFIG) {
    const existing = await ctx.db
      .query("aiConfig")
      .withIndex("by_hoa_key", (q) => q.eq("hoaId", hoaId).eq("key", key))
      .first();
    if (existing) continue;
    await ctx.db.insert("aiConfig", { hoaId, key, value, updatedAt: now });
    rows++;
  }
  return { aiConfigRowsInserted: rows };
}

async function enrichDemoProperties(ctx: MutationCtx, hoaId: Id<"hoas">, now: number) {
  const templateDoc = await ctx.db
    .query("templates")
    .withIndex("by_hoa_type", (q) => q.eq("hoaId", hoaId).eq("type", "letter"))
    .first();
  const templateContent = templateDoc?.content ?? DEFAULT_LETTER_TEMPLATE;
  const publicBase = process.env.PUBLIC_BASE_URL ?? "http://localhost:5173";

  const props = await ctx.db
    .query("properties")
    .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
    .collect();
  const demo = props.filter((p) => p.address.startsWith("DEMO -"));
  let patched = 0;
  let lettersGenerated = 0;

  for (const [i, p] of demo.entries()) {
    const bullets = DEMO_BULLET_SETS[i % DEMO_BULLET_SETS.length];
    const notes =
      p.status === "complete"
        ? "Demo inspection (complete): exterior walk-through; no structural concerns noted."
        : p.status === "inProgress"
          ? "Demo inspection (in progress): photos captured; finishing notes."
          : "Demo inspection (not started): scheduled for demo walkthrough.";

    const patch: Record<string, unknown> = {};
    if (!p.aiLetterBullets?.trim()) patch.aiLetterBullets = bullets;
    if (!p.inspectorNotes?.trim()) patch.inspectorNotes = notes;

    if (p.status === "complete" && !p.generatedLetterHtml?.trim()) {
      const merged = {
        address: p.address,
        accessToken: p.accessToken,
        recipientName: p.homeownerNames?.trim() || "Demo Homeowner",
        recipientStreet: p.address,
        recipientCityStateZip: "Demo City, ST 12345",
        inspectorNotes: (patch.inspectorNotes as string) || notes,
      };
      const html = buildLetterHtmlSync({
        templateContent,
        property: merged,
        publicBaseUrl: publicBase,
        inspectorFindingsPlain: (patch.inspectorNotes as string) || notes,
        maintenanceItemsPlain: bullets,
      });
      patch.generatedLetterHtml = html;
      patch.generatedLetterAt = now;
      lettersGenerated++;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(p._id, patch);
      patched++;
    }
  }

  const refreshed = await ctx.db
    .query("properties")
    .withIndex("by_hoa", (q) => q.eq("hoaId", hoaId))
    .collect();
  const readyToSend = refreshed
    .filter(
      (p) =>
        p.address.startsWith("DEMO -") &&
        p.status === "complete" &&
        !!p.generatedLetterHtml?.trim() &&
        !p.letterSentAt,
    )
    .sort((a, b) => a.address.localeCompare(b.address));
  let letterMarkedSent = 0;
  if (readyToSend.length > 0) {
    await ctx.db.patch(readyToSend[0]._id, { letterSentAt: now });
    letterMarkedSent = 1;
  }

  return {
    demoPropertyCount: demo.length,
    propertiesPatched: patched,
    lettersGenerated,
    letterMarkedSent,
  };
}

/**
 * Scoped demo data + admin assignment. Protected by Convex env DEMO_SEED_SECRET.
 * Does not touch rows outside the demo HOA (unlike multiHoa backfill).
 */
export const seedDemoHappierBlock = mutation({
  args: {
    secret: v.string(),
    adminClerkUserId: v.string(),
    adminEmail: v.optional(v.string()),
    adminFullName: v.optional(v.string()),
    /** When true, still runs street/property inserts for any missing DEMO addresses even if the HOA already has 12+ rows. */
    forcePopulate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requireDemoSeedSecret(args.secret);

    const now = Date.now();
    let hoa = await ctx.db
      .query("hoas")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .first();

    if (!hoa) {
      const hoaId = await ctx.db.insert("hoas", {
        name: DEMO_NAME,
        slug: DEMO_SLUG,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      hoa = await ctx.db.get(hoaId);
    }
    if (!hoa) throw new Error("Failed to create or load demo HOA.");

    const existingProps = await ctx.db
      .query("properties")
      .withIndex("by_hoa", (q) => q.eq("hoaId", hoa._id))
      .collect();

    let streetsCreated = 0;
    let propertiesCreated = 0;
    let skippedData = false;

    const force = args.forcePopulate === true;
    if (existingProps.length >= MIN_PROPERTIES_FOR_SKIP && !force) {
      skippedData = true;
    } else {
      const streetIds: Id<"streets">[] = [];
      for (const name of DEMO_STREETS) {
        let street = await ctx.db
          .query("streets")
          .withIndex("by_hoa_name", (q) => q.eq("hoaId", hoa._id).eq("name", name))
          .first();
        if (!street) {
          const sid = await ctx.db.insert("streets", {
            hoaId: hoa._id,
            name,
            createdAt: now,
          });
          street = await ctx.db.get(sid);
          streetsCreated++;
        }
        if (!street) continue;
        streetIds.push(street._id);
      }

      const statusCycle = ["notStarted", "inProgress", "complete"] as const;
      let idx = 0;
      for (let s = 0; s < streetIds.length; s++) {
        const streetId = streetIds[s];
        const streetName = DEMO_STREETS[s];
        const houseNumbers = [101, 103, 105, 107, 109];
        for (const houseNumber of houseNumbers) {
          const address = `DEMO - ${houseNumber} ${streetName}`;
          const onStreet = await ctx.db
            .query("properties")
            .withIndex("by_street", (q) => q.eq("streetId", streetId))
            .collect();
          if (onStreet.some((p) => p.address === address)) continue;

          await ctx.db.insert("properties", {
            hoaId: hoa._id,
            streetId,
            address,
            houseNumber,
            email: `demo+${houseNumber}@example.invalid`,
            homeownerNames: `Demo Resident ${houseNumber}`,
            status: statusCycle[idx % statusCycle.length],
            accessToken: crypto.randomUUID(),
            createdAt: now,
          });
          propertiesCreated++;
          idx++;
        }
      }
    }

    const tpl = await ensureHoaTemplates(ctx, hoa._id, now);
    const ai = await ensureHoaAiConfig(ctx, hoa._id, now);
    const enrich = await enrichDemoProperties(ctx, hoa._id, now);

    const email = (args.adminEmail ?? "mdehart.ph@gmail.com").trim().toLowerCase();
    const membership = await upsertAdminMembership(ctx, {
      clerkUserId: args.adminClerkUserId,
      hoaId: hoa._id,
      email,
      fullName: args.adminFullName,
    });

    return {
      hoaId: hoa._id,
      hoaSlug: hoa.slug,
      hoaName: hoa.name,
      skippedData,
      existingPropertyCount: existingProps.length,
      streetsCreated,
      propertiesCreated,
      membership,
      templates: tpl,
      aiConfig: ai,
      enrich,
      warning:
        "If this Clerk user already had another HOA membership, it was moved to the demo HOA (single membership row per user).",
    };
  },
});
