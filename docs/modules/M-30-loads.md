# M-30 — Loads

**Status:** ✅ Complete · **Phase:** 3 · **Date:** 2026-08-04

## What was built

### Types
`database.types.ts` extended with the Phase 3 `loads` and `posts` rows
(hand-authored to match `supabase/migrations/0001` exactly, same pattern as
M-02b). `loads.fee_pct_applied` is typed `number | null` because the DDL
relaxed NOT NULL so the BEFORE INSERT trigger can fill it (F-03); the CHECK
constraint guarantees it is always present after insert.

### `/portal/admin/loads` — staff loads board
- Filterable list (status / carrier / dispatcher via GET params, validated
  server-side: enum allow-list + UUID regex), 200 most recent.
- Columns: carrier, lane (origin → dest), pickup, equipment, gross, **RPM
  (gross/miles)**, dispatch fee + snapshotted %, dispatcher, status badge.
- Totals tiles: loads shown, gross, dispatch fees (over the filtered set).
- **Status transitions** as per-row buttons driven by the shared state
  machine `LOAD_TRANSITIONS` (src/lib/loads.ts):
  `booked → in_transit → delivered → invoiced → paid`, cancellable until
  `invoiced`. The server action re-reads the current status and re-checks the
  transition (plus an `.eq("status", …)` concurrency guard) — the client
  buttons are convenience, not authority.

### `/portal/admin/loads/new` — book a load
Carrier select (**active carriers only** — an inactive carrier has no signed
agreement to bill against), broker (+MC#), origin/dest city+state, pickup and
delivery dates, equipment, gross rate, miles. `dispatcher_id` is stamped
server-side from the session (F-09) and **`fee_pct_applied` is omitted on
insert** so the DB trigger snapshots the carrier's current
`dispatch_fee_pct` and computes `dispatch_fee` (F-03).

### `/portal/carrier/loads` — carrier "My Loads"
Read-only: lane, pickup, broker, equipment, gross, RPM, **dispatch fee with
the applied %** (fee transparency is the brand promise), status. Tiles for
loads dispatched / gross hauled / fees on delivered+ loads, plus a plain-
English note that the fee % is snapshotted per load. Strings run through the
`getV4` bridge; staff hitting this page are redirected to the admin board.

## Security (Q3)
All reads/writes on the cookie-bound server client: staff pages under
"staff manage loads", the carrier page under "carrier own loads" — no
carrier id ever travels in a request. Explicit `staffSession()` role check
before any action; Zod validation on every input (uuid, enum, 2-letter
states, date shape, bounded numerics). Pages `force-dynamic`, `noindex`,
outside the sitemap.

## Judgment calls
- **Manual `invoiced`/`paid` transitions stay allowed** even though M-31
  automates them via Stripe: carriers occasionally pay by check/Zelle and the
  books must be closable without a Stripe object. `paid` and `cancelled` are
  terminal.
- Load documents (rate con / BOL / POD attach into `rate_con_path` etc.) are
  deferred: the columns exist, but the upload surface reuses M-21's bucket
  machinery and is a small follow-on — booking/billing flow doesn't block on
  it.
- No pagination yet (200-row cap + filters); dispatch volume at this stage is
  tens of loads/week.

## DB changes
None (schema FINAL since 0001). New code paths only.

## Endpoints
Server actions: `createLoad`, `updateLoadStatus` (src/app/actions/loads.ts).
Shared logic: `src/lib/loads.ts` (state machine, labels, money/RPM/lane
formatters).

## Env vars
None new.

## Extension points
M-31 adds the "Generate invoice" button on delivered rows + Stripe payment
history to the admin board. The dashboard Dispatch module (M-34) aggregates
this table.

## Verification
typecheck ✓ · lint ✓ · build ✓ · prerender-manifest: 0 portal routes ✓
