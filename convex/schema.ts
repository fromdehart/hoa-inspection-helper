import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  hoas: defineTable({
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"]),

  userHoaMemberships: defineTable({
    clerkUserId: v.string(),
    hoaId: v.id("hoas"),
    role: v.union(v.literal("admin"), v.literal("inspector")),
    email: v.optional(v.string()),
    fullName: v.optional(v.string()),
    invitedByClerkUserId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_hoa", ["hoaId"])
    .index("by_hoa_role", ["hoaId", "role"]),

  streets: defineTable({
    hoaId: v.optional(v.id("hoas")),
    name: v.string(),
    createdAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_hoa_name", ["hoaId", "name"])
    .index("by_hoa", ["hoaId"]),

  properties: defineTable({
    hoaId: v.optional(v.id("hoas")),
    streetId: v.id("streets"),
    address: v.string(),
    houseNumber: v.number(),
    email: v.optional(v.string()),
    homeownerNames: v.optional(v.string()),
    /** "Completed work email from 2024 inspection?" column (often yes/no), not always a real address */
    priorCompletedWorkResponse: v.optional(v.string()),
    status: v.union(
      v.literal("notStarted"),
      v.literal("inProgress"),
      v.literal("complete"),
    ),
    accessToken: v.string(),
    letterSentAt: v.optional(v.number()),
    createdAt: v.number(),
    /** Summer 2025 spreadsheet import metadata (one-time community load) */
    importSheetName: v.optional(v.string()),
    importSourceRow: v.optional(v.number()),
    previousCitations2024: v.optional(v.string()),
    previousFrontObs: v.optional(v.string()),
    previousBackObs: v.optional(v.string()),
    previousInspectorComments: v.optional(v.string()),
    previousInspectionSummary: v.optional(v.string()),
    inspectorNotes: v.optional(v.string()),
    /** Archival text from 2024 owner letters (Word import); not exposed on homeowner portal. */
    priorOwnerLetterNotes2024: v.optional(v.string()),
    /** AI-generated HOA-style bullet list for letters; not exposed on homeowner portal. */
    aiLetterBullets: v.optional(v.string()),
    aiLetterBulletsAt: v.optional(v.number()),
    generatedLetterHtml: v.optional(v.string()),
    generatedLetterAt: v.optional(v.number()),
  })
    .index("by_street", ["streetId"])
    .index("by_hoa_street", ["hoaId", "streetId"])
    .index("by_hoa", ["hoaId"])
    .index("by_token", ["accessToken"])
    .index("by_status", ["status"])
    .index("by_hoa_status", ["hoaId", "status"]),

  photos: defineTable({
    hoaId: v.optional(v.id("hoas")),
    propertyId: v.id("properties"),
    section: v.union(
      v.literal("front"),
      v.literal("side"),
      v.literal("back"),
    ),
    /** Full-resolution image on the upload VPS (set after background upload when using inspector thumb-first flow). */
    filePath: v.optional(v.string()),
    publicUrl: v.optional(v.string()),
    /** Smaller JPEG for lists; inspector uploads set this first, then `publicUrl` when the full file finishes. */
    thumbnailFilePath: v.optional(v.string()),
    thumbnailPublicUrl: v.optional(v.string()),
    uploadedAt: v.number(),
    inspectorNote: v.optional(v.string()),
    analysisStatus: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("error"),
    ),
  })
    .index("by_property", ["propertyId"])
    .index("by_hoa_property", ["hoaId", "propertyId"])
    .index("by_hoa", ["hoaId"]),

  fixPhotos: defineTable({
    hoaId: v.optional(v.id("hoas")),
    propertyId: v.id("properties"),
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
    .index("by_hoa_property", ["hoaId", "propertyId"])
    .index("by_hoa", ["hoaId"]),

  aiConfig: defineTable({
    hoaId: v.optional(v.id("hoas")),
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_hoa_key", ["hoaId", "key"])
    .index("by_hoa", ["hoaId"]),

  templates: defineTable({
    hoaId: v.optional(v.id("hoas")),
    type: v.union(v.literal("report"), v.literal("letter")),
    content: v.string(),
    updatedAt: v.number(),
  })
    .index("by_type", ["type"])
    .index("by_hoa_type", ["hoaId", "type"])
    .index("by_hoa", ["hoaId"]),

  letterTemplateDocs: defineTable({
    hoaId: v.optional(v.id("hoas")),
    fileName: v.string(),
    fileType: v.union(v.literal("docx"), v.literal("pdf")),
    sourcePublicUrl: v.string(),
    sourceFilePath: v.string(),
    parsedText: v.string(),
    /** Admin-editable, tokenized template text (Word/Docs-like plain editor, not HTML). */
    templateText: v.optional(v.string()),
    blocks: v.array(v.object({
      idx: v.number(),
      text: v.string(),
      kind: v.union(v.literal("paragraph"), v.literal("bullet")),
    })),
    detection: v.object({
      date: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientName: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientStreet: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      recipientCityStateZip: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      maintenanceStart: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
      maintenanceEnd: v.optional(v.object({ blockIdx: v.number(), confidence: v.number() })),
    }),
    mapping: v.object({
      date: v.optional(v.number()),
      recipientName: v.optional(v.number()),
      recipientStreet: v.optional(v.number()),
      recipientCityStateZip: v.optional(v.number()),
      maintenanceStart: v.optional(v.number()),
      maintenanceEnd: v.optional(v.number()),
    }),
    status: v.union(v.literal("draft"), v.literal("active")),
    createdAt: v.number(),
    updatedAt: v.number(),
    activatedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_hoa_status", ["hoaId", "status"])
    .index("by_hoa", ["hoaId"]),
});
