# High-Level Plan: Happier Block (HOA inspection app)

## What It Does
A mobile-first web application that streamlines HOA property inspections end-to-end: inspectors walk streets capturing photos via a fast "Next" workflow, AI analyzes each photo as it is uploaded and shows real-time violation feedback, and homeowners receive email links to a portal where they can view violations and upload proof of fixes for AI-assisted verification.

## Key Features
- **CSV Property Import** — Admin uploads a CSV of addresses; properties are auto-grouped by street
- **Inspector Mobile UI** — Street-based navigation with odd/even house ordering matching real walking patterns; front/side/back photo capture per property; unlimited photos per section
- **Next House Flow** — Core inspector UX: tap "Next" to auto-save and jump to the next property with camera ready
- **Real-Time AI Violation Detection** — AI runs immediately on each photo upload so inspectors see feedback as they work; inspectors can add notes to supplement or correct AI findings before moving on
- **Admin AI Configuration** — Three freeform text areas for violation rules, approved colors, and HOA guidelines passed directly into AI prompts
- **Template Management** — Admin defines report (internal) and letter (external) templates; AI generates only violation descriptions, not full letters
- **Admin Dashboard** — Filter properties by status (not started / in progress / complete), drill into inspection history, review and edit AI-detected violations, generate and send letters
- **Letter Generation & Delivery** — Letters are rendered as HTML; admin clicks to send via email with the full letter content in the email body; email includes a unique link to the homeowner's portal
- **Homeowner Portal** — Access via unique email link (no login required for PoC; full auth deferred); view violations with photo evidence, upload proof of fixes, AI before/after comparison returns resolved/not resolved/needs review status
- **Speech-to-Text Notes** — Optional inspector notes attached to properties or individual photos

## Tech Stack
- **Frontend:** React + Vite + Tailwind (template already in place)
- **Backend:** Convex (real-time, serverless — metadata, live status updates; NOT used for photo storage)
- **Photo Storage:** VPS filesystem — full-size photos stored as-is; no client-side compression. Convex stores only the file path/URL reference.
- **AI:** `gpt-4.1-mini` via OpenAI API — vision-capable, low cost, sufficient for PoC. Single config value; trivial to upgrade.
- **Email:** Resend (homeowner letter delivery)
- **Auth:** Convex Auth for admin and inspector roles; homeowner portal is token-based (unique UUID per property in URL, no login required)

## Photo Storage Architecture (VPS)
- Inspector captures photo in browser via camera API
- Browser POSTs full-size image (no resize/compression) to a VPS upload endpoint
- VPS stores file at: `/var/www/hoa-inspection-helper/uploads/{propertyId}/{section}/{timestamp}_{originalName}`
- Files are served directly by nginx from `/uploads/` path (e.g., `https://yourdomain.com/uploads/...`)
- Convex stores: `{ photoId, filePath, publicUrl, propertyId, section, uploadedAt }`
- AI reads photos by public URL at analysis time — no re-upload needed
- Full-size images are passed to `gpt-4.1-mini` vision as URLs
- Convex free plan is used only for structured data — well within limits

## AI Processing: Real-Time Per-Photo
- AI analysis is triggered immediately on each photo upload (not deferred to end of inspection)
- Result is stored as a pending violation linked to the specific photo
- Inspector sees the AI finding surfaced in the UI while still at the property
- Inspector can add a note to any photo or violation to flag missed issues or provide context
- On admin review, all per-photo findings for a property are shown together

## AI Model Decision
**PoC model: `gpt-4.1-mini`**
- Vision support: yes
- Cost: low-cost tier, well-suited for iterative PoC testing with per-photo triggering
- Quality: adequate for structured violation detection on clear exterior photos
- Easy to swap: model is a single config value; upgrade path to `gpt-4.1`, `claude-sonnet-4-6`, or any OpenRouter model is trivial

## Homeowner Portal Access
- No login required for PoC; auth deferred to a future iteration
- Each property has a unique UUID-based access token stored in Convex
- Email letter includes a link: `https://yourdomain.com/portal/{token}`
- Token gives read/write access to that property's portal only (view violations, upload fix photos)
- Fix upload follows same VPS storage pattern as inspection photos

## Letter Generation & Email
- Letters are rendered as HTML server-side from the admin-defined letter template
- Admin previews the rendered HTML in the dashboard before sending
- "Send" triggers a Resend API call with:
  - To: homeowner email (stored on property record)
  - Subject: configurable (e.g., "HOA Inspection Notice — {address}")
  - Body: full HTML letter content (opening + AI-generated violation descriptions + closing)
  - Includes homeowner portal link for submitting fix photos
- No PDF generation for PoC; HTML email only

## Scope & Constraints
**In scope:**
- Admin: CSV upload, AI config, template management, dashboard, review & send workflow
- Inspector: street list, property detail with unlimited photo capture, Next flow, status indicators, per-photo real-time AI feedback, inspector notes
- Homeowner: token-based portal access via email link, violation view, fix upload, AI before/after verification, report download
- AI: per-photo violation detection triggered on upload; before/after fix verification
- Photo storage: VPS filesystem, full-size, served by nginx
- Role-based auth for admin/inspector; token-based access for homeowners

**Out of scope for this one-shot:**
- Native mobile app (iOS/Android) — browser camera API only
- GPS-based property lookup or map views
- Homeowner login/account system (deferred to post-PoC)
- Email scheduling or automated reminder sequences
- PDF letter generation
- Payment processing or subscription management
- Multi-HOA / multi-tenant isolation beyond basic data scoping
- Offline/PWA mode with background sync
- OCR on uploaded CSVs (clean CSV format assumed)
- CDN or object storage (VPS filesystem only)
- Image compression (full-size storage and AI submission)

## Implementation Approach
1. **Data model & auth** — Convex schema: properties, streets, inspections, photos (metadata only), violations, templates, users (admin/inspector roles), homeowner access tokens
2. **Photo storage & serving** — VPS upload endpoint (multipart POST → `/var/www/hoa-inspection-helper/uploads/`); nginx serves `/uploads/` statically; Convex stores path + public URL
3. **Real-time AI pipeline** — On photo upload success, trigger `gpt-4.1-mini` vision call with photo URL + all three admin rule text areas; store structured violation result linked to photo; push result to inspector UI via Convex real-time subscription
4. **Admin core** — CSV import + street grouping, AI config settings page, template editor (report + letter HTML), dashboard with status filters
5. **Inspector mobile UI** — Street list → property list (odd/even ordering) → property detail with camera capture → live AI findings panel → inspector notes → Next flow with auto-save
6. **Admin review + letter send** — Violation review/edit UI, HTML letter preview, Resend email delivery with homeowner portal link embedded
7. **Homeowner portal** — Token-gated read-only view of violations + photos, fix photo upload, AI before/after comparison and status display
