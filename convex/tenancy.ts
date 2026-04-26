import { query } from "./_generated/server";
import { tryGetViewerContext } from "./lib/tenantAuth";

export const viewerContext = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await tryGetViewerContext(ctx);
    if (!viewer) return null;
    const hoa = await ctx.db.get(viewer.hoaId);
    return {
      clerkUserId: viewer.clerkUserId,
      hoaId: viewer.hoaId,
      role: viewer.role,
      hoaName: hoa?.name ?? "",
      hoaSlug: hoa?.slug ?? "",
    };
  },
});

