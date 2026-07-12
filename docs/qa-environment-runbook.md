# QA environment & promotion workflow

Goal: push work to GitHub anytime (offsite backup) without touching production; a
long-lived `qa` branch auto-deploys to **qa.happierblock.com** on a fully isolated
backend; promoting = merging `qa` → `master`, which deploys production. Share the QA
URL freely — it can never write to production data.

## The moving parts (prod vs QA)

| Layer     | Production                          | QA                                                    |
| --------- | ----------------------------------- | ----------------------------------------------------- |
| Git       | `master` (protected)                | `qa` branch (long-lived)                              |
| Frontend  | happierblock.com (Vercel)           | qa.happierblock.com — same Vercel project, branch domain on `qa` |
| Backend   | Convex prod deployment              | **Separate Convex project** (e.g. `happier-block-qa`) |
| Auth      | Clerk production instance           | Clerk **development** instance keys                   |
| Uploads   | VPS `hoauploads.bigideer.com`       | Same server — add QA origin to `ALLOWED_ORIGIN` (comma list already supported) |
| Email     | Resend                              | Leave `RESEND_API_KEY` unset on QA (sends fail visibly) or a `qa@` sender; QA data is demo-only |

Isolation rule: **the QA frontend must only ever be built against the QA Convex URL.**
The Convex URL is baked in at build time (`VITE_CONVEX_URL`), so environment scoping in
Vercel is what enforces this.

## ⚠️ Do this first — two safety fixes

1. **Scope existing Vercel env vars to Production.** In Vercel → Project → Settings →
   Environment Variables: if `VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, or
   `VITE_UPLOAD_SERVER_URL` are set for "All Environments", change them to
   **Production only**. Otherwise any branch you push gets a preview build pointed at
   the production backend.
2. **Protect `master` on GitHub.** Repo → Settings → Branches → add a ruleset/protection
   on `master`: require a pull request, block direct pushes. After this, nothing
   reaches production without an explicit merge.

Once those are done, pushing `ui-redesign` / `case-tracking` to GitHub is a safe backup.

## One-time setup

### 1. QA Convex project
```bash
# From the repo — creates a new project; pick a new name like happier-block-qa
npx convex deploy   # run once with a fresh project via `npx convex dev --configure` on a scratch checkout,
                    # or create the project in the Convex dashboard, then grab its Production deploy key
```
Practical path: Convex dashboard → New project → `happier-block-qa` → Settings →
Generate **production deploy key** (this is QA's deploy key; the QA project's "prod"
deployment IS the QA backend).

Set its environment (mirror prod, QA values), e.g.:
```bash
npx convex env set --prod --project happier-block-qa CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
npx convex env set ... OPENAI_API_KEY sk-...
npx convex env set ... PUBLIC_BASE_URL https://qa.happierblock.com
npx convex env set ... APP_BASE_URL https://qa.happierblock.com
npx convex env set ... UPLOAD_SERVER_URL https://hoauploads.bigideer.com
npx convex env set ... UPLOAD_DELETE_TOKEN <same token as VPS>
npx convex env set ... DEMO_SEED_SECRET / PLATFORM_BOOTSTRAP_SECRET <new random values>
# Deliberately skip RESEND_API_KEY at first — QA can't email anyone by accident.
```
Seed it: `npm run seed:platform-admin` + `npm run seed:demo` (pointed at the QA
deployment), then flip feature flags on the demo HOA via `/platform`.

**Never import production data (real homeowner emails) into QA.**

### 2. Clerk
Use your existing Clerk **development instance** keys for QA (dev instances are not
domain-locked; users see a small "development mode" badge — fine for QA). QA gets its
own user pool: invite yourself + testers there. `CLERK_JWT_ISSUER_DOMAIN` on the QA
Convex project must be the dev instance issuer.

### 3. Vercel: branch domain + env + build command
1. **Domains**: Project → Settings → Domains → Add `qa.happierblock.com` → assign to
   Git branch `qa`.
2. **DNS**: add `CNAME qa → cname.vercel-dns.com` at your DNS host.
3. **Environment variables** (Preview scope — optionally pinned to branch `qa`):
   - `VITE_CLERK_PUBLISHABLE_KEY` = Clerk dev instance pk
   - `VITE_UPLOAD_SERVER_URL` = `https://hoauploads.bigideer.com`
   - `CONVEX_DEPLOY_KEY` = the QA project deploy key
   And in **Production scope**: `CONVEX_DEPLOY_KEY` = the real prod deploy key
   (Convex dashboard → prod project → Settings).
4. **Build command** (Project → Settings → Build): 
   ```
   npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build'
   ```
   This is the canonical Convex↔Vercel pattern: each Vercel build first deploys the
   Convex functions to whichever deployment its `CONVEX_DEPLOY_KEY` points at, then
   builds the SPA with the matching `VITE_CONVEX_URL` injected. Functions + frontend
   stay atomic in *both* environments, and `VITE_CONVEX_URL` no longer needs to be set
   by hand. (Note: this means merging to `master` also deploys Convex prod functions —
   that's what "promote" should mean. If you currently run `npx convex deploy` by hand
   for prod, this replaces it.)

### 4. VPS upload server
On the VPS, edit the service env:
```
ALLOWED_ORIGIN=https://happierblock.com,https://qa.happierblock.com
```
and restart the upload service. (The server already parses a comma list; native
Capacitor origins are always allowed.) QA photos land in the same uploads dir — they're
keyed by QA property IDs so they don't collide; split `UPLOADS_DIR` later if you care.

### 5. Create the branch
```bash
git checkout -b qa ui-redesign     # QA starts as the redesign + case tracking
git push -u origin qa
```

## Day-to-day workflow

```
feature branches ──merge──▶ qa ──(auto)──▶ qa.happierblock.com
                             │
                        test & share
                             │
                     PR: qa → master ──(auto)──▶ happierblock.com
```

1. **Work + backup**: commit on feature branches (`ui-redesign`, …) and push whenever.
   Pushing a feature branch never deploys anywhere meaningful (Vercel may build an
   anonymous preview URL — with env scoping done, previews use the QA backend, so even
   those are harmless).
2. **Stage**: `git checkout qa && git merge <feature> && git push`. A couple of minutes
   later qa.happierblock.com is running it — QA Convex functions and all.
3. **Share**: send qa.happierblock.com to reviewers; they sign in via the Clerk dev
   instance (invite them), and see only demo data.
4. **Promote**: open a PR `qa → master`, review the diff, merge. Vercel builds master →
   Convex prod functions deploy → happierblock.com updates. (For schema changes that
   need a backfill, run the migration command against prod right after — same as today.)
5. **Hotfixes**: branch off `master`, PR straight back to `master`, then merge `master`
   back into `qa` so QA doesn't drift.

## Sanity checks after setup

- Open qa.happierblock.com → view-source/network tab: the Convex WebSocket must point at
  the **QA** `.convex.cloud` URL, never prod.
- Sign in on QA → confirm you're in the Clerk dev-instance user pool.
- Upload an inspector photo on QA → lands via the VPS with the QA origin allowed.
- Push a trivial commit to a scratch branch → confirm the preview build does NOT use
  prod env values.
- Try a direct `git push origin master` → GitHub should reject it.
