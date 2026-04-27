# Build Plan: Happier Block (HOA inspection app)

## 1. Overview

A mobile-first web application for end-to-end HOA property inspections. Inspectors walk streets
capturing photos via a "Next House" workflow; AI (gpt-4.1-mini vision) analyzes each photo
immediately and surfaces violations in real time. Admins review violations, generate HTML letters,
and send them via Resend. Homeowners receive a unique link to a token-gated portal where they can
view violations with photo evidence and upload proof of fixes, which AI verifies against the original
photo.

**Runtime split:**
- Convex (free plan): all structured data — streets, properties, photos metadata, violations, fix
  photos, AI config, templates. Real-time subscriptions drive live violation updates on the inspector
  UI.
- VPS Express server: receives multipart photo uploads, stores full-size files to disk, serves them
  statically. Convex stores only the public URL reference.
- OpenAI gpt-4.1-mini: per-photo violation detection; before/after fix verification; letter content
  generation.
- Resend: homeowner letter delivery.

---

## 2. File Changes Required

### File: `convex/schema.ts`
- Action: MODIFY
- Purpose: Replace template tables (events, data, votes, leads) with app domain tables.
- Key changes: Define streets, properties, photos, violations, fixPhotos, aiConfig, templates tables
  with all fields and indexes.

### File: `convex/http.ts`
- Action: MODIFY
- Purpose: Remove the illegal `"use node"` directive (httpAction runs in default runtime; "use node"
  is never allowed here) and remove the Telegram webhook route which is not needed.
- Key changes: Delete `"use node"` line at top; remove all Telegram route code; export a minimal
  empty http router.

### File: `src/App.tsx`
- Action: MODIFY
- Purpose: Replace template routing with application routes; remove VoteATron/GateScreen.
- Key changes: Add routes for /, /admin, /admin/dashboard, /admin/settings,
  /admin/property/:propertyId, /inspector, /inspector/streets, /inspector/street/:streetId,
  /inspector/property/:propertyId, /portal/:token.

### File: `convex/leads.ts`
- Action: DELETE
- Purpose: Not used in this application.

### File: `convex/votes.ts`
- Action: DELETE
- Purpose: Not used in this application.

### File: `convex/tracking.ts`
- Action: DELETE
- Purpose: Not used in this application.

### File: `convex/telegram.ts`
- Action: DELETE
- Purpose: Not used in this application.

### File: `convex/telegramClient.ts`
- Action: DELETE
- Purpose: Not used in this application.

### File: `src/pages/Index.tsx`
- Action: DELETE
- Purpose: Replaced by Landing.tsx and the admin/inspector/portal pages.

### File: `src/components/GateScreen.tsx`
- Action: DELETE
- Purpose: Replaced by role-specific gate pages (AdminGate, InspectorGate).

### File: `src/components/ShareButtons.tsx`
- Action: DELETE
- Purpose: Not used in this application.

### File: `convex/aiConfig.ts`
- Action: CREATE
- Purpose: Store and retrieve the three admin-configurable AI prompt inputs.
- Key changes: New file with `getAll` query, `getAllInternal` internalQuery, and `set` mutation.

### File: `convex/templates.ts`
- Action: CREATE
- Purpose: Store admin-editable report and letter HTML templates.
- Key changes: New file with `get` query and `set` mutation.

### File: `convex/streets.ts`
- Action: CREATE
- Purpose: Street-level queries used by inspector navigation and admin dashboard.
- Key changes: New file with `list` query (with property counts) and `getWithProperties` query
  (returns sorted property list).

### File: `convex/properties.ts`
- Action: CREATE
- Purpose: Property CRUD, CSV import, status management, homeowner token lookup.
- Key changes: New file with list, get, getByToken queries; importFromCSV, updateStatus,
  updateEmail, markLetterSent mutations.

### File: `convex/photos.ts`
- Action: CREATE
- Purpose: Photo metadata CRUD; schedules AI analysis on creation; updates property status to
  inProgress.
- Key changes: New file with listByProperty query, getById internalQuery, create and updateNote
  mutations, updateAnalysisStatus internalMutation.

### File: `convex/violations.ts`
- Action: CREATE
- Purpose: Violation CRUD for both AI-generated and admin-created violations.
- Key changes: New file with listByProperty query, getById internalQuery; create internalMutation
  (called by AI action); createPublic mutation (admin); update and remove mutations.

### File: `convex/fixPhotos.ts`
- Action: CREATE
- Purpose: Homeowner fix photo records; schedules AI before/after verification on creation.
- Key changes: New file with listByProperty query, getById internalQuery, create mutation,
  updateVerification internalMutation.

### File: `convex/ai.ts`
- Action: CREATE
- Purpose: All AI actions — per-photo violation analysis and before/after fix verification. Uses
  fetch to call OpenAI Chat Completions API; no "use node" needed since fetch is available in the
  default runtime.
- Key changes: New file exporting analyzePhoto and verifyFix internalActions.

### File: `convex/letters.ts`
- Action: CREATE
- Purpose: Letter generation (OpenAI-assisted template fill) and email delivery (Resend).
- Key changes: New file exporting generate and send actions; no "use node" needed — uses fetch for
  OpenAI and ctx.runAction for Resend.

### File: `server/package.json`
- Action: CREATE
- Purpose: Dependencies for the VPS upload server (Express + Multer).

### File: `server/index.js`
- Action: CREATE
- Purpose: Express server that receives multipart photo uploads, writes files to disk, and serves
  them statically. Runs as a separate process on the VPS (or on port 3001 locally).

### File: `src/lib/uploadClient.ts`
- Action: CREATE
- Purpose: Client utility to POST a photo to the VPS upload server and return { publicUrl, filePath }.

### File: `src/pages/Landing.tsx`
- Action: CREATE
- Purpose: Root page; two large buttons: "Admin Login" and "Inspector Login".

### File: `src/pages/admin/AdminGate.tsx`
- Action: CREATE
- Purpose: Password gate for admin area. Checks input against VITE_ADMIN_PASSWORD; stores
  `hoa_admin` in localStorage on success; redirects to /admin/dashboard.

### File: `src/pages/admin/Dashboard.tsx`
- Action: CREATE
- Purpose: Admin property overview with CSV import, status filter, and link to each property review.

### File: `src/pages/admin/Settings.tsx`
- Action: CREATE
- Purpose: AI config textareas (violation rules, approved colors, HOA guidelines) with auto-save
  on blur; letter and report template HTML editors with explicit Save.

### File: `src/pages/admin/PropertyReview.tsx`
- Action: CREATE
- Purpose: Shows all photos (grouped by section) and violations for a property; admin can
  edit/delete violations, add violations manually, set homeowner email, generate letter HTML preview,
  and send letter via Resend.

### File: `src/pages/inspector/InspectorGate.tsx`
- Action: CREATE
- Purpose: Password gate for inspector area. Same pattern as AdminGate but stores `hoa_inspector`
  and redirects to /inspector/streets.

### File: `src/pages/inspector/StreetList.tsx`
- Action: CREATE
- Purpose: Lists all streets with property count and completion status (e.g., "4/12 complete").

### File: `src/pages/inspector/PropertyList.tsx`
- Action: CREATE
- Purpose: Shows all properties on a street in walk order (odds ascending then evens descending)
  with colored status dots. "Start Walk" button navigates to first notStarted property.

### File: `src/pages/inspector/PropertyCapture.tsx`
- Action: CREATE
- Purpose: Core inspector UI — section tabs, camera capture per section, real-time AI violation
  display, per-photo notes with optional speech-to-text, Next House button.

### File: `src/pages/portal/HomeownerPortal.tsx`
- Action: CREATE
- Purpose: Token-gated homeowner view — violations with evidence photos, fix photo upload per
  violation, AI before/after verification status display.

### File: `.env.local.example`
- Action: CREATE
- Purpose: Documents all required environment variables with placeholder values.

---

## 3. Convex Schema Changes

Replace the entire schema with the following:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  streets: defineTable({
    name: v.string(),       // e.g. "Elm Street"
    createdAt: v.number(),
  }).index("by_name", ["name"]),

  properties: defineTable({
    streetId: v.id("streets"),
    address: v.string(),           // "123 Elm Street"
    houseNumber: v.number(),       // numeric part for walk-order sorting
    email: v.optional(v.string()), // homeowner email
    status: v.union(
      v.literal("notStarted"),
      v.literal("inProgress"),
      v.literal("complete"),
    ),
    accessToken: v.string(),       // UUID for homeowner portal URL
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
    filePath: v.string(),          // relative path on VPS
    publicUrl: v.string(),         // full URL served by nginx/express
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
    key: v.string(),    // "violationRules" | "approvedColors" | "hoaGuidelines"
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  templates: defineTable({
    type: v.union(v.literal("report"), v.literal("letter")),
    content: v.string(),  // HTML with {{address}}, {{violations}}, {{portalLink}}, {{date}}
    updatedAt: v.number(),
  }).index("by_type", ["type"]),
});
```

---

## 4. Convex Functions

### aiConfig/getAll (query)
- Purpose: Return all three AI config values as a single object for the admin settings UI.
- Args: none
- Returns: `{ violationRules: string, approvedColors: string, hoaGuidelines: string }`
- Logic: Query aiConfig table for keys "violationRules", "approvedColors", "hoaGuidelines" via
  the by_key index. Return empty string for any missing key.

### aiConfig/getAllInternal (internalQuery)
- Purpose: Same as getAll but callable from Convex actions (analyzePhoto, verifyFix).
- Args: none
- Returns: `{ violationRules: string, approvedColors: string, hoaGuidelines: string }`
- Logic: Identical to getAll.

### aiConfig/set (mutation)
- Purpose: Upsert a single AI config value.
- Args: `{ key: string, value: string }`
- Returns: null
- Logic: Look up existing doc by by_key index. If found, patch value + updatedAt: Date.now().
  If not found, insert new doc with key, value, updatedAt: Date.now().

---

### templates/get (query)
- Purpose: Retrieve a template by type for editor pre-fill or letter generation.
- Args: `{ type: "report" | "letter" }`
- Returns: `{ content: string } | null`
- Logic: Query by_type index; return first result or null.

### templates/set (mutation)
- Purpose: Upsert a template.
- Args: `{ type: "report" | "letter", content: string }`
- Returns: null
- Logic: Look up existing by type. If found, patch content + updatedAt. If not found, insert.

---

### streets/list (query)
- Purpose: List all streets with per-street property counts and completion stats for the
  inspector's street list and admin dashboard.
- Args: none
- Returns: `Array<{ _id: Id<"streets">, name: string, total: number, complete: number }>`
- Logic: Fetch all streets via ctx.db.query("streets").collect(). For each, collect all
  properties by by_street index; count total and those with status "complete". Return sorted
  by name ascending.

### streets/getWithProperties (query)
- Purpose: Return a single street and its properties sorted in walk order (odds ascending, then
  evens descending — matching one-side-then-the-other walking pattern).
- Args: `{ streetId: Id<"streets"> }`
- Returns: `{ street: street doc, properties: Array<property doc> }`
- Logic: Fetch street. Collect all properties via by_street index. Separate into odd-numbered
  (houseNumber % 2 !== 0) and even-numbered (houseNumber % 2 === 0) arrays. Sort odds ascending
  by houseNumber; sort evens descending by houseNumber. Return street + [...odds, ...evens].

---

### properties/list (query)
- Purpose: Filterable property list for admin dashboard.
- Args: `{ streetId?: Id<"streets">, status?: "notStarted" | "inProgress" | "complete" }`
- Returns: `Array<property doc>`
- Logic: If streetId provided, use by_street index; otherwise ctx.db.query("properties").collect().
  Filter by status if provided. Sort by address ascending.

### properties/get (query)
- Purpose: Single property lookup for review and capture pages.
- Args: `{ id: Id<"properties"> }`
- Returns: property doc or null
- Logic: ctx.db.get(id).

### properties/getByToken (query)
- Purpose: Homeowner portal lookup by UUID access token. Returns property without the
  accessToken field exposed (return only safe fields).
- Args: `{ token: string }`
- Returns: `{ _id, address, email, status, streetId, houseNumber, letterSentAt } | null`
- Logic: Query by_token index; if found, return doc with accessToken omitted via destructuring.

### properties/importFromCSV (mutation)
- Purpose: Bulk-create streets and properties from client-parsed CSV rows.
- Args: `{ rows: Array<{ address: string, streetName: string, houseNumber: number, email?: string }> }`
- Returns: `{ created: number, skipped: number }`
- Logic: For each row:
  1. Find or create street: query by_name index for streetName; if not found, insert new street
     with createdAt: Date.now().
  2. Check for duplicate: collect properties for that streetId; check if any has same address.
     If duplicate, increment skipped and continue.
  3. Insert property: address, streetId, houseNumber, email (if provided), status: "notStarted",
     accessToken: crypto.randomUUID(), createdAt: Date.now().
  4. Increment created.
  Return { created, skipped }.

### properties/updateStatus (mutation)
- Purpose: Inspector sets status as inProgress or complete.
- Args: `{ id: Id<"properties">, status: "notStarted" | "inProgress" | "complete" }`
- Returns: null
- Logic: ctx.db.patch(id, { status }).

### properties/updateEmail (mutation)
- Purpose: Admin sets or corrects homeowner email before sending letter.
- Args: `{ id: Id<"properties">, email: string }`
- Returns: null
- Logic: ctx.db.patch(id, { email }).

### properties/markLetterSent (internalMutation)
- Purpose: Record that a letter has been sent; called by letters/send action on success.
- Args: `{ id: Id<"properties"> }`
- Returns: null
- Logic: ctx.db.patch(id, { letterSentAt: Date.now() }).

---

### photos/listByProperty (query)
- Purpose: Real-time photo list for inspector capture UI and admin review; used by Convex
  subscription to push AI analysisStatus updates to inspector while still on-site.
- Args: `{ propertyId: Id<"properties"> }`
- Returns: `Array<photo doc>` sorted by uploadedAt ascending.
- Logic: Query by_property index; collect and sort.

### photos/getById (internalQuery)
- Purpose: Fetch a single photo record for the AI analysis action.
- Args: `{ id: Id<"photos"> }`
- Returns: photo doc or null
- Logic: ctx.db.get(id).

### photos/create (mutation)
- Purpose: Record a newly uploaded photo; schedule AI analysis; promote property status to
  inProgress if it was notStarted.
- Args: `{ propertyId: Id<"properties">, section: "front" | "side" | "back", filePath: string, publicUrl: string }`
- Returns: `Id<"photos">`
- Logic:
  1. Insert photo with analysisStatus: "pending", uploadedAt: Date.now().
  2. Fetch property; if property.status === "notStarted", patch to "inProgress".
  3. ctx.scheduler.runAfter(0, internal.ai.analyzePhoto, { photoId }).
  4. Return photoId.

### photos/updateNote (mutation)
- Purpose: Inspector attaches or edits a text note (or speech-to-text transcript) on a photo.
- Args: `{ id: Id<"photos">, note: string }`
- Returns: null
- Logic: ctx.db.patch(id, { inspectorNote: note }).

### photos/updateAnalysisStatus (internalMutation)
- Purpose: Called only by the AI action to track processing state; never called from client.
- Args: `{ id: Id<"photos">, status: "processing" | "done" | "error" }`
- Returns: null
- Logic: ctx.db.patch(id, { analysisStatus: status }).

---

### violations/listByProperty (query)
- Purpose: Real-time violation list; real-time subscription in PropertyCapture surfaces new AI
  findings as they arrive while inspector is still on-site.
- Args: `{ propertyId: Id<"properties"> }`
- Returns: `Array<violation doc>` sorted by createdAt ascending.

### violations/getById (internalQuery)
- Purpose: Fetch a single violation for the AI verifyFix action to retrieve the original photo.
- Args: `{ id: Id<"violations"> }`
- Returns: violation doc or null
- Logic: ctx.db.get(id).

### violations/create (internalMutation)
- Purpose: Store a violation found by AI; never called from client.
- Args: `{ propertyId: Id<"properties">, photoId: Id<"photos">, description: string, severity: "low" | "medium" | "high" }`
- Returns: `Id<"violations">`
- Logic: Insert with aiGenerated: true, status: "open", createdAt: Date.now().

### violations/createPublic (mutation)
- Purpose: Admin manually adds a violation not caught by AI.
- Args: `{ propertyId: Id<"properties">, photoId?: Id<"photos">, description: string, severity?: "low" | "medium" | "high" }`
- Returns: `Id<"violations">`
- Logic: Insert with aiGenerated: false, status: "open", createdAt: Date.now().

### violations/update (mutation)
- Purpose: Admin edits violation description, severity, note, or status.
- Args: `{ id: Id<"violations">, description?: string, severity?: "low" | "medium" | "high", adminNote?: string, status?: "open" | "resolved" | "needsReview" }`
- Returns: null
- Logic: Build patch object from only the defined args fields. ctx.db.patch(id, patch).

### violations/remove (mutation)
- Purpose: Admin deletes a violation (e.g., confirmed false positive).
- Args: `{ id: Id<"violations"> }`
- Returns: null
- Logic: ctx.db.delete(id).

---

### fixPhotos/listByProperty (query)
- Purpose: Show fix photos with verification status on homeowner portal and admin review page.
- Args: `{ propertyId: Id<"properties"> }`
- Returns: `Array<fixPhoto doc>` sorted by uploadedAt ascending.

### fixPhotos/getById (internalQuery)
- Purpose: Fetch fix photo record for AI verification action.
- Args: `{ id: Id<"fixPhotos"> }`
- Returns: fixPhoto doc or null
- Logic: ctx.db.get(id).

### fixPhotos/create (mutation)
- Purpose: Record a homeowner-uploaded fix photo; schedule AI before/after verification.
- Args: `{ propertyId: Id<"properties">, violationId?: Id<"violations">, filePath: string, publicUrl: string }`
- Returns: `Id<"fixPhotos">`
- Logic:
  1. Insert fixPhoto with verificationStatus: "pending", uploadedAt: Date.now().
  2. ctx.scheduler.runAfter(0, internal.ai.verifyFix, { fixPhotoId }).
  3. Return fixPhotoId.

### fixPhotos/updateVerification (internalMutation)
- Purpose: Store AI before/after verdict; called only by verifyFix action.
- Args: `{ id: Id<"fixPhotos">, status: "resolved" | "notResolved" | "needsReview", note: string }`
- Returns: null
- Logic: ctx.db.patch(id, { verificationStatus: status, verificationNote: note }).

---

### ai/analyzePhoto (internalAction)
- Purpose: Call OpenAI gpt-4.1-mini vision on a photo URL; store resulting violations; update
  photo analysis status. NO "use node" directive — fetch is available in default runtime.
- Args: `{ photoId: Id<"photos"> }`
- Returns: void
- Logic:
  1. `await ctx.runMutation(internal.photos.updateAnalysisStatus, { id: photoId, status: "processing" })`
  2. `const photo = await ctx.runQuery(internal.photos.getById, { id: photoId })`
     If null, return early.
  3. `const config = await ctx.runQuery(internal.aiConfig.getAllInternal)`
  4. Build prompt string:
     ```
     You are an HOA compliance inspector reviewing a property exterior photo.
     Violation Rules: {config.violationRules || "Standard HOA rules apply."}
     Approved Colors: {config.approvedColors || "No specific color restrictions."}
     HOA Guidelines: {config.hoaGuidelines || "Standard guidelines apply."}

     Analyze this photo carefully for any HOA violations. Return a JSON object with a single
     key "violations" containing an array of objects. Each object must have:
       - description: string (clear description of the violation)
       - severity: "low" | "medium" | "high"
     If there are no violations, return {"violations": []}.
     ```
  5. Fetch OpenAI:
     ```
     POST https://api.openai.com/v1/chat/completions
     Authorization: Bearer {process.env.OPENAI_API_KEY}
     Content-Type: application/json
     {
       "model": "gpt-4.1-mini",
       "messages": [{
         "role": "user",
         "content": [
           { "type": "image_url", "image_url": { "url": photo.publicUrl } },
           { "type": "text", "text": promptString }
         ]
       }],
       "response_format": { "type": "json_object" },
       "max_tokens": 1000
     }
     ```
  6. Parse response: `data.choices[0].message.content` → JSON.parse → `.violations` array.
  7. For each violation in array:
     `await ctx.runMutation(internal.violations.create, { propertyId: photo.propertyId, photoId, description: v.description, severity: v.severity })`
  8. `await ctx.runMutation(internal.photos.updateAnalysisStatus, { id: photoId, status: "done" })`
  9. Wrap steps 2–8 in try/catch: on error, log + `ctx.runMutation(internal.photos.updateAnalysisStatus, { id: photoId, status: "error" })`.

### ai/verifyFix (internalAction)
- Purpose: Compare the original violation photo (before) with the homeowner's fix photo (after)
  using OpenAI vision; store resolved/notResolved/needsReview verdict. NO "use node" directive.
- Args: `{ fixPhotoId: Id<"fixPhotos"> }`
- Returns: void
- Logic:
  1. `const fixPhoto = await ctx.runQuery(internal.fixPhotos.getById, { id: fixPhotoId })`
     If null, return early.
  2. Build content array starting with the fix photo URL.
  3. If fixPhoto.violationId is set:
     `const violation = await ctx.runQuery(internal.violations.getById, { id: fixPhoto.violationId })`
     If violation has a photoId:
     `const beforePhoto = await ctx.runQuery(internal.photos.getById, { id: violation.photoId })`
     Prepend beforePhoto.publicUrl to content array as first image.
  4. Build prompt:
     ```
     You are verifying an HOA violation fix.
     {if violation: "The original violation was: " + violation.description}
     {if beforePhoto: "The first image is the BEFORE photo showing the violation."}
     The {if beforePhoto: "second" else: "only"} image is the AFTER photo submitted by the homeowner.
     Return JSON: { "status": "resolved" | "notResolved" | "needsReview", "note": "<brief explanation>" }
     - resolved: violation is clearly corrected
     - notResolved: violation is clearly still present
     - needsReview: ambiguous, poor photo quality, or cannot determine
     ```
  5. Fetch OpenAI Chat Completions with content array (1 or 2 image_url items + text item).
  6. Parse response JSON for status and note.
  7. `await ctx.runMutation(internal.fixPhotos.updateVerification, { id: fixPhotoId, status, note })`
  8. On any error: `ctx.runMutation(internal.fixPhotos.updateVerification, { id: fixPhotoId, status: "needsReview", note: "AI verification failed; please review manually." })`

---

### letters/generate (action)
- Purpose: Render a complete HTML letter for a property using the admin letter template and an
  OpenAI-generated formal violation summary. Returns HTML string for admin preview. NO "use node".
- Args: `{ propertyId: Id<"properties"> }`
- Returns: `{ html: string }`
- Logic:
  1. `const property = await ctx.runQuery(api.properties.get, { id: args.propertyId })`
     If null or no violations, return minimal HTML.
  2. `const violations = await ctx.runQuery(api.violations.listByProperty, { propertyId: args.propertyId })`
     Filter to status "open" only.
  3. `const templateDoc = await ctx.runQuery(api.templates.get, { type: "letter" })`
     Use fallback template if null (see note below).
  4. Build numbered violation list text:
     `violations.map((v, i) => `${i+1}. [${v.severity?.toUpperCase() ?? "N/A"}] ${v.description}`).join("\n")`
  5. Call OpenAI text completion (fetch, no vision) with model gpt-4.1-mini:
     Prompt: "Rewrite the following HOA violations as formal, concise paragraphs for an official
     letter. Use professional language. Violations:\n{violationListText}"
  6. Get `process.env.PUBLIC_BASE_URL` (default "http://localhost:5173" if missing).
  7. Build portalLink: `${PUBLIC_BASE_URL}/portal/${property.accessToken}`
     (Note: property.accessToken is available server-side; not exposed to client via getByToken.)
     To get accessToken: use `ctx.db.get(propertyId)` directly inside the action (or add an
     internal query). Since this is an action and can call ctx.runQuery on internal queries,
     add `properties/getInternal (internalQuery)` returning the full property doc including
     accessToken.
  8. Template substitution on templateDoc.content (or fallback):
     Replace `{{address}}` → property.address
     Replace `{{violations}}` → AI-generated formal paragraphs (wrap in `<p>` tags)
     Replace `{{portalLink}}` → `<a href="${portalLink}">${portalLink}</a>`
     Replace `{{date}}` → new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
  9. Return `{ html: substitutedContent }`.

  Fallback template (used when no template has been saved):
  ```html
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>HOA Inspection Notice</h2>
    <p>Date: {{date}}</p>
    <p>Property: {{address}}</p>
    <h3>Violations Found</h3>
    {{violations}}
    <p>Please submit proof of corrections at: {{portalLink}}</p>
    <p>Thank you for your cooperation.</p>
  </div>
  ```

  Add `properties/getInternal (internalQuery)` to properties.ts:
  - Args: `{ id: Id<"properties"> }` → full property doc or null (including accessToken).
  - Called from letters/generate to get the accessToken for the portal link.

### letters/send (action)
- Purpose: Send the rendered letter HTML to the homeowner via Resend; record send timestamp.
  NO "use node" — delegates email delivery to the existing resend.sendEmail action.
- Args: `{ propertyId: Id<"properties">, html: string }`
- Returns: `{ success: boolean, error?: string }`
- Logic:
  1. `const property = await ctx.runQuery(api.properties.get, { id: args.propertyId })`
  2. If !property?.email: return `{ success: false, error: "No homeowner email on record" }`
  3. `const result = await ctx.runAction(api.resend.sendEmail, { to: property.email, subject: "HOA Inspection Notice — " + property.address, html: args.html })`
  4. If result.success: `await ctx.runMutation(internal.properties.markLetterSent, { id: args.propertyId })`
  5. Return result.

---

## 5. React Components & Pages

### Landing
- File: `src/pages/Landing.tsx`
- Props: none
- State: none
- Behavior: Check localStorage for existing roles on mount; show quick-access links if already
  logged in. Otherwise show role selection.
- Key UI: Full-height centered layout (`flex flex-col items-center justify-center min-h-screen gap-8`).
  App title "Happier Block". Marketing landing + sign-in CTAs. Two large buttons
  using existing Button component: "Admin Login" → navigate("/admin"), "Inspector Login" →
  navigate("/inspector"). If localStorage has "hoa_admin"="true", show "Admin Dashboard →" link.
  If "hoa_inspector"="true", show "Inspector Streets →" link.

### AdminGate
- File: `src/pages/admin/AdminGate.tsx`
- Props: none
- State: `password: string`, `error: string`
- Behavior: On mount, if `localStorage.getItem("hoa_admin") === "true"`, immediately
  `navigate("/admin/dashboard", { replace: true })`. On form submit: if password ===
  `import.meta.env.VITE_ADMIN_PASSWORD`, set localStorage + navigate; else set error message.
- Key UI: Centered Card (max-w-sm) with title "Admin Login", password Input (type="password"),
  error text in red if error, "Enter" Button. Back link to /.

### InspectorGate
- File: `src/pages/inspector/InspectorGate.tsx`
- Props: none
- State: `password: string`, `error: string`
- Behavior: Identical pattern to AdminGate but key `hoa_inspector`, env var
  `VITE_INSPECTOR_PASSWORD`, redirect to `/inspector/streets`.
- Key UI: Same as AdminGate with "Inspector Login" title.

### Dashboard
- File: `src/pages/admin/Dashboard.tsx`
- Props: none
- State: `statusFilter: "all" | "notStarted" | "inProgress" | "complete"`,
  `search: string`, `csvUploading: boolean`
- Behavior:
  - On mount: if localStorage "hoa_admin" !== "true", navigate("/admin").
  - Data: `useQuery(api.properties.list, { status: statusFilter === "all" ? undefined : statusFilter })`.
  - `useQuery(api.streets.list)` for street name lookups.
  - CSV import: hidden file input (accept=".csv"); on change, read with FileReader.readAsText;
    parse with inline CSV parser (split lines, split commas, map to { address, streetName,
    houseNumber, email } using case-insensitive column header matching); call
    `useMutation(api.properties.importFromCSV)` with parsed rows array; show result toast.
    CSV column format: `address`, `street`, `houseNumber`, `email` (email optional).
  - Filter tabs: All / Not Started / In Progress / Complete — update statusFilter state.
  - Search: filter displayed rows client-side by address.includes(search.toLowerCase()).
  - Click property row: navigate to /admin/property/:id.
  - "Settings" top-right nav link → /admin/settings.
  - "Logout": clear localStorage keys, navigate("/").
- Key UI: Top nav bar (title + Settings link + Logout). Filter tab row (4 tabs). Search input.
  "Import CSV" button. Property table: Address | Street | Status | Action columns. Status rendered
  as Badge ("Not Started"=gray, "In Progress"=yellow, "Complete"=green). "Review" button per row.

### Settings
- File: `src/pages/admin/Settings.tsx`
- Props: none
- State: `rules: string`, `colors: string`, `guidelines: string`, `reportTpl: string`,
  `letterTpl: string`, `saved: { [key: string]: boolean }`
- Behavior:
  - Auth check on mount.
  - Load: `useQuery(api.aiConfig.getAll)`, `useQuery(api.templates.get, { type: "letter" })`,
    `useQuery(api.templates.get, { type: "report" })`. Populate local state from query results
    using useEffect when data arrives.
  - AI Config: three Textareas, one each for violationRules, approvedColors, hoaGuidelines.
    On blur of each: call `useMutation(api.aiConfig.set)` with the corresponding key + current
    value; show brief "✓ Saved" next to the field for 2 seconds (set `saved[key]=true`, then
    setTimeout to clear).
  - Templates: Tabs component ("Letter Template" | "Report Template"). Each tab shows a Textarea
    (rows=20) with the template content. Below each: a "Save Template" Button that calls
    `useMutation(api.templates.set)`.
  - Back link to /admin/dashboard.
- Key UI: max-w-3xl mx-auto px-4 py-6. Section headers. Auto-save badge per field. Template
  textarea with monospace font. Variables reference hint: `Available: {{address}} {{violations}}
  {{portalLink}} {{date}}`.

### PropertyReview
- File: `src/pages/admin/PropertyReview.tsx`
- Props: none (reads propertyId from useParams)
- State: `emailInput: string`, `letterHtml: string | null`, `showPreview: boolean`,
  `generating: boolean`, `sending: boolean`, `addingViolation: boolean`,
  `newViolDesc: string`, `newViolSeverity: "low" | "medium" | "high"`
- Behavior:
  - Auth check on mount.
  - `useQuery(api.properties.get, { id: propertyId })` — property data.
  - `useQuery(api.photos.listByProperty, { propertyId })` — grouped by section.
  - `useQuery(api.violations.listByProperty, { propertyId })` — real-time violation list.
  - `useQuery(api.fixPhotos.listByProperty, { propertyId })` — fix photos per violation.
  - Email field: Input pre-filled with property.email. "Save Email" button calls updateEmail.
  - Photos: Tabs for Front / Side / Back. Within each tab, photo grid (3-column on desktop,
    2-column on mobile) with img thumbnails. Clicking thumbnail opens full-size in new tab.
    analysisStatus badge on each thumbnail (pending=gray spinner, processing=blue spinner,
    done=green check, error=red X).
  - Violations list: each card shows description (editable inline textarea on click), severity
    Badge (colored), AI/Manual badge, adminNote input, status Select. Save button per card calls
    violations.update. Delete button (trash icon) calls violations.remove with confirmation.
  - Add Violation: "Add Violation" button toggles addingViolation state; shows small inline
    form with description textarea + severity select + "Save" button calling violations.createPublic.
  - Generate Letter: "Generate Letter" Button → sets generating=true, calls
    `useAction(api.letters.generate)` with propertyId → sets letterHtml + showPreview=true.
  - Letter preview Dialog: renders letterHtml safely using `dangerouslySetInnerHTML` inside a
    sandboxed div with overflow-auto. "Send to Homeowner" Button (disabled if !property.email) →
    sets sending=true, calls `useAction(api.letters.send)` → on success shows toast and closes.
    "Close" Button.
  - Back link to /admin/dashboard.
- Key UI: Two-column layout on lg+ (photos left col, violations right col). Single column on mobile.
  Sticky top bar with address + back link. All edits are inline (no separate edit page).

### StreetList
- File: `src/pages/inspector/StreetList.tsx`
- Props: none
- State: none
- Behavior:
  - Auth check: if localStorage "hoa_inspector" !== "true", navigate("/inspector").
  - `useQuery(api.streets.list)` — streets with counts.
  - Tap street card → navigate(`/inspector/street/${street._id}`).
  - Logout: clear localStorage, navigate("/").
- Key UI: Mobile-first. Top bar "Streets" + Logout. Card list — each card: street name (large),
  "{complete}/{total} properties complete", progress bar (width = complete/total * 100%). Tailwind:
  cards have generous padding and min-h-16 for touch targets.

### PropertyList
- File: `src/pages/inspector/PropertyList.tsx`
- Props: none (reads streetId from useParams)
- State: none
- Behavior:
  - Auth check.
  - `useQuery(api.streets.getWithProperties, { streetId })` — walk-ordered properties.
  - "Start Walk" button: find first property where status === "notStarted"; navigate to it.
    If none, show "All properties inspected!" toast.
  - Each property item: tap → navigate to /inspector/property/:id.
  - Back → /inspector/streets.
- Key UI: Mobile list. Each item: house number + address (left), status dot (right).
  Dot colors: gray=notStarted, amber=inProgress, green=complete.
  "Start Walk" fixed bottom button if any properties are notStarted.
  Walk order label: "Walk order: Odd side (ascending) then Even side (descending)".

### PropertyCapture
- File: `src/pages/inspector/PropertyCapture.tsx`
- Props: none (reads propertyId from useParams)
- State:
  - `currentSection: "front" | "side" | "back"` (default "front")
  - `uploading: boolean`
  - `note: string`
  - `listening: boolean`
  - `savingNote: boolean`
  - `lastUploadedPhotoId: Id<"photos"> | null`
- Behavior:
  - Auth check.
  - `useQuery(api.properties.get, { id: propertyId })` — address, streetId, status.
  - `useQuery(api.photos.listByProperty, { propertyId })` — real-time; filter to currentSection
    for thumbnail display.
  - `useQuery(api.violations.listByProperty, { propertyId })` — real-time subscription; new
    violations appear without page refresh.
  - `useQuery(api.streets.getWithProperties, { streetId: property?.streetId })` — to compute
    nextPropertyId: find index of propertyId in walk-ordered list; nextPropertyId = list[index+1]?.
  - Camera capture:
    ```html
    <input type="file" accept="image/*" capture="environment" id="photo-input" className="hidden"
           onChange={handlePhotoSelected} />
    ```
    "Take Photo" Button onClick: `document.getElementById("photo-input").click()`.
    `handlePhotoSelected(e)`: get file from e.target.files[0]; if none, return; set uploading=true;
    call `uploadPhoto(file, propertyId, currentSection)` from uploadClient; on success call
    `createPhoto` mutation with result + propertyId + currentSection; save returned photoId to
    lastUploadedPhotoId; set uploading=false; reset input value.
  - Photos for currentSection: horizontal scroll row of 80×80px thumbnails (object-cover rounded).
    Each has an analysisStatus indicator icon overlaid (bottom-right corner).
  - Violations panel: below photos. Shows all violations for the property (all sections combined).
    Each: colored left border by severity (red=high, amber=medium, green=low), description text,
    severity badge, AI/Manual label. New violations animate in with a brief highlight.
  - Note textarea + optional mic button:
    - Mic button onClick: if window.SpeechRecognition or window.webkitSpeechRecognition available,
      set listening=true; create recognition instance; recognition.onresult: append transcript to
      note; recognition.onend: set listening=false; recognition.start().
    - "Save Note" Button: calls photos.updateNote with { id: lastUploadedPhotoId, note }; shows
      brief "Saved" feedback; clears note.
  - "Next House" sticky bottom bar (full-width, prominent green button):
    - If nextPropertyId: onClick calls `updateStatus({ id: propertyId, status: "complete" })` +
      navigate to /inspector/property/nextPropertyId.
    - If no next: onClick calls updateStatus("complete") + navigate back to
      /inspector/street/streetId with toast "Street inspection complete!".
  - Section tabs at top (below address): Front / Side / Back. Active tab underlined + bold.
    Switching tabs: update currentSection state; filter photos displayed.
- Key UI: Full mobile-height layout. Top: address + section tabs. Middle (scrollable): photo row
  + violations panel. Bottom: note input + sticky Next House bar. Uploading: spinner overlay on
  "Take Photo" button area. Listening: mic button pulses red.

### HomeownerPortal
- File: `src/pages/portal/HomeownerPortal.tsx`
- Props: none (reads token from useParams)
- State: `uploadingForViolationId: string | null`
- Behavior:
  - `useQuery(api.properties.getByToken, { token })` — if returns null, show "Portal link not found."
  - `useQuery(api.violations.listByProperty, { propertyId: property._id })` when property loaded.
  - `useQuery(api.photos.listByProperty, { propertyId: property._id })` — for evidence photos.
  - `useQuery(api.fixPhotos.listByProperty, { propertyId: property._id })` — fix verification.
  - Each violation card:
    - Description, severity badge.
    - Evidence photos (photos where photo._id === violation.photoId): small thumbnails.
    - Existing fix photos for this violation (fixPhotos where violationId === violation._id):
      shown with verificationStatus badge:
        - pending: "Verifying..." with spinner
        - resolved: "✓ Resolved" green badge
        - notResolved: "✗ Still present" red badge + verificationNote
        - needsReview: "Under review" amber badge + verificationNote
    - "Upload Fix Photo" Button: hidden file input per violation. On select:
      set uploadingForViolationId = violation._id; call uploadPhoto(file, propertyId, "fix");
      call fixPhotos.create with { propertyId, violationId, filePath, publicUrl };
      clear uploadingForViolationId. Show spinner on button while uploading.
  - No authentication required — token in URL grants access.
- Key UI: Clean standalone page (no admin nav). Property address as `<h1>`. Subtitle "HOA
  Inspection Results". Violation count badge. Violation cards in a vertical list. No footer nav.
  Mobile-friendly padding. Footer: "Questions? Contact your HOA."

---

## 6. Environment Variables

### Frontend (VITE_ prefix, bundled into client JS)
- `VITE_CONVEX_URL` — Convex deployment URL (e.g., `https://happy-animal-123.convex.cloud`)
- `VITE_UPLOAD_SERVER_URL` — VPS upload server base URL. Dev: `http://localhost:3001`.
  Production: `https://yourdomain.com` (nginx proxies /api/upload to Express).
- `VITE_ADMIN_PASSWORD` — Admin area password. Client-side check only (PoC). Change before
  sharing the URL with anyone untrusted.
- `VITE_INSPECTOR_PASSWORD` — Inspector area password. Same caveat.

### Convex server environment (set via `npx convex env set KEY value`)
- `OPENAI_API_KEY` — OpenAI API key with access to gpt-4.1-mini and vision capability.
- `RESEND_API_KEY` — Resend API key for email delivery.
- `RESEND_FROM` — Verified Resend sender (e.g., `"HOA Inspection <noreply@yourdomain.com>"`).
- `PUBLIC_BASE_URL` — Base URL for homeowner portal links in generated letters. No trailing slash.
  e.g., `https://yourdomain.com`.

### VPS upload server (set in server process / systemd unit)
- `PORT` — Express listen port (default: `3001`).
- `BASE_URL` — Public base URL for constructing file URLs returned to the client. Dev:
  `http://localhost:3001`. Production: `https://yourdomain.com` (when nginx serves `/uploads/`
  from the same domain).
- `UPLOADS_DIR` — Absolute path where files are stored. Dev: auto-resolved to `../uploads`
  relative to server/index.js. Production: `/var/www/hoa-inspection-helper/uploads`.

---

## 7. Build Sequence

Follow in order. Do not skip or reorder.

1. **Fix convex/http.ts** — Delete the `"use node"` first line and the entire Telegram route.
   Replace file content with:
   ```typescript
   import { httpRouter } from "convex/server";
   const http = httpRouter();
   export default http;
   ```

2. **Delete template-only files** — Remove: `convex/leads.ts`, `convex/votes.ts`,
   `convex/tracking.ts`, `convex/telegram.ts`, `convex/telegramClient.ts`,
   `src/pages/Index.tsx`, `src/components/GateScreen.tsx`, `src/components/ShareButtons.tsx`.
   Also remove the VoteATron3000 and VoteATronErrorBoundary component files if they exist in
   `src/components/`.

3. **Rewrite convex/schema.ts** — Replace entire file with the schema from Section 3.
   Run `npx convex codegen` to verify schema validity before proceeding.

4. **Create convex/aiConfig.ts** — getAll (query), getAllInternal (internalQuery), set (mutation).
   No "use node".

5. **Create convex/templates.ts** — get (query), set (mutation). No "use node".

6. **Create convex/streets.ts** — list (query with counts), getWithProperties (query with walk
   order sort). No "use node".

7. **Create convex/properties.ts** — list, get, getByToken, getInternal (internalQuery) queries;
   importFromCSV, updateStatus, updateEmail, markLetterSent mutations. No "use node".

8. **Create convex/violations.ts** — listByProperty, getById queries; create (internalMutation),
   createPublic, update, remove mutations. No "use node".

9. **Create convex/photos.ts** — listByProperty, getById queries; create, updateNote mutations;
   updateAnalysisStatus internalMutation. In the `create` mutation, add the
   `ctx.scheduler.runAfter(0, internal.ai.analyzePhoto, { photoId })` call (it will type-check
   once ai.ts exists; if codegen fails before ai.ts is created, temporarily comment it out).

10. **Create convex/fixPhotos.ts** — listByProperty, getById queries; create mutation;
    updateVerification internalMutation. Same scheduler note as step 9 for verifyFix.

11. **Create convex/ai.ts** — analyzePhoto (internalAction), verifyFix (internalAction). No "use
    node" — only fetch and Convex ctx methods used. Uncomment scheduler calls in photos.ts and
    fixPhotos.ts if they were commented out.

12. **Create convex/letters.ts** — generate (action), send (action). No "use node".
    generate uses ctx.runQuery(internal.properties.getInternal, ...) to access accessToken.

13. **Run `npx convex codegen`** — Must exit 0 with no errors. Fix all TypeScript type errors
    before continuing. Common issues: missing `v.optional()` wrappers, incorrect Id<> types,
    internalQuery/internalMutation import path errors.

14. **Create server/package.json** — type: "module", dependencies: express ^4.18.2,
    multer ^1.4.5-lts.1, cors ^2.8.5. Run `cd server && npm install` to verify.

15. **Create server/index.js** — Express upload server (see Section 2 description). Key points:
    - Use `import` syntax (ES modules, type: "module").
    - Use `fileURLToPath(import.meta.url)` to get __dirname equivalent.
    - `multer.diskStorage` destination uses `req.body.propertyId` and `req.body.section`; these
      are available because multer processes fields before the destination callback when using
      `upload.fields()` or you must switch to `upload.none()` first and handle file separately.
      Simpler: use `multer({ dest: UPLOADS_DIR })` (flat dest), then move file in the handler
      using fs.mkdirSync + fs.renameSync to the proper nested path.
    - Return `{ publicUrl, filePath }` where filePath is relative (e.g., "propertyId/section/filename").

16. **Create src/lib/uploadClient.ts**:
    ```typescript
    const BASE = import.meta.env.VITE_UPLOAD_SERVER_URL ?? "http://localhost:3001";
    export async function uploadPhoto(file: File, propertyId: string, section: string) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("propertyId", propertyId);
      fd.append("section", section);
      const res = await fetch(`${BASE}/api/upload`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed: " + res.status);
      return res.json() as Promise<{ publicUrl: string; filePath: string }>;
    }
    ```

17. **Rewrite src/App.tsx** — Remove VoteATron, VoteATronErrorBoundary, GateScreen, old Index
    import. Add all new page imports. Set up Routes as described in Section 5 (Landing, AdminGate,
    Dashboard, Settings, PropertyReview, InspectorGate, StreetList, PropertyList, PropertyCapture,
    HomeownerPortal). Keep ConvexProvider and BrowserRouter wrappers.

18. **Create src/pages/Landing.tsx**

19. **Create src/pages/admin/AdminGate.tsx**

20. **Create src/pages/admin/Dashboard.tsx** — Include inline CSV parser function (no external
    library). CSV parser should handle quoted fields minimally for PoC (simple comma split is fine
    if HOA addresses don't contain commas — add a note in comments).

21. **Create src/pages/admin/Settings.tsx**

22. **Create src/pages/admin/PropertyReview.tsx** — The most complex admin page; implement all
    sub-features in one pass.

23. **Create src/pages/inspector/InspectorGate.tsx**

24. **Create src/pages/inspector/StreetList.tsx**

25. **Create src/pages/inspector/PropertyList.tsx**

26. **Create src/pages/inspector/PropertyCapture.tsx** — The most complex page overall. Implement
    in this order within the file: data queries → camera capture → photo display → violations panel →
    note + speech → Next House logic.

27. **Create src/pages/portal/HomeownerPortal.tsx**

28. **Create .env.local.example** with all variables listed in Section 6 with placeholder values.

29. **Run `npm run build`** — Must exit 0. Address any TypeScript errors (missing types, incorrect
    Id<> generics, missing imports).

30. **Run `npx convex codegen`** — Final verification. Must exit 0.

---

## 8. Test Criteria

### Automated checks (must both pass with exit code 0)
- `npm run build`
- `npx convex codegen`

### Manual smoke tests

**Schema + Convex:**
- Open Convex dashboard; confirm all 7 tables (streets, properties, photos, violations, fixPhotos,
  aiConfig, templates) appear with correct field definitions.

**Admin — CSV import:**
1. Create test CSV:
   ```
   address,street,houseNumber,email
   101 Oak Ave,Oak Avenue,101,alice@example.com
   103 Oak Ave,Oak Avenue,103,bob@example.com
   102 Oak Ave,Oak Avenue,102,carol@example.com
   201 Elm St,Elm Street,201,dave@example.com
   203 Elm St,Elm Street,203,
   ```
2. Navigate to /admin (enter VITE_ADMIN_PASSWORD).
3. Click "Import CSV", select the file. Confirm toast "5 properties imported, 0 skipped".
4. Confirm two streets and five properties appear in the dashboard table.

**Admin — Settings:**
1. Navigate to /admin/settings.
2. Enter text in all three AI config fields; blur each. Confirm "✓ Saved" appears.
3. Enter a letter template with all four placeholders. Click "Save Template". Confirm no error.

**Inspector — Walk flow:**
1. Navigate to /inspector (enter VITE_INSPECTOR_PASSWORD).
2. Confirm both streets appear with 0/5 and 0/2 complete counts.
3. Tap "Oak Avenue". Confirm property order: 101, 103, 102 (odds asc then evens desc — only 102 is even).
4. Tap 101 Oak Ave → /inspector/property/:id. Confirm address shows.
5. Select a photo (via file picker on desktop). Confirm thumbnail appears with "pending" → "processing"
   → "done" status update (requires running upload server + valid OPENAI_API_KEY).
6. Confirm violation appears in the violations panel (within ~10 seconds of upload).
7. Type a note; save. Confirm saved.
8. Tap "Next House". Confirm navigation to 103 Oak Ave.

**Homeowner portal:**
1. From /admin/property/:id for 101 Oak Ave, confirm violations list shows.
2. Manually retrieve accessToken from Convex dashboard for that property.
3. Navigate to /portal/{token}. Confirm address and violations display without any login.
4. Click "Upload Fix Photo" on a violation. Select image. Confirm fix photo appears with
   "Verifying..." → resolves to a status badge after AI runs.

**Letter generation:**
1. On /admin/property/:id for a property with violations and email set.
2. Click "Generate Letter". Confirm HTML preview renders with address, violations text, and portal link.
3. Click "Send to Homeowner". Confirm success toast. Confirm letterSentAt appears in Convex dashboard.

---

## 9. Deployment Notes

### Convex deployment
- Run `npx convex deploy` (production) or `npx convex dev` (local development).
- Set all Convex env vars before deploying:
  ```
  npx convex env set OPENAI_API_KEY sk-...
  npx convex env set RESEND_API_KEY re_...
  npx convex env set RESEND_FROM "HOA Inspection <noreply@yourdomain.com>"
  npx convex env set PUBLIC_BASE_URL https://yourdomain.com
  ```
- The `convex/http.ts` file MUST NOT contain `"use node"`. Convex deployment will reject it.
  Verify: `head -1 convex/http.ts` must not print `"use node";`.

### VPS upload server — systemd unit
Create `/etc/systemd/system/hoa-upload.service`:
```ini
[Unit]
Description=HOA Inspection Upload Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/hoa-inspection-helper/server
Environment=PORT=3001
Environment=BASE_URL=https://yourdomain.com
Environment=UPLOADS_DIR=/var/www/hoa-inspection-helper/uploads
ExecStart=/usr/bin/node index.js
Restart=always

[Install]
WantedBy=multi-user.target
```
Then: `systemctl enable hoa-upload && systemctl start hoa-upload`.

### nginx configuration (add to server block)
```nginx
# Proxy photo uploads to Express
location /api/upload {
    proxy_pass http://localhost:3001;
    client_max_body_size 25M;
    proxy_set_header Host $host;
}

# Serve uploaded photos statically
location /uploads/ {
    alias /var/www/hoa-inspection-helper/uploads/;
    expires 30d;
    add_header Cache-Control "public, immutable";
}

# Frontend SPA (serve dist/ from npm run build)
location / {
    root /var/www/hoa-inspection-helper/dist;
    try_files $uri $uri/ /index.html;
}
```

### Vercel deployment (alternative for frontend only)
- `npm run build` → deploy `dist/` to Vercel.
- Add `vercel.json`:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/" }] }
  ```
- Upload server still runs on VPS. Set `VITE_UPLOAD_SERVER_URL` in Vercel env vars to the VPS URL.
- Ensure VPS nginx serves `/uploads/` with CORS header if upload server and frontend are on
  different domains: `add_header Access-Control-Allow-Origin "https://your-vercel-app.vercel.app";`

### CORS restriction for production
In `server/index.js`, replace `app.use(cors())` with:
```javascript
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ?? "*" }));
```
Set `ALLOWED_ORIGIN=https://yourdomain.com` in the server environment.

### OpenAI model fallback
If `gpt-4.1-mini` is unavailable on the account, substitute `gpt-4o-mini` in `convex/ai.ts`
and `convex/letters.ts` — the API request shape is identical.
