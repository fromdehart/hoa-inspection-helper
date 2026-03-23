import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  streets: defineTable({
    name: v.string(),
    createdAt: v.number(),
  }).index("by_name", ["name"]),

  properties: defineTable({
    streetId: v.id("streets"),
    address: v.string(),
    houseNumber: v.number(),
    email: v.optional(v.string()),
    status: v.union(
      v.literal("notStarted"),
      v.literal("inProgress"),
      v.literal("complete"),
    ),
    accessToken: v.string(),
    letterSentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_street", ["streetId"])
    .index("by_token", ["accessToken"])
    .index("by_status", ["status"]),

  photos: defineTable({
    propertyId: v.id("properties"),
    section: v.union(
      v.literal("front"),
      v.literal("side"),
      v.literal("back"),
    ),
    filePath: v.string(),
    publicUrl: v.string(),
    uploadedAt: v.number(),
    inspectorNote: v.optional(v.string()),
    analysisStatus: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("error"),
    ),
  }).index("by_property", ["propertyId"]),

  violations: defineTable({
    propertyId: v.id("properties"),
    photoId: v.optional(v.id("photos")),
    description: v.string(),
    severity: v.optional(v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
    )),
    aiGenerated: v.boolean(),
    adminNote: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("resolved"),
      v.literal("needsReview"),
    ),
    createdAt: v.number(),
  })
    .index("by_property", ["propertyId"])
    .index("by_photo", ["photoId"]),

  fixPhotos: defineTable({
    propertyId: v.id("properties"),
    violationId: v.optional(v.id("violations")),
    filePath: v.string(),
    publicUrl: v.string(),
    uploadedAt: v.number(),
    verificationStatus: v.union(
      v.literal("pending"),
      v.literal("resolved"),
      v.literal("notResolved"),
      v.literal("needsReview"),
    ),
    verificationNote: v.optional(v.string()),
  })
    .index("by_property", ["propertyId"])
    .index("by_violation", ["violationId"]),

  aiConfig: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  templates: defineTable({
    type: v.union(v.literal("report"), v.literal("letter")),
    content: v.string(),
    updatedAt: v.number(),
  }).index("by_type", ["type"]),
});
