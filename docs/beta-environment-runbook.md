# Beta environment & promotion workflow

The `beta` branch is the home of the AI-native board work (see
`docs/product/ai-native-board-prd.md`). It deploys to **beta.happierblock.com** on a fully
isolated backend seeded from a **production snapshot**, so the board can test against real
data without any risk to the product people use today. Prod fixes flow *into* beta via
`git merge master`; features graduate *out* of beta via per-feature PRs to `master`.

This supersedes the earlier QA-environment design (qa.happierblock.com) — same isolation
principles, but beta is a long-lived product track, not a staging gate.

## The moving parts (prod vs beta)

| Layer    | Production                        | Beta                                                                 |
| -------- | --------------------------------- | -------------------------------------------------------------------- |
| Git      | `master` (protect: PRs only)      | `beta` branch (long-lived)                                            |
| Frontend | happierblock.com (Vercel proj #1) | beta.happierblock.com — **separate Vercel project**, Production Branch = `beta` |
| Backend  | Convex prod deployment            | **New Convex project** (e.g. `happier-block-beta`), seeded by snapshot |
| Auth     | Clerk production instance         | **Same Clerk production instance** (snapshot rows reference prod Clerk user IDs — a different instance would orphan every membership). Add beta.happierblock.com to allowed origins/redirects. |
| Uploads  | VPS `hoauploads.bigideer.com`     | Same server — add beta origin to `ALLOWED_ORIGIN` (comma list supported). ⚠️ Shared store: deleting a photo from beta deletes the real file. Split `UPLOADS_DIR` if this bites. |
| Email    | Resend                            | **`RESEND_API_KEY` unset — non-negotiable.** Snapshot data contains real homeowner emails; on beta every send must fail visibly. Any future email path must tolerate the key being absent. |

Isolation rule: the beta frontend must only ever be built against the beta Convex URL.
`VITE_CONVEX_URL` is baked at build time, so the per-Vercel-project `CONVEX_DEPLOY_KEY`
is what enforces this.

## ⚠️ Before pushing any branch — two safety fixes on the EXISTING Vercel project

1. **Scope env vars to Production.** Vercel → (current project) → Settings → Environment
   Variables: anything set for "All Environments" (`VITE_CONVEX_URL`,
   `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_UPLOAD_SERVER_URL`, `CONVEX_DEPLOY_KEY`) → change to
   **Production only**. Otherwise every pushed branch gets a preview build bound to the
   production backend.
2. **Protect `master` on GitHub.** Repo → Settings → Branches → require a pull request,
   block direct pushes.

Only after #1: `git push -u origin beta product-research ui-redesign` (offsite backup).

## One-time setup

### 1. Beta Convex project + production snapshot
1. Convex dashboard → New project → `happier-block-beta`. Its *production* deployment IS
   the beta backend. Generate a production deploy key (this is beta's `CONVEX_DEPLOY_KEY`).
2. Snapshot prod → beta:
   ```bash
   # export from the real prod deployment
   npx convex export --path prod-snapshot.zip          # run with prod credentials
   # import into the beta project's deployment
   npx convex import prod-snapshot.zip --replace        # run against happier-block-beta
   ```
   Re-run on demand to refresh; **never** import beta data back into prod.
3. Environment (mirror prod, then override):
   - `RESEND_API_KEY` — **do not set**
   - `PUBLIC_BASE_URL` / `APP_BASE_URL` = `https://beta.happierblock.com`
   - `CLERK_JWT_ISSUER_DOMAIN` = same as prod (shared instance)
   - `UPLOAD_SERVER_URL` / `UPLOAD_DELETE_TOKEN` = same as prod (shared VPS)
   - `OPENAI_API_KEY` = same or a separate key for cost attribution
   - `DEMO_SEED_SECRET` / `PLATFORM_BOOTSTRAP_SECRET` = new random values

### 2. Second Vercel project
1. Vercel → Add New Project → import the **same** GitHub repo.
2. Settings → Git → Production Branch = `beta`.
3. Settings → Domains → add `beta.happierblock.com`; DNS: `CNAME beta → cname.vercel-dns.com`.
4. Env (Production scope of *this* project): `CONVEX_DEPLOY_KEY` = beta project key,
   `VITE_CLERK_PUBLISHABLE_KEY` = prod pk, `VITE_UPLOAD_SERVER_URL` = VPS URL.
5. Build command:
   ```
   npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build'
   ```
   Each push to `beta` deploys beta Convex functions + frontend atomically.

### 3. Clerk
Prod Clerk instance → add `https://beta.happierblock.com` to allowed origins/redirect URLs.
(Everyone's existing accounts work on beta immediately — that's the point of the shared
instance + snapshot pairing.)

### 4. VPS upload server
```
ALLOWED_ORIGIN=https://happierblock.com,https://beta.happierblock.com
```
and restart the upload service. Remember the shared-store caveat in the table above.

## Day-to-day

```
master (live fixes) ──git merge master──▶ beta ──(push, auto)──▶ beta.happierblock.com
feature branches ────────merge──────────▶ beta
stable feature slice ◀──PR beta→master (flag-gated)── graduation
```

- Work on feature branches off `beta`; merge to `beta` to deploy.
- Pull prod fixes regularly: `git checkout beta && git merge master && git push`.
- Graduate a feature: cherry-pick/PR the flag-gated slice `beta → master` once it meets the
  PRD's graduation criteria (§13). Prod HOAs opt in by feature flag.
- Refresh data when drift matters: re-run the snapshot import (beta-created test
  cases/motions are lost on refresh — export anything worth keeping first).

## Sanity checks after setup

- beta.happierblock.com network tab: Convex WebSocket points at the **beta** `.convex.cloud`
  URL, never prod.
- Sign in with your normal account (shared Clerk) → your memberships resolve (snapshot).
- Generate a letter and try to email it → the send **fails visibly** (Resend unset).
- Change a property on beta → confirm prod is untouched.
- Push a scratch branch → its preview build does NOT carry prod env values (scoping fix).
- `git push origin master` directly → rejected (branch protection).
