import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { letterTemplateVariantValidator, letterTemplateVersionSourceValidator } from "./lib/letterTemplateVariant";
import {
  caseActorRoleValidator,
  caseEventTypeValidator,
  caseEventVisibilityValidator,
  caseSourceValidator,
  caseStatusValidator,
  caseTypeValidator,
  severityValidator,
} from "./lib/caseValidators";

export default defineSchema({
  hoas: defineTable({
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal("active"), v.literal("inactive")),
    /** Per-HOA feature flags (e.g. "cases", "emailIntake"); toggled by platform admins. */
    featureFlags: v.optional(v.array(v.string())),
    /** Management company whose portfolio this HOA belongs to (optional). */
    managementCompanyId: v.optional(v.id("managementCompanies")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_company", ["managementCompanyId"]),

  /** A property-management firm operating a portfolio of HOAs. */
  managementCompanies: defineTable({
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal("active"), v.literal("inactive")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  /** Company staff (one membership row per user, mirroring userHoaMemberships' one-row assumption). */
  companyMemberships: defineTable({
    clerkUserId: v.string(),
    companyId: v.id("managementCompanies"),
    role: v.union(v.literal("owner"), v.literal("manager")),
    fullName: v.optional(v.string()),
    email: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_company", ["companyId"]),

  /**
   * Company manager "acting as" an HOA in their portfolio. Deliberately
   * separate from platformAdminSessions: company acting is re-scoped
   * (hoa.managementCompanyId must match) on every read.
   */
  companySessions: defineTable({
    clerkUserId: v.string(),
    actingHoaId: v.optional(v.id("hoas")),
    updatedAt: v.number(),
  }).index("by_clerk_user", ["clerkUserId"]),

  userHoaMemberships: defineTable({
    clerkUserId: v.string(),
    hoaId: v.id("hoas"),
    role: v.union(v.literal("admin"), v.literal("inspector"), v.literal("board")),
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
    .index("by_property", ["propertyId"])
    .index("by_hoa", ["hoaId"]),

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

  /** Sliding-window rate limit for management-company copilot AI calls. */
  companyAiUsage: defineTable({
    clerkUserId: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index("by_clerk_user", ["clerkUserId"]),

  /**
   * A tracked matter at a household (violation, architectural, maintenance,
   * complaint, inquiry). Many cases per property. The current stage lives in
   * `stageKey` (data-driven ladder); `status` is a derived rollup for cheap
   * filtering. All history is in `caseEvents` (append-only).
   */
  cases: defineTable({
    hoaId: v.id("hoas"),
    propertyId: v.id("properties"),
    caseType: caseTypeValidator,
    /** Optional sub-category (paint, landscaping, parking, …); reuses arcReferenceDocs categories. */
    category: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    severity: v.optional(severityValidator),
    /** Current stage KEY into the workflow ladder for this caseType. */
    stageKey: v.string(),
    status: caseStatusValidator,
    source: caseSourceValidator,
    /** The staff member who owns this case. */
    assignedToClerkUserId: v.optional(v.string()),
    /** Deadline currently governing the case (e.g. cure-period end). Drives SLA queues. */
    actionDueAt: v.optional(v.number()),
    originArcSubmissionId: v.optional(v.id("arcApplicationSubmissions")),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    createdByClerkUserId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_hoa", ["hoaId"])
    .index("by_hoa_property", ["hoaId", "propertyId"])
    .index("by_property", ["propertyId"])
    .index("by_hoa_status", ["hoaId", "status"])
    .index("by_assignee_status", ["assignedToClerkUserId", "status"])
    .index("by_hoa_due", ["hoaId", "actionDueAt"]),

  /**
   * Append-only audit trail. One immutable row per state change; never edited
   * or deleted. Written exclusively via lib/caseEvents.logCaseEvent. Rows with
   * visibility "internal" are hidden from homeowner- and board-facing views.
   */
  caseEvents: defineTable({
    hoaId: v.id("hoas"),
    caseId: v.id("cases"),
    propertyId: v.id("properties"),
    type: caseEventTypeValidator,
    actorClerkUserId: v.optional(v.string()),
    actorRole: caseActorRoleValidator,
    fromStageKey: v.optional(v.string()),
    toStageKey: v.optional(v.string()),
    /** Human-readable line shown in the timeline. */
    summary: v.string(),
    visibility: caseEventVisibilityValidator,
    /** Optional refs to artifacts created by this event. */
    noticeId: v.optional(v.id("notices")),
    hearingId: v.optional(v.id("hearings")),
    fineId: v.optional(v.id("fines")),
    photoId: v.optional(v.id("photos")),
    fixPhotoId: v.optional(v.id("fixPhotos")),
    inboundEmailId: v.optional(v.id("inboundEmails")),
    createdAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_property", ["propertyId"])
    .index("by_hoa", ["hoaId"]),

  /**
   * Per-HOA, per-caseType escalation ladder (due-process steps vary by state
   * and governing docs, so the ladder is data). Seeded from lib/defaultWorkflows.
   */
  caseWorkflows: defineTable({
    hoaId: v.id("hoas"),
    caseType: caseTypeValidator,
    name: v.string(),
    stages: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        statusRollup: caseStatusValidator,
        dueInDays: v.optional(v.number()),
        requiresNotice: v.optional(v.boolean()),
        requiresHearing: v.optional(v.boolean()),
        requiresPhotoEvidence: v.optional(v.boolean()),
        fineAmount: v.optional(v.number()),
        noticeTemplateKey: v.optional(v.string()),
      }),
    ),
    isActive: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_hoa", ["hoaId"])
    .index("by_hoa_type", ["hoaId", "caseType"]),

  /** Generated case correspondence + delivery tracking (stage notices, decision letters). */
  notices: defineTable({
    hoaId: v.id("hoas"),
    caseId: v.id("cases"),
    propertyId: v.id("properties"),
    stageKey: v.string(),
    templateKey: v.optional(v.string()),
    html: v.string(),
    channel: v.union(v.literal("email"), v.literal("portal"), v.literal("mail")),
    deliveryStatus: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    createdByClerkUserId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_hoa", ["hoaId"]),

  /** The "opportunity to be heard" record for a case. */
  hearings: defineTable({
    hoaId: v.id("hoas"),
    caseId: v.id("cases"),
    propertyId: v.id("properties"),
    /** Hearing-notice date (starts the due-process clock). */
    noticeSentAt: v.optional(v.number()),
    scheduledFor: v.number(),
    location: v.optional(v.string()),
    homeownerNotified: v.boolean(),
    outcome: v.optional(
      v.union(
        v.literal("upheld"),
        v.literal("dismissed"),
        v.literal("continued"),
        v.literal("resolved"),
      ),
    ),
    decisionText: v.optional(v.string()),
    decisionLetterNoticeId: v.optional(v.id("notices")),
    decidedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_hoa", ["hoaId"])
    .index("by_hoa_scheduled", ["hoaId", "scheduledFor"]),

  /**
   * Fine assessment + tracking ONLY — no payment processing. Records that a
   * fine was levied, its rule basis, and whether it was waived or satisfied
   * externally. Money movement stays in the firm's accounting system.
   */
  fines: defineTable({
    hoaId: v.id("hoas"),
    caseId: v.id("cases"),
    propertyId: v.id("properties"),
    amount: v.number(),
    reason: v.string(),
    stageKey: v.string(),
    /** Governing-doc/rule reference this fine is based on (defensibility). */
    ruleReference: v.optional(v.string()),
    status: v.union(v.literal("assessed"), v.literal("waived"), v.literal("satisfied")),
    assessedByClerkUserId: v.optional(v.string()),
    assessedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_case", ["caseId"])
    .index("by_hoa", ["hoaId"]),

  /** Raw archive + processing state for inbound case emails (email intake pipeline). */
  inboundEmails: defineTable({
    hoaId: v.optional(v.id("hoas")),
    caseId: v.optional(v.id("cases")),
    propertyId: v.optional(v.id("properties")),
    from: v.string(),
    to: v.string(),
    subject: v.string(),
    textBody: v.string(),
    htmlBody: v.optional(v.string()),
    messageId: v.string(),
    inReplyTo: v.optional(v.string()),
    attachmentsMeta: v.optional(
      v.array(v.object({ fileName: v.string(), contentType: v.string(), size: v.number() })),
    ),
    status: v.union(
      v.literal("received"),
      v.literal("processed"),
      v.literal("quarantined"),
      v.literal("rejected"),
      v.literal("error"),
    ),
    aiSummary: v.optional(v.string()),
    processedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_hoa", ["hoaId"])
    .index("by_case", ["caseId"])
    .index("by_message_id", ["messageId"]),

  /** Explicit per-HOA approved-sender allowlist for email intake (implicit approval also derives from membership/property emails). */
  approvedSenders: defineTable({
    hoaId: v.id("hoas"),
    email: v.string(),
    label: v.optional(v.string()),
    addedByClerkUserId: v.string(),
    createdAt: v.number(),
  })
    .index("by_hoa_email", ["hoaId", "email"])
    .index("by_hoa", ["hoaId"]),

  // ------------------------------------------------------------------
  // The Steward — AI-native board substrate (PRD §8). Gated by the
  // "steward" feature flag; all agent effects land in these tables so the
  // board can audit everything both agents do.
  // ------------------------------------------------------------------

  /**
   * Board decisions as durable records (PRD §8.4). Replaces "Approved."
   * reply chains: a motion is either open with visible votes or closed with
   * an outcome — nothing lives only in an inbox. The Steward may OPEN
   * motions and RECORD concurrence evidence it observes in intake; it never
   * casts votes.
   */
  motions: defineTable({
    hoaId: v.id("hoas"),
    title: v.string(),
    /** What's being decided, in plain words (may cite sources below). */
    context: v.optional(v.string()),
    caseId: v.optional(v.id("cases")),
    inboundEmailId: v.optional(v.id("inboundEmails")),
    proposedByClerkUserId: v.optional(v.string()),
    /** True when the Steward opened this motion (L2, human-approved). */
    proposedByAgent: v.optional(v.boolean()),
    /** How the decision was made — in-app vote vs recorded email/text concurrence vs meeting vote. */
    method: v.union(
      v.literal("in_app"),
      v.literal("email_concurrence"),
      v.literal("text_recorded"),
      v.literal("meeting"),
    ),
    votes: v.array(
      v.object({
        clerkUserId: v.string(),
        vote: v.union(v.literal("yes"), v.literal("no"), v.literal("abstain")),
        at: v.number(),
        /** Evidence link when the vote was recorded from an email. */
        viaInboundEmailId: v.optional(v.id("inboundEmails")),
      }),
    ),
    quorumRequired: v.number(),
    status: v.union(
      v.literal("open"),
      v.literal("passed"),
      v.literal("failed"),
      v.literal("expired"),
    ),
    /** Set once the motion is ratified in meeting minutes. */
    ratifiedNote: v.optional(v.string()),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_hoa_status", ["hoaId", "status"])
    .index("by_hoa", ["hoaId"]),

  /**
   * Compliance calendar (PRD §10 P3, substrate landed early): filings,
   * license renewals, tax estimates, data calls. "verified" requires
   * evidence — absence of alarm is not verification.
   */
  deadlines: defineTable({
    hoaId: v.id("hoas"),
    title: v.string(),
    detail: v.optional(v.string()),
    dueAt: v.number(),
    /** Freeform recurrence note ("annual", "quarterly"); scheduling stays human/agent-driven for now. */
    recurrence: v.optional(v.string()),
    ownerClerkUserId: v.optional(v.string()),
    verificationState: v.union(
      v.literal("unverified"),
      v.literal("verified"),
      v.literal("escalated"),
    ),
    evidenceNote: v.optional(v.string()),
    evidenceInboundEmailId: v.optional(v.id("inboundEmails")),
    verifiedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_hoa_due", ["hoaId", "dueAt"])
    .index("by_hoa_state", ["hoaId", "verificationState"]),

  /** Agenda items accreted across the cycle (PRD §10 meetings assistant; feed for ratification lists). */
  agendaItems: defineTable({
    hoaId: v.id("hoas"),
    title: v.string(),
    detail: v.optional(v.string()),
    sourceCaseId: v.optional(v.id("cases")),
    sourceMotionId: v.optional(v.id("motions")),
    addedByClerkUserId: v.optional(v.string()),
    addedByAgent: v.optional(v.boolean()),
    status: v.union(v.literal("open"), v.literal("scheduled"), v.literal("done")),
    createdAt: v.number(),
  }).index("by_hoa_status", ["hoaId", "status"]),

  /** One row per agent invocation (both agents), whether or not it acted (PRD §8.2). */
  agentRuns: defineTable({
    hoaId: v.id("hoas"),
    agent: v.union(v.literal("steward"), v.literal("reviewer")),
    /** Which duty ran: triage | chase | draft | watch | prep | review | sweep | digest. */
    duty: v.string(),
    /** What woke it: cron name, webhook, or a user action. */
    trigger: v.string(),
    model: v.optional(v.string()),
    status: v.union(v.literal("ok"), v.literal("error")),
    error: v.optional(v.string()),
    actionsCount: v.optional(v.number()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_hoa_started", ["hoaId", "startedAt"])
    .index("by_hoa", ["hoaId"]),

  /**
   * Cross-entity audit log for agent effects (PRD §8.2): every tool call the
   * Steward makes and every verdict the Reviewer issues, linked to whatever
   * records it touched. Append-only by convention — no update/delete API.
   */
  agentActions: defineTable({
    hoaId: v.id("hoas"),
    runId: v.id("agentRuns"),
    toolName: v.string(),
    /** Human-readable one-liner of the arguments (never raw payloads). */
    argsSummary: v.string(),
    autonomyLevel: v.union(
      v.literal("L0"),
      v.literal("L1"),
      v.literal("L2"),
      v.literal("L3"),
    ),
    reviewerVerdict: v.optional(
      v.union(
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("sampled"),
        v.literal("exempt"),
      ),
    ),
    verdictReasons: v.optional(v.string()),
    outcome: v.union(
      v.literal("observed"),
      v.literal("executed"),
      v.literal("queued"),
      v.literal("rejected"),
      v.literal("needs_human"),
    ),
    caseId: v.optional(v.id("cases")),
    propertyId: v.optional(v.id("properties")),
    motionId: v.optional(v.id("motions")),
    deadlineId: v.optional(v.id("deadlines")),
    inboundEmailId: v.optional(v.id("inboundEmails")),
    createdAt: v.number(),
  })
    .index("by_hoa_created", ["hoaId", "createdAt"])
    .index("by_run", ["runId"]),

  /**
   * Per-HOA autonomy ladder settings (PRD §4.2): actionType → "L0".."L3".
   * Unset action types fall back to the conservative defaults in code.
   * Every change to this table is itself logged to agentActions.
   */
  stewardConfig: defineTable({
    hoaId: v.id("hoas"),
    autonomy: v.record(v.string(), v.string()),
    updatedByClerkUserId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_hoa", ["hoaId"]),
});
