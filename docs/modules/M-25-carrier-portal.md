# M-25 — Carrier Portal v1

**Status:** ✅ Complete · **Phase:** 2 · **Date:** 2026-08-04

## What was built

### `/portal/carrier` — My Documents
- Status tiles: **dispatch agreement** (signed date vs "awaiting signature"),
  documents in review count, insurance expiry.
- Document table: type, file name, review status badge (in review / approved /
  **rejected with the staff review note shown to the carrier** / expired),
  upload date, and a **Download** button — a ≤5-minute signed URL minted by
  the `getMyDocumentSignedUrl` server action (S-01).
- **Replacement uploads**: doc-type select (wizard four + NOA + other) feeding
  the shared `DocUpload` dropzone (extracted from the M-20 wizard into
  `src/components/onboarding/DocUpload.tsx`); new files land as `pending` and
  re-enter the M-24 review queue; the list refreshes on completion.

### `/portal/carrier/profile` — My Profile
Account block (name, email, phone, language) + company block (MC/DOT, state,
factoring, insurance expiry, snapshot **dispatch fee %**, EIN shown only as
"on file (encrypted)" — never decrypted for display, agreement + active
status). Read-only with a "call us to update" note.

## Security (Q3 / S-01)
Every query runs on the **cookie-bound server client**: RLS policies
("carrier own record", "carrier own docs read", storage "carrier read own
folder") scope all data to the signed-in profile — no carrier id travels in
any request, so there is nothing to tamper with. Replacement uploads reuse
the M-21 action, which requires the owning session once a carrier is claimed.
Staff hitting `/portal/carrier` are redirected to `/portal/admin`. Pages are
`force-dynamic`, `noindex`, outside the sitemap (0 portal routes in the
prerender manifest).

## Judgment calls
- **Profile is read-only in v1**: MC, insurance and banking-adjacent data
  must stay staff-verified; self-service edits would bypass the compliance
  review that the documents flow enforces. Phone/language self-service is a
  cheap later add.
- Carrier-facing strings run through the `getV4`/`useV4` bridge (public-user
  surface) — they fall back to English until dictionary entries are added;
  the admin surface stays English by scope.
- An account whose carrier link hasn't been established (edge: manual signup)
  gets an honest "not linked yet" state instead of an error.

## DB changes
None. Reads: `carriers`, `documents`, `profiles`; writes only via the reused
M-21 upload action.

## Endpoints
Server action: `getMyDocumentSignedUrl` (carrier-scoped, 300 s).
`UPLOADABLE_DOC_TYPES` in `src/lib/validation/onboarding.ts` extends the
upload action's accepted types with `noa`/`other` for replacements.

## Env vars
None new.

## Verification
typecheck ✓ · lint ✓ · build ✓ (142 pages) · prerender-manifest: 0 portal
routes ✓

## Extension points
- "My loads" (M-30) becomes a third sidebar item using the same shell.
- Self-service phone/language edits: small server action + RLS "own profile
  update" already permits it.
- Document expiry (`expires_at`) can surface renewal nudges in the tiles.
