# Happier Block — Project Evaluation (July 2026)

Scope: a thorough review of the HOA inspection helper across **security**, **performance**, and **user experience**. Each finding lists the issue/opportunity, a high-level recommendation, and a risk-or-reward ranking. File references are `path:line` and were read directly during the review.

**Ranking legend** — Critical / High / Medium / Low, judged by likelihood × impact (for security) or effort-vs-payoff (for performance/UX).

---

## Architecture at a glance

- **Frontend** — React 18 + Vite + Tailwind/shadcn (`src/`), installable PWA, deployed on Vercel. Client-side route guards (`AdminGate`, `InspectorGate`, `PlatformGate`) are UX-only.
- **Convex backend** (`convex/`) is the real authorization boundary: Clerk JWT auth (`auth.config.ts`), multi-HOA tenancy via `convex/lib/tenantAuth.ts` + `platformAuth.ts`, AI letter/ARC generation, photos, Resend email.
- **Express upload server** (`server/index.js`) on a VPS — stores photos on local disk, serves them publicly at `/uploads`.
- **Ops tooling** — Telegram bot + Backblaze B2 backup shell scripts (not part of the app request path).
- Repo was scaffolded from a generic "Ideer Launchpad" template, so the README is mostly boilerplate and does not reflect the real product.

---

## Executive summary — act on these first

| # | Item | Area | Rank |
|---|------|------|------|
| 1 | **Homeowner portal link goes to a blank page** — `/portal/:token` route is never registered, so the entire fix-photo review loop is dead | UX | **Critical** |
| 2 | **Unauthenticated Convex actions** — `openai.generateText`, `transcribeAudio`, `resend.sendEmail` are public with attacker-controlled inputs (OpenAI cost abuse, prompt injection, open email relay) | Security | **High** |
| 3 | **`multiHoa.seedRidgeTopTerraceAndBackfill`** — any signed-in user can reassign all tenants' data and grant themselves admin | Security | **High** |
| 4 | **Upload server is unauthenticated** — no auth, no size/type limit, deprecated `multer` 1.x, CORS defaults to `*` | Security | **High** |
| 5 | **Dashboard runs two heavy export queries on every mount** (full photo-table scan + 2N property queries) though only used on export click | Performance | **High** |
| 6 | **No offline resilience for field inspectors** — no upload retry/queue, silent full-res upload failures, no offline indicator | UX | **High** |

The single most business-critical item is **#1**: homeowners who receive a violation letter and click the link to submit fix photos see a white screen, so the loop the whole product is built around never completes.

---

## Security

### SEC-1 — Public OpenAI actions with no auth — **High**
- **Issue:** `convex/openai.ts:31` `generateText` and `:118` `transcribeAudio` are public `action`s with no auth check, taking an arbitrary `prompt`, `systemPrompt`, and `model`. They are invoked directly from the client (`src/utils/ai.ts:16`), so anyone who knows the Convex deployment URL can call them and spend your `OPENAI_API_KEY`. This is also a direct prompt-injection channel.
- **Recommendation:** Convert to `internalAction` and expose only through the already-authenticated wrappers (`inspectionBullets`, `arcApplicationReview`), or add `requireViewerContext` at the top. Pin/allowlist the `model` argument.
- **Risk if ignored:** Unbounded API cost, quota exhaustion, abuse of your account.

### SEC-2 — `resend.sendEmail` is an open relay — **High**
- **Issue:** `convex/resend.ts:13` is a public action whose `to`, `subject`, and `html` are fully attacker-controlled and sent through your Resend account/verified domain. Reachable from `src/utils/email.ts`. This is effectively an open email relay usable for spam/phishing that appears to come from your domain. (`sendVoteTractionEmail`/`sendVoteMilestoneEmail` hardcode the recipient, so they only mail-bomb your own inbox — lower impact.)
- **Recommendation:** Make it `internalAction`, or require `requireViewerRole(admin)`. Never let the client supply the recipient or raw HTML body for outbound mail.
- **Risk if ignored:** Domain reputation damage, blocklisting, phishing launched from your infrastructure.

### SEC-3 — `seedRidgeTopTerraceAndBackfill` privilege escalation — **High**
- **Issue:** `convex/multiHoa.ts:4` is gated only by "is authenticated" (`identity?.subject`), not by role or platform-admin. Any signed-in user can call it to reassign **all** `streets`, `properties`, `photos`, `fixPhotos`, `templates`, `aiConfig`, and `letterTemplateDocs` rows to an HOA they name, and insert a `userHoaMemberships` row making themselves `admin`. This is a cross-tenant data-takeover + privilege-escalation primitive.
- **Recommendation:** Delete this leftover migration/seed mutation, or gate it behind `requirePlatformAdmin` / a `DEMO_SEED_SECRET` like the other seed helpers.
- **Risk if ignored:** Complete tenant compromise by any authenticated user.

### SEC-4 — Express upload server is unauthenticated — **High**
- **Issue:** `server/index.js:70` `/api/upload` has no authentication, no `limits.fileSize`, and no `fileFilter` (extension taken from `originalname`). Files are served publicly at `/uploads` (`:25`). CORS defaults to `*` when `ALLOWED_ORIGIN` is unset (`:19`). The server pins `multer ^1.4.5-lts.1` (`server/package.json:12`), a deprecated line with known busboy/dicer DoS advisories.
- **Recommendation:** Require a shared token or short-lived signed grant issued by Convex; add `multer` `limits.fileSize` + an image-only `fileFilter`; set `ALLOWED_ORIGIN` explicitly in prod; upgrade to `multer` 2.x (the root package already uses 2.1.1).
- **Risk if ignored:** Anonymous arbitrary-file hosting, disk-fill DoS, malware distribution from your domain.

### SEC-5 — SSRF in template ingestion — **Medium**
- **Issue:** `convex/letterTemplateIngest.ts` `ingestUploadedTemplate` runs `fetch(args.sourcePublicUrl)` before the admin check that guards the final DB write, so any caller can make the server fetch an arbitrary URL (internal services, cloud metadata endpoints).
- **Recommendation:** Add `requireViewerRole(admin)` at the top of the handler; restrict the fetch target to your own upload host.
- **Risk if ignored:** Internal network probing, metadata-endpoint credential theft.

### SEC-6 — Photos served fully public, no signed URLs — **Medium**
- **Issue:** `/uploads` serving has no access control or expiry (`server/index.js:25`). Filenames include a random multer id so URLs aren't trivially enumerable, but anyone with a URL can fetch homeowner property photos forever. Deletion authz itself is correct (`photos.removeForInspector` re-validates `hoaId` and uses a server-held token).
- **Recommendation:** Move to signed/expiring URLs or auth-gated serving for photo blobs.
- **Risk if ignored:** Persistent public exposure of homeowner property imagery.

### SEC-7 — Repo hygiene & weak compares — **Low/Medium**
- **Issue:** `.env.bak` is tracked by git and `.gitignore` only ignores `.env`/`.env.local`; it holds no live secret today but is a footgun for a future snapshot. Seed helpers use non-timing-safe `!==` secret compares (`convex/properties.ts:321`, `demoSeed.ts`), while `platform.ts` correctly uses a timing-safe compare. The `/api/delete-file` comment about `VITE_UPLOAD_DELETE_TOKEN` (`server/index.js:40`) is stale — the client no longer references it.
- **Recommendation:** Add `.env.*` (except `.example`) to `.gitignore` and untrack `.env.bak`; switch seed compares to the existing `timingSafeEqualString`; delete the stale comment.
- **Risk if ignored:** Accidental future secret commit; marginal timing side-channel.

### What's solid on security
Tenant isolation is implemented consistently — HOA-scoped functions re-check `property.hoaId === viewer.hoaId` throughout. Platform-admin is server-enforced (`requirePlatformAdmin` on every platform function) with a timing-safe bootstrap secret. `internalQuery`/`internalMutation` are used correctly and not exposed. No live secrets are hardcoded in tracked files. `convex/http.ts` exposes no webhook surface. The homeowner token flow (`getByToken`) strips sensitive fields before returning.

---

## Performance

### PERF-1 — Dashboard over-fetches heavy export queries on every mount — **High**
- **Issue:** `src/pages/admin/Dashboard.tsx:111-112` calls `useQuery(api.photos.listForZipExport)` and `useQuery(api.properties.listForCsvExport)` unconditionally at page load, but their results are only consumed on the "Export ZIP"/"Export CSV" clicks. `listForZipExport` (`convex/photos.ts:21-65`) scans all HOA photos then does two serial `ctx.db.get` calls **per photo** in a `for` loop — the worst N+1 in the codebase. `listForCsvExport` (`properties.ts:719-799`) issues 2N+2 queries.
- **Recommendation:** Gate both queries behind the export action (pass `"skip"` until requested, or fetch on click). Parallelize/batch the photo lookups (`Promise.all`, or denormalize street/property names onto the photo row).
- **Reward:** Every admin dashboard visit currently triggers a full photo-table scan that's usually thrown away; fixing it removes the heaviest recurring backend cost.

### PERF-2 — No route-based code splitting; heavy libs in main bundle — **Medium/High**
- **Issue:** `src/App.tsx` imports all ~15 page components statically; `vite.config.ts` sets no `manualChunks`. `jspdf` (~350KB) and `jszip` (~100KB) are statically imported in `LetterExport.tsx:9-10` and `Dashboard.tsx:8`, so they ship to every admin even when not exporting. `html2canvas` is a dependency but imported nowhere (dead weight, ~200KB).
- **Recommendation:** `React.lazy` the admin/platform routes; `await import()` jspdf/jszip inside the export handlers; remove the unused `html2canvas` dependency.
- **Reward:** Faster initial load, especially on the mobile inspector path which never needs the export libs.

### PERF-3 — N+1 query patterns in list endpoints — **Medium/High**
- **Issue:** `convex/streets.ts:15-18` `list` fetches all streets then collects properties per-street to compute counts — and it backs both the inspector StreetList and admin Dashboard, so it runs often. `properties.listLetterReviewRows`, `listForCsvExport`, and `listGeneratedLetterBodies` all do per-property photo fetches.
- **Recommendation:** Maintain denormalized counts, or batch with a single indexed query per HOA and group in memory.
- **Reward:** Lower latency on the two most frequently loaded screens.

### PERF-4 — Image grids load full-resolution, no lazy loading — **Medium**
- **Issue:** Thumbnails exist (`thumbnailPublicUrl`) but list/grid renders prefer full-size: `photo.publicUrl ?? photo.thumbnailPublicUrl` in `PropertyReview.tsx:424` and `PropertyCapture.tsx:677`, and server queries emit the same ordering. No `<img>` uses `loading="lazy"` anywhere.
- **Recommendation:** Use `thumbnailPublicUrl` first for on-screen grid/list tiles (keep full-res only for the lightbox and PDF appendix); add `loading="lazy"` + `decoding="async"` to grid images.
- **Reward:** Large mobile data + render savings on photo-heavy properties.

### PERF-5 — PDF export decodes full-res photos serially on the main thread — **Medium**
- **Issue:** `LetterExport.tsx:119-136` `imageUrlToDataUrl` draws each photo to a canvas at full `naturalWidth` then re-encodes at q=0.92; `exportZip` processes letters strictly serially (`:400-414`). The whole export is O(total photos) of blocking main-thread work.
- **Recommendation:** Downscale to the print box (or use thumbnails) before `toDataURL`; process with bounded concurrency.
- **Reward:** Export stops freezing the UI on large streets.

### PERF-6 — Bulk AI letter generation is fully sequential — **Medium**
- **Issue:** `LetterExport.tsx:365-376` awaits one `generateLetter` OpenAI call at a time; a 50-home street is 50 sequential model round-trips.
- **Recommendation:** Use a bounded concurrency pool (the repo already has `runPool`).
- **Reward:** Dramatically lower wall-clock for bulk generation.

### PERF-7 — Express server sync fs + no upload size limit — **Medium**
- **Issue:** `server/index.js` uses `fs.mkdirSync`/`fs.renameSync` on the request path (`:82,:85`), blocking the single event loop under concurrent uploads; no multer size limit (also SEC-4).
- **Recommendation:** Switch to `fs.promises`; add `limits.fileSize`.

### What's solid on performance
Client-side thumbnailing before upload (`src/lib/thumbnailImage.ts`, 640px q=0.82) with a 4-way upload pool is a strong pattern. The Convex schema is well-indexed (`by_hoa*` compound indexes). `pdfjs-dist` is dynamically imported. The PWA config deliberately avoids runtime-caching live/auth data — a correct tradeoff. jsPDF renders text (not html2canvas rasterization), the efficient choice.

---

## User Experience

### UX-1 — Homeowner portal link is a blank page (broken core loop) — **Critical**
- **Issue:** `convex/letterBody.ts:59` builds the homeowner link as `${publicBaseUrl}/portal/${accessToken}`, but `src/App.tsx` registers **no `/portal/:token` route** and no catch-all `*` route. `src/pages/portal/HomeownerPortal.tsx` is fully built (fix-photo upload, status) but is imported nowhere, so React Router renders nothing. Every homeowner who clicks their letter link gets a white screen, and the fix-photo re-review loop — which the admin side (`PropertyReview.tsx`, `fixPhotos`) fully supports — never functions.
- **Recommendation:** Register `<Route path="/portal/:token" element={<HomeownerPortal />} />` and add a catch-all `*` 404 route. Verify the Vercel SPA rewrite serves `index.html` for `/portal/*`.
- **Impact:** Restores the entire homeowner-facing half of the product.

### UX-2 — No offline resilience for field inspectors — **High**
- **Issue:** The core users are inspectors walking streets with poor connectivity, yet `src/lib/uploadClient.ts` is a single `fetch` with no retry/backoff/queue. On a dropped uplink the upload throws and `PropertyCapture.tsx:367-370` surfaces a blocking `alert(...)`; the photo is lost. There's no `navigator.onLine` detection or offline banner. Worse, the full-resolution background upload failure is swallowed with only `console.error` (`PropertyCapture.tsx:348-350`) — the thumbnail succeeds so the UI looks done, but the original is never stored and later exports get only the thumbnail.
- **Recommendation:** Add retry with backoff and an offline upload queue (IndexedDB) that flushes on reconnect; show an offline/online indicator; surface background-upload failures visibly and mark the photo as not-fully-uploaded.
- **Impact:** Prevents silent data loss in the primary use case.

### UX-3 — Toast infrastructure is dead; feedback is inconsistent — **Medium**
- **Issue:** `src/hooks/use-toast.ts` exists but no `<Toaster>` is mounted, and `src/components/ui/sonner.tsx:5` exports `Toaster = () => null`, so any `toast()` renders nothing. The app instead mixes native `alert()` (jarring/blocking on mobile), local green `useState` banners, and plain text logs.
- **Recommendation:** Mount a real toast provider and standardize user feedback on it, replacing `alert()`.
- **Impact:** Consistent, non-blocking feedback across the app.

### UX-4 — No unsaved-changes protection; naive CSV import — **Medium**
- **Issue:** No `beforeunload`/`useBlocker` anywhere. `PropertyReview.tsx:442` "Save All" homeowner fields are lost if the user navigates away. The CSV importer (`Dashboard.tsx:57,70`) splits on `,` with no quoted-field handling, so any address/owner name containing a comma silently corrupts the import.
- **Recommendation:** Add an unsaved-changes guard on edit forms; use a real CSV parser (e.g. PapaParse) with quoted-field support and a preview step.
- **Impact:** Prevents lost edits and corrupted property data.

### UX-5 — AI generation blocks with no streaming/cancel — **Medium**
- **Issue:** `letters.generate` and `inspectionBullets.generateFromInspectorNotes` are awaited behind a spinner (`PropertyReview.tsx:494`, `PropertyCapture.tsx:875`) with no progress or cancel. Single-letter generation leaves the admin staring at a spinner. (Positives: output is always an editable textarea with Regenerate, and failures are surfaced.)
- **Recommendation:** Stream tokens or at least make generation cancelable; keep the editable + regenerate model.
- **Impact:** Better perceived latency and control.

### UX-6 — Accessibility gaps — **Medium**
- **Issue:** Generic/empty photo alt text (`alt="section photo"`, `alt="fix"`, lightbox `alt=""`); the inspector photo viewer (`PropertyCapture.tsx:1018`) is a hand-rolled `div` overlay with no focus trap or Escape-to-close; status is encoded color-only via a bare dot (`PropertyList.tsx:70`). Radix primitives elsewhere give a good baseline.
- **Recommendation:** Descriptive alt text (address + section); replace the custom viewer with a Radix Dialog; add a text/label alongside status color.
- **Impact:** Screen-reader and keyboard usability, colorblind support.

### UX-7 — Onboarding & 404 gaps — **Medium/Low**
- **Issue:** A new admin with an empty HOA gets empty states but no guided first-run; the critical first action (CSV import) is buried in the hamburger menu (`Dashboard.tsx:348`). No 404/catch-all route means stale or mistyped URLs render a blank screen. The per-house "Next House" modal fires on every tap (`PropertyCapture.tsx:948`), adding friction across a street. iOS users get no in-app "Add to Home Screen" guidance.
- **Recommendation:** Add an empty-state setup checklist (import → template → AI config); add a friendly 404; default the common "Next House" case; add iOS install guidance.
- **Impact:** Smoother first-run and navigation.

### What's solid on UX
Direct rear-camera capture (`capture="environment"`), multi-file parallel upload with per-tile spinners, sticky headers with `safe-area-inset`, large touch targets, and Radix-based components. Empty states are thoughtful (distinguishing "empty due to filters" vs "truly empty"). Photo deletion has a proper confirm dialog. Autosave (1200ms debounce) for inspector notes. The app is genuinely installable as a PWA.

---

## Suggested order of attack

1. **Register `/portal/:token` + catch-all route** (UX-1) — small change, restores the whole homeowner loop.
2. **Lock down the public Convex actions** (SEC-1, SEC-2) and **remove/gate `seedRidgeTopTerraceAndBackfill`** (SEC-3) — highest-severity, low-effort auth fixes.
3. **Authenticate + constrain the upload server** and upgrade multer (SEC-4, PERF-7) — one change covers a security and a performance issue.
4. **Photo-upload resilience**: retry/queue + surface silent failures (UX-2) — protects the core field workflow.
5. **Gate the Dashboard export queries + fix the photo N+1** (PERF-1) — biggest recurring backend cost.
6. **Mount a real toast provider** and standardize feedback (UX-3); add **unsaved-changes guard + robust CSV parsing** (UX-4).
7. **Code splitting + lazy export libs + thumbnails/lazy images** (PERF-2, PERF-4) — front-end load wins.
8. **SSRF fix, signed photo URLs, repo hygiene** (SEC-5, SEC-6, SEC-7); **a11y pass** (UX-6); **streaming/cancelable AI + bulk concurrency** (UX-5, PERF-6).

---

*Prepared July 4, 2026. All High/Critical findings cite a file:line verified against the source. No application code was modified in producing this report.*
