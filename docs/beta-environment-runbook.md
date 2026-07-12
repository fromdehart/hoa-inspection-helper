# Beta environment & promotion workflow

The `beta` branch is the home of the AI-native board work (see
`docs/product/ai-native-board-prd.md`). It deploys to **beta.happierblock.com** on a fully
isolated backend seeded from a **production snapshot**, so the board can test against real
data without any risk to the product people use today. Prod fixes flow *into* beta via
`git merge master`; features graduate *out* of beta via per-feature PRs to `master`.

Setup shape: **one Vercel project** (the existing `hoa-inspection-helper`) with
beta.happierblock.com as a **branch domain** on `beta`. Environment-variable scoping does
the isolation — prod values live only in the Production scope; Preview builds get the beta
Convex deploy key. (A fully separate Vercel project would also work and hard-walls the env
config, at the cost of a second dashboard forever; not needed for a solo admin.)

## The moving parts (prod vs beta)

| Layer    | Production                        | Beta                                                                 |
| -------- | --------------------------------- | -------------------------------------------------------------------- |
| Git      | `master` (production branch; protect: PRs only) | `beta` branch (long-lived)                              |
| Frontend | happierblock.com                  | beta.happierblock.com — branch domain on `beta`, same Vercel project |
| Backend  | Convex prod deployment            | **Separate Convex project** (`happier-block-beta`), seeded by snapshot |
| Auth     | Clerk production instance         | **Same Clerk production instance** (snapshot rows reference prod Clerk user IDs — a different instance would orphan every membership). Add beta.happierblock.com to allowed origins/redirects. |
| Uploads  | VPS `hoauploads.bigideer.com`     | Same server — add beta origin to `ALLOWED_ORIGIN` (comma list supported). ⚠️ Shared store: deleting a photo from beta deletes the real file. Split `UPLOADS_DIR` if this bites. |
| Email    | Resend                            | **`RESEND_API_KEY` unset — non-negotiable.** Snapshot data contains real homeowner emails; on beta every send must fail visibly. Any future email path must tolerate the key being absent. |

Isolation rule: the beta frontend must only ever be built against the beta Convex URL.
`VITE_CONVEX_URL` is baked at build time; the build script + env scoping enforce this.

## How builds route (already in the repo)

`package.json` has a `vercel-build` script (used automatically by `@vercel/static-build`):

- **Production builds** (`master`): unchanged — `npm run build` with the Production-scoped
  `VITE_CONVEX_URL`. Prod Convex functions still deploy however you deploy them today.
- **Preview builds with `CONVEX_DEPLOY_KEY`** (the `beta` branch): runs
  `npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build'` — deploys
  beta Convex functions and builds the frontend against the beta URL, atomically.
- **Preview builds without a deploy key** (any other branch): plain `npm run build` with no
  Convex URL — the page loads but connects to nothing. Safe by construction.

## Vercel state (done, July 2026 — via CLI)

- ✅ `VITE_CONVEX_URL` removed from Preview scope (was the prod-leak hazard). It remains
  Production-only. `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_UPLOAD_SERVER_URL`,
  `VITE_CHALLENGE_ID` stay in Preview too — beta shares Clerk + the VPS, so same values.
- ✅ Deployment protection is `all_except_custom_domains`: beta.happierblock.com is public;
  other branch previews stay behind Vercel auth. No change needed.
- ✅ happierblock.com is on Vercel nameservers → no manual CNAME; the branch domain is
  served automatically once attached.
- ✅ beta.happierblock.com attached to the project with `gitBranch: beta` (API requires the
  branch to exist on GitHub first, so this happens right after the first `git push origin beta`):
  ```bash
  npx vercel api /v10/projects/prj_XxpVkQMG5EOy9zEE13s4Wh8KhheE/domains \
    -X POST -F name=beta.happierblock.com -F gitBranch=beta
  ```

## Remaining one-time setup

### 1. Beta Convex project env + snapshot
Project `happier-block-beta` (created). Still to do:
1. Snapshot prod → beta:
   ```bash
   npx convex export --path prod-snapshot.zip          # with prod credentials
   npx convex import prod-snapshot.zip --replace        # against happier-block-beta
   ```
   Re-run on demand to refresh; **never** import beta data back into prod.
2. Environment on the beta deployment (mirror prod, then override):
   - `RESEND_API_KEY` — **do not set**
   - `PUBLIC_BASE_URL` / `APP_BASE_URL` = `https://beta.happierblock.com`
   - `CLERK_JWT_ISSUER_DOMAIN` = same as prod (shared instance)
   - `UPLOAD_SERVER_URL` / `UPLOAD_DELETE_TOKEN` = same as prod (shared VPS)
   - `OPENAI_API_KEY` = same, or a separate key for cost attribution
   - `DEMO_SEED_SECRET` / `PLATFORM_BOOTSTRAP_SECRET` = new random values

### 2. Beta deploy key into Vercel (Preview scope, pinned to `beta`)
Convex dashboard → `happier-block-beta` → Settings → generate a **production deploy key**
(the beta project's prod deployment IS the beta backend), then:
```bash
npx vercel env add CONVEX_DEPLOY_KEY preview beta   # paste the key when prompted
```
Pinning to the `beta` branch means other branch previews get no key (safe fallback build).

### 3. Clerk
Prod Clerk instance → add `https://beta.happierblock.com` to allowed origins/redirect URLs.

### 4. VPS upload server
```
ALLOWED_ORIGIN=https://happierblock.com,https://beta.happierblock.com
```
and restart the upload service. Remember the shared-store caveat above.

### 5. GitHub
Protect `master`: require a pull request, block direct pushes.

## Day-to-day

```
master (live fixes) ──git merge master──▶ beta ──(push, auto)──▶ beta.happierblock.com
feature branches ────────merge──────────▶ beta
stable feature slice ◀──PR beta→master (flag-gated)── graduation
```

- Work on feature branches off `beta`; merge to `beta` to deploy.
- Pull prod fixes regularly: `git checkout beta && git merge master && git push`.
- Graduate a feature: PR the flag-gated slice `beta → master` once it meets the PRD's
  graduation criteria (§13). Prod HOAs opt in by feature flag.
- Refresh data when drift matters: re-run the snapshot import (beta-created test
  cases/motions are lost on refresh — export anything worth keeping first).

## Sanity checks after setup

- beta.happierblock.com network tab: Convex WebSocket points at the **beta** `.convex.cloud`
  URL, never prod.
- Sign in with your normal account (shared Clerk) → your memberships resolve (snapshot).
- Generate a letter and try to email it → the send **fails visibly** (Resend unset).
- Change a property on beta → confirm prod is untouched.
- Push a scratch branch → its preview builds without any Convex URL (safe fallback), and its
  vercel.app URL requires Vercel auth (protection).
- `git push origin master` directly → rejected (branch protection, once enabled).
