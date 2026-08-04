# M-34 — Dashboard: Dispatch + Marketing + Notifications modules

**Status:** ✅ Complete · **Phase:** 3 · **Date:** 2026-08-04

## What was built (all on `/portal/admin`, extending M-24)

### Dispatch module
- Tiles: active carriers, loads booked today, loads · 7d (with a per-status
  sub-line), **fees invoiced (open)** vs **fees collected** (sum of
  `dispatch_fee` at status `invoiced` / `paid`), **avg RPM** (Σgross ÷
  Σmiles over non-cancelled loads that carry both numbers — a true weighted
  average, not an average of ratios).
- **Active carriers by home state** badge cloud.
- **Load mix by equipment** badge cloud — derived from booked loads because
  the carriers table deliberately has no equipment column (a fleet can run
  several trailer types); the card says so on-screen.
- **Per-dispatcher performance** (F-09): loads, gross, fees, weighted avg
  RPM per dispatcher, sorted by gross; unattributed loads roll up under
  "Unassigned".

### Marketing module
- Confirmed newsletter subscribers (double opt-in `confirmed_at` set,
  not unsubscribed — S-05 semantics).
- Blog posts live / drafts (M-33 tie-in).
- **Lead sources** table from `carrier_leads.source` with share %.
- **GA4 / GSC tiles are honest placeholders** ("connect Google Analytics
  Data API / Search Console API (O-07)") — both APIs need a Google Cloud
  service account + property/site grants, an ops task with lead time that
  code cannot shortcut. No fake numbers.

### Notifications feed
Merged timeline (V4 `.timeline` vocabulary) of the 12 most recent
`email_log` entries and the 12 most recent **failed** `webhook_events`
(e-sign + Stripe), sorted by time, capped at 15, failures badged red. This
is the O-06/S-02 "did the machinery run" surface.

## Security
Everything reads through the cookie-bound client under staff RLS policies
(`email_log`, `webhook_events`, `subscribers`, `loads`, `carriers`,
`posts` all have staff-read policies from 0002). No new write surface.

## Judgment calls
- In-component aggregation over ≤1000-row reads (same call as M-24): at
  current volume this is faster to build and audit than SQL views; the
  module doc marks SQL views/RPCs as the scale-up path.
- "Loads today/week" buckets by `created_at` (booking date) — operational
  tempo, not delivery tempo; delivery-date reporting can come with the
  first real month of data.
- Successful webhook events are excluded from the feed (noise); failures
  and every email attempt are the actionable signal.

## DB changes
None.

## Env vars
None new. (Future GA4/GSC integration will need
`GOOGLE_SERVICE_ACCOUNT_JSON`, a GA4 property id and GSC site URL — O-07.)

## Verification
typecheck ✓ · lint ✓ · build ✓ · dashboard renders with empty datasets
(placeholder env) without errors ✓
