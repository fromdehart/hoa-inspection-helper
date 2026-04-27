import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { parseDocxText } from "./lib/parseDocxText";

/** Parse DOCX bytes for ARC uploads (admin only). PDF text should be extracted in the browser. */
export const parseDocxBase64 = action({
  args: { fileBase64: v.string() },
  handler: async (ctx, args): Promise<{ text: string; error?: string }> => {
    const viewer = await ctx.runQuery(api.tenancy.viewerContext, {});
    if (!viewer || viewer.role !== "admin") {
      return { text: "", error: "Admin access required." };
    }
    try {
      const bin = atob(args.fileBase64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const text = await parseDocxText(arr);
      return { text: text.trim() };
    } catch (e) {
      console.error("parseDocxBase64:", e);
      return { text: "", error: "Failed to parse DOCX." };
    }
  },
});
