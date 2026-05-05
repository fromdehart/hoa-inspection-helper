import { v } from "convex/values";

/** Shared validator for property workflow status (Convex schema + mutations). */
export const propertyStatusValidator = v.union(
  v.literal("notStarted"),
  v.literal("inProgress"),
  v.literal("review"),
  v.literal("complete"),
);
