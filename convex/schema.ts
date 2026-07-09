import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { letterTemplateVariantValidator, letterTemplateVersionSourceValidator } from "./lib/letterTemplateVariant";

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

  /**
   * Homeowner accounts, scoped to a single property (a person may own several →
   * one row per property). Kept separate from userHoaMemberships, which is
   * HOA-scoped and assumes one membership per user. Bootstrapped via the
   * property's accessToken + a Clerk email that matches properties.email.
   */
  propertyMemberships: defineTable({
    clerkUserId: v.string(),
    propertyId: v.id("properties"),
    hoaId: v.optional(v.id("hoas")),
    email: v.optional(v.string()),
    fullName: v.optional(v.string()),
    /** True when the account was created by claiming the emailed portal token. */
    claimedViaToken: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_property", ["propertyId"])
    .index("by_clerk_and_property", ["clerkUserId", "propertyId"]),

  platformAdmins: defineTable({
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    fullName: v.optional(v.string()),
    createdAt: v.number(),
    createdByClerkUserId: v.optional(v.string()),
  }).index("by_clerk_user", ["clerkUserId"]),

  platformAdminSessions: defineTable({
    clerkUserId: v.string(),
    actingHoaId: v.optional(v.id("hoas")),
    updatedAt: v.number(),
  }).index("by_clerk_user", ["clerkUserId"]),

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
      v.literal("review"),
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
    inspectorNotesFront: v.optional(v.string()),
    inspectorNotesSide: v.optional(v.string()),
    inspectorNotesBack: v.optional(v.string()),
    inspectionNotesEnteredAt: v.optional(v.number()),
    inspectionNotesEnteredByClerkUserId: v.optional(v.string()),
    inspectionNotesLastUpdatedByClerkUserId: v.optional(v.string()),
    inspectionNotesLastUpdatedAt: v.optional(v.number()),
    inspectionDetailsVerifiedAt: v.optional(v.number()),
    inspectionDetailsVerifiedByClerkUserId: v.optional(v.string()),
    /** Archival text from 2024 owner letters (Word import); not exposed on homeowner portal. */
    priorOwnerLetterNotes2024: v.optional(v.string()),
    /** AI-generated HOA-style bullet list for letters; not exposed on homeowner portal. */
    aiLetterBullets: v.optional(v.string()),
    aiLetterBulletsAt: v.optional(v.number()),
    generatedLetterHtml: v.optional(v.string()),
    generatedLetterAt: v.optional(v.number()),
    letterPdfUrl: v.optional(v.string()),
    letterPdfFilePath: v.optional(v.string()),
    letterPdfFingerprint: v.optional(v.string()),
    letterPdfRenderedAt: v.optional(v.number()),
    /** Inspector/admin confirmed this home has no violations; uses no-violations letter template. */
    noViolationsConfirmed: v.optional(v.boolean()),
    noViolationsConfirmedAt: v.optional(v.number()),
    noViolationsConfirmedByClerkUserId: v.optional(v.string()),
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

  /** HOA-level rules, guidelines, and example ARC decisions for AI-assisted review. */
  arcReferenceDocs: defineTable({
    hoaId: v.id("hoas"),
    title: v.string(),
    fileName: v.string(),
    fileType: v.union(v.literal("pdf"), v.literal("docx")),
    sourcePublicUrl: v.string(),
    sourceFilePath: v.string(),
    parsedText: v.string(),
    /** Grouping for the homeowner rules library (e.g. paintColors, architectural, landscaping, general). */
    category: v.optional(v.string()),
    /** When true, shown in the homeowner rules library. Undefined is treated as visible. */
    visibleToHomeowners: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_hoa", ["hoaId"]),

  /** Admin-uploaded Architecture Review Committee application packages per property. */
  arcApplicationSubmissions: defineTable({
    hoaId: v.id("hoas"),
    propertyId: v.id("properties"),
    createdAt: v.number(),
    createdByClerkUserId: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("ready"),
      v.literal("reviewing"),
      v.literal("complete"),
      v.literal("error"),
    ),
    files: v.array(
      v.object({
        fileName: v.string(),
        fileType: v.union(v.literal("pdf"), v.literal("docx")),
        sourcePublicUrl: v.string(),
        sourceFilePath: v.string(),
        parsedText: v.string(),
      }),
    ),
    /** True when the homeowner submitted this themselves (vs. admin-uploaded). */
    submittedByHomeowner: v.optional(v.boolean()),
    /** Homeowner-authored request details (homeowner path). */
    projectType: v.optional(v.string()),
    projectDescription: v.optional(v.string()),
    homeownerPhotos: v.optional(
      v.array(v.object({ publicUrl: v.string(), filePath: v.string() })),
    ),
    verdict: v.optional(
      v.union(
        v.literal("likelyApproved"),
        v.literal("needsMoreInformation"),
        v.literal("likelyDenied"),
        v.literal("uncertain"),
      ),
    ),
    /** Structured AI output: { missingInformation, rationale, citationsToRules } plus verdict echo */
    aiFeedbackJson: v.optional(v.string()),
    aiModel: v.optional(v.string()),
    aiReviewAt: v.optional(v.number()),
    aiError: v.optional(v.string()),
    /** True if any document body was truncated before sending to the model */
    promptHadTruncation: v.optional(v.boolean()),
  })
    .index("by_hoa", ["hoaId"])
    .index("by_hoa_property", ["hoaId", "propertyId"]),

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
    variant: v.optional(letterTemplateVariantValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
    activatedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_hoa_status", ["hoaId", "status"])
    .index("by_hoa_status_variant", ["hoaId", "status", "variant"])
    .index("by_hoa", ["hoaId"]),

  letterTemplateVersions: defineTable({
    hoaId: v.id("hoas"),
    templateDocId: v.id("letterTemplateDocs"),
    variant: letterTemplateVariantValidator,
    templateText: v.string(),
    source: letterTemplateVersionSourceValidator,
    savedAt: v.number(),
    savedByClerkUserId: v.optional(v.string()),
    note: v.optional(v.string()),
  })
    .index("by_template_doc", ["templateDocId", "savedAt"])
    .index("by_hoa_variant", ["hoaId", "variant", "savedAt"]),

  /** One AI-chat thread per homeowner+property (grounded in the HOA rules docs). */
  chatConversations: defineTable({
    clerkUserId: v.string(),
    propertyId: v.id("properties"),
    hoaId: v.optional(v.id("hoas")),
    /** OpenAI Responses API id for multi-turn continuity. */
    openaiResponseId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_property", ["clerkUserId", "propertyId"])
    .index("by_property", ["propertyId"]),

  chatMessages: defineTable({
    conversationId: v.id("chatConversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"]),

  /** Sliding-window rate limit for homeowner AI calls (chat + ARC review). */
  homeownerAiUsage: defineTable({
    clerkUserId: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index("by_clerk_user", ["clerkUserId"]),
});
