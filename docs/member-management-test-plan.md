# Member Management Verification

## Automated checks run
- `npx convex codegen`
- `npm run build`

## Manual test checklist
- Sign in as admin, go to `/admin/members`, and confirm current members list renders.
- Add a brand new email as `inspector`; verify success toast and new row in table.
- Add a brand new email as `admin`; verify success toast and new admin row.
- Add an existing Clerk user email already in the same HOA; verify role is attached/updated without duplicate errors.
- Try adding an invalid email and verify the backend rejects with a validation message.
- Change a member role from `inspector` to `admin` and verify list updates.
- Remove an `inspector` and verify row disappears from list.
- Remove an `admin` while multiple admins exist and verify success.
- Attempt to demote the only remaining `admin` and verify the backend blocks the change.
- Attempt to remove the only remaining `admin` and verify the backend blocks the action.
- Confirm a non-admin user cannot access `/admin/members` due to `RoleGuard`.

## Known environment requirement
- Convex must have `CLERK_SECRET_KEY` configured for pre-create flow.
