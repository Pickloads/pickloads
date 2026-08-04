# M-32 — Shipper Portal v1

**Status:** ✅ Complete · **Phase:** 3 · **Date:** 2026-08-04

## What was built

### `/portal/shipper` — My Quotes
- Tiles: quote requests, open, rates quoted.
- Quote table: requested date, lane (zip → zip), pickup date, commodity,
  weight, equipment, frequency, **quoted rate** (when staff set one) and a
  **shipper-facing status** mapped from the internal `lead_status` pipeline
  (Received / In review / Quoted / Booked / Closed — internal CRM stages are
  not leaked verbatim).
- "Request a new quote" links to the public `/shippers` quote form (the
  service-role write path from M-14 — no new write surface).
- Strings run through the `getV4` bridge (public-user surface).

### Role routing
`portalHomeFor(role)` added to `src/lib/auth.ts`; `/portal` router,
`requireStaff`, the three carrier pages and the sidebar now send each role
to its own surface (staff ⇄ carrier ⇄ shipper never see each other's
pages). Sidebar gains a "Shipper portal" section.

## The data-link limitation (honest and documented)
The schema has **no FK between `freight_quotes` and auth users** — quotes
arrive from the public form where email is the only identity captured, and
the schema is FINAL for this phase. Therefore:

- Quotes are matched on the signed-in user's **Supabase-verified auth
  email** (`session.email` from `auth.getUser()`, never request input).
- Because no "shipper reads own quotes" RLS policy exists, the read uses the
  **admin client strictly scoped to `.eq("email", session.email)`** after
  the server-side role gate. This is a documented, deliberate deviation from
  the cookie-bound-only rule, on a read-only surface, with the filter bound
  to a server-verified value.
- Quotes submitted under a different email won't appear; the empty state
  explains exactly that and offers the phone-call fallback.
- **Phase 4 migration**: add `freight_quotes.shipper_id uuid references
  profiles`, backfill by email, add the RLS policy, then move this page to
  the cookie-bound client.

Shipper accounts are created by staff invite (S-04 invite-only creation with
`role='shipper'`) — there is no public shipper signup, which keeps the
email-matching approach acceptable: the email is assigned by us, verified by
Supabase auth, and not user-editable.

## DB changes
None.

## Endpoints
None new (read-only page; quote requests go through the existing M-14 form).

## Env vars
None new.

## Verification
typecheck ✓ · lint ✓ · build ✓ · portal excluded from sitemap/prerender ✓ ·
non-shipper roles bounce to their own portal ✓
