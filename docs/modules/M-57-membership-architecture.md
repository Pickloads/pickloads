# M-57 — Membership Architecture Surfacing

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

## What / why

Decision D4 shipped multi-user memberships as data model + RLS (M-50) with a
single-user UI. This module makes the app layer match the data model
everywhere, so "invite a teammate" later is **one INSERT, zero page rewrites**.

**Doctrine:** customer-portal code resolves "my company" ONLY through
`src/lib/memberships.ts` (`getMyCarrierId` / `getMyShipperId`, which mirror
the 0009 `my_carrier_ids()` / `my_shipper_ids()` RLS helpers). Filtering
`carriers`/`shippers` by `profile_id` is the forbidden legacy pattern —
`carriers.profile_id` remains only for back-compat fallbacks.

## Verified + fixed

| Site | Before | After |
|---|---|---|
| `completeOnboarding` (M-20 wizard) | linked `carriers.profile_id` only — **a post-M-50 wizard signup would have had NO membership row**, so the membership-routed portal and every 0009 policy saw nothing | also inserts the owner `carrier_memberships` row (failure aborts, same as the link) |
| `/portal/carrier/loads` | `carriers.eq(profile_id)` | `requireCarrier` + `getMyCarrierId` (last M-25-era lookup — all other carrier/shipper pages were built membership-first in M-55/M-56) |
| `generateLoadInvoice` (billing email) | `carriers.profile_id` → auth email | **owner membership first**, `profile_id` fallback for pre-membership rows |
| Daily cron insurance alerts | `carriers.profile_id` → auth email | owner membership (one batched `.in()` read), `profile_id` fallback |
| All M-55/M-56 pages/actions | — | audited: already membership-routed |

Legitimate `profile_id` filters (person-scoped, NOT company lookups):
`notifications`, `user_preferences`, `support_threads`, profile row reads,
and the M-32 legacy shipper email-match path (documented, no membership).

**Pinned by test:** `tests/unit/membership-doctrine.test.ts` statically scans
every `src/app/[locale]/portal/{carrier,shipper}` file and fails if a
`from("carriers"/"shippers")` query filters `profile_id` without the helpers.

## Future invite-teammate extension path

1. UI: an "Invite teammate" card on Company Profile / Company Settings
   (owner-only: read own membership `role`).
2. Action: guard stack → create invite row (token hash, expiring — reuse the
   M-58 `staff_invites` shape with a `carrier_id`/`shipper_id` column, or a
   dedicated `member_invites` table) → email link.
3. Accept: verified signup (M-52 never-auto-confirm path) → service-role
   `INSERT INTO carrier_memberships (carrier_id, profile_id, role='member')`.
4. Nothing else changes: every page/RLS policy already resolves through
   memberships; `membership_role='member'` exists since 0005. Owner-only
   surfaces (invite/remove teammate) check `role='owner'` on the membership.
5. Removal = membership DELETE (access disappears portal-wide instantly).

## Gates

No DB or env changes. Typecheck / lint / build clean; **124 unit** (+1 file:
one per-portal-file doctrine assertion each) + 17 e2e green.
