import { query } from "./_generated/server";
import { tryGetViewerContext } from "./lib/tenantAuth";
import { isPlatformAdmin } from "./lib/platformAuth";

export const viewerContext = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return null;

    const platformAdmin = await isPlatformAdmin(ctx, identity.subject);
    const viewer = await tryGetViewerContext(ctx);
    if (!viewer) {
      if (platformAdmin) {
        return {
          clerkUserId: identity.subject,
          hoaId: null,
          role: null,
          hoaName: "",
          hoaSlug: "",
          isPlatformAdmin: true,
          isActingAsAdmin: false,
        };
      }
      return null;
    }

    const hoa = await ctx.db.get(viewer.hoaId);
    return {
      clerkUserId: viewer.clerkUserId,
      hoaId: viewer.hoaId,
      role: viewer.role,
      hoaName: hoa?.name ?? "",
      hoaSlug: hoa?.slug ?? "",
      isPlatformAdmin: viewer.isPlatformAdmin,
      isActingAsAdmin: viewer.isActingAsAdmin,
    };
  },
});
