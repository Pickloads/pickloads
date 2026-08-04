# M-51 — /portal Selection Page + Real Auth Links

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

## What was built

- **`/portal` selection page** (`src/app/[locale]/portal/page.tsx`) — the
  directive's pre-auth two-door chooser, composed strictly from V4 vocabulary
  (`.page-hero`, `.services-grid`/`.svc` dispatch/broker cards, `.btn`
  vocabulary). Each card describes the portal's real, shipped actions
  (documents/agreement/loads for carriers; quote tracking/rates for shippers —
  quote-request wording only per decision D1, no brokerage claims) with a
  Sign-In button and a create-account pointer. Signed-in visitors are
  role-routed exactly as before (`portalHomeFor`), so nothing changes for
  existing users. Staff note explains the shared door.
- **Middleware** (`src/lib/supabase/middleware.ts`): `/portal` itself is now
  public; every `/portal/*` subpath keeps the auth wall (locale-prefixed paths
  included, unchanged).
- **Portal layout**: with no session it renders children without the sidebar
  shell — the only reachable child pre-auth is the selection page, which
  brings its own public chrome (Topbar/SiteNav/Footer).
- **Header (`SiteNav`)**: `Login` entry in the nav links (→ `/login`) +
  secondary `Get Started →` ghost button (→ `/portal`; M-52 repoints it to
  `/create-account` once that route exists). Mobile menu gains `Login`,
  `Get Started →` and `Support` entries.
- **Topbar**: the last Coming-Soon toast is gone — `Shipper Login` is now a
  real `/login` link next to `Carrier Login`. `ComingSoonLink` component
  deleted (no remaining references).
- **Footer**: `Support` link (→ `/contact`; the in-portal support-threads
  module is a later phase — decision D2, honest staffed-inbox route today).

## i18n

22 new public strings through the SUPPLEMENTAL pipeline (`scripts/
extract-i18n.mjs`) with authored **es/fr**; ru/ht mirror English pending
native review (M-42 precedent). Catalog: 344 → **366 strings × 5 locales**.

## SEO / a11y / responsive

- Selection page is `noindex` + robots-disallowed by design — it is a utility
  door, not a landing page (documented judgment call).
- Cards collapse to one column ≤960px via the existing `.services-grid` rule;
  buttons/links are ≥24px targets; headings hierarchical (h1 hero → h3 cards).

## Tests

`tests/e2e/smoke.spec.ts` updated: the old "/portal redirects to /login" smoke
test now asserts the selection page renders both cards, and a new test pins
the auth wall on `/portal/carrier` (the actual protected surface).

## Deviations / notes

- `robots.txt` continues to disallow `/portal` (unchanged M-15 rule).
- No DB changes, no new env vars.
