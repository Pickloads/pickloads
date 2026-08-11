# M-74 — Shipper Shipment List + Detail

**Status:** ✅ Complete (validated on PostgreSQL 16) · **Phase:** B (tracking
core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-74 —
*"Shipper `/portal/shipper/shipments` + `[shipmentId]`: server-side pagination,
all §11 filters, detail with timeline/ETA/map slot/documents/**invoice
status/contacts/update history**, summary-vs-history query split"* — with the
three bolded items **restored** per the plan's §4 table (§11 detail) and §25
(performance). Authority: `docs/DIRECTIVE-tracking.md` §§2, 3, 7, 11, 16, 19,
22, 23, 24, 25, 30.

Vocabulary and DTO: **`docs/modules/M-70-shipment-domain.md`** — every page
here calls `toShipperDto`, never a raw row. Schema: **M-71** (0017–0018),
**M-72** (0019), **M-73** (0020). One new migration, **0021**.

Timeline component, phrase library and the `shipment` i18n namespace are
**M-73's, reused** — see *How*. The dispatcher board is M-75, the documents
module M-77, the map M-80. Nothing here touches any of them.

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0021_invoice_shipment_link.sql` | `invoices.shipment_id` + `invoices.shipper_id`, `carrier_id` NOT NULL → `invoices_party_present` CHECK, 2 partial indexes, 1 read policy |
| `src/lib/shipments/shipper-list.ts` | §11's nine filters, the §25 bound, exact-count pagination, the §2 gate probe |
| `src/lib/shipments/shipper-detail.ts` | The §25 summary/history split, invoice status, contacts + M-71's visibility rule |
| `src/lib/shipments/shipper-tiles.ts` | §11's dashboard counts, operating-time-zone day bounds, `head:true` everywhere |
| `src/components/portal/ShipmentListView.tsx` | Filter bar, `.ptable--cards` table, pager |
| `src/components/portal/ShipmentDetailView.tsx` | §11's ten detail blocks in §22's mobile priority order |
| `src/components/portal/ShipperTiles.tsx` | Tiles, with `null` ≠ `0` |
| `src/app/[locale]/portal/shipper/shipments/page.tsx` | The list route |
| `src/app/[locale]/portal/shipper/shipments/[shipmentId]/page.tsx` | The detail route |
| `src/app/portal.css` | `.psh-*` + the dark-surface overrides for the reused `.track-*` components |
| `scripts/extract-i18n.mjs` + `messages/*.json` | 52 portal labels (v4 supplemental) + `shipment.party.*` ×6 |

Changed in place: `src/lib/shipments/public-timeline.ts` (prop widened),
`src/components/tracking/TrackingTimeline.tsx` (prop widened + heading id),
`src/lib/shipments/types.ts` (`partyRoleKey()`),
`src/components/portal/PortalSidebar.tsx` (one nav entry),
`src/app/[locale]/portal/shipper/page.tsx` (extended, not replaced),
`src/lib/supabase/database.types.ts` (0021).

Tests: `tests/unit/shipment-shipper-list.test.ts` (45) ·
`tests/unit/shipment-shipper-detail.test.ts` (27) ·
`tests/unit/shipment-shipper-tiles.test.ts` (25) ·
`tests/unit/shipper-shipments-a11y.test.tsx` (42) ·
`tests/unit/stubs/recording-supabase.ts` ·
`tests/integration/shipper-shipments.test.ts` (31) +
`tests/integration/helpers/psql-rls-supabase.ts` ·
`supabase/tests/{10_fixtures,20_rls_isolation}.sql` (§10, +29) ·
`tests/e2e/shipper-shipments.spec.ts` (5) + both new routes added to the
responsive suite's session-gate list.

Migrations **0001–0004 remain frozen**; 0017–0020 are untouched.

---

## Why

### Why the reads live in `src/lib/shipments/`, not in the pages

§25 makes two claims a page body cannot honestly carry: *"server-side
pagination"* and *"do not load every shipment into the browser."* A
`.limit(200)` typed into a route component is a promise that has to be
re-checked by eye on every edit, and the plan's §4 table records that six of
§25's eleven requirements were unaddressed before this module.

Here the bound is a constant, the range is computed by one exported function,
and `tests/unit/shipment-shipper-list.test.ts` asserts over a **recording query
builder** that no reachable code path issues a `shipments` select without a
`range()` whose span is at most `MAX_PAGE_SIZE`. The integration lane repeats
the assertion against real SQL by reading the emitted `limit`. That is the
difference between a limit and a proof.

### Why the cookie-bound client, and why there is no fallback

Every function takes the caller's `createClient()` server client, so every read
runs under 0018's `"shipper member read shipments"`, 0019's shipper event bands
and 0021's new invoice policy. `tryCreateAdminClient` is imported by neither
lib nor page, and a unit test scans all four files for `supabase/admin` and
`SERVICE_ROLE` to keep it that way.

M-56's `shipper-quotes.ts` has a documented legacy path — a quote can arrive
before an account exists and is later claimed by a Supabase-verified email.
**There is deliberately no analogue here.** A shipment is created by dispatch
*with* a `shipper_id`; an account with no membership therefore has no shipments
by construction, and the page says exactly that rather than reaching for a
service-role read to be helpful.

### Why exact-count pagination for the list and keyset for the history

Two different questions, two different answers, both argued rather than
inherited:

- **The list** must render "Page 3 of 9" and let a customer jump to the last
  page, because someone hunting a March shipment does exactly that. Exact count
  + `range()` gives that; keyset does not. The order key is `(created_at desc,
  id desc)` — **total**, so two shipments sharing a timestamp cannot straddle a
  page boundary — and `idx_shipments_shipper` was built by M-71 as
  `(shipper_id, status, created_at desc)` for this query.
- **The history** is read strictly forward ("show older"), never jumped into,
  and an event table is precisely where an offset gets expensive at §25's
  stated scale. So it is keyset on `event_time` with `id` as the tiebreak,
  fetching **one lookahead row** to answer "is there more?" without a second
  count query — the trick M-73 used on `/track`, for the same reason.

### Why `null` is not `0` on a dashboard tile

§11 ends: *"No fake metrics. Use zero-data and empty states."* Those are two
different states and the module keeps them apart:

- a genuine `0` renders `0` — the query ran and found nothing;
- `documents_awaiting_review` renders an em-dash and says uploads are not live,
  because `shipment_documents` **does not exist** (M-71 lists it among the
  seven tables deliberately not created; M-77 owns it with the §16 visibility
  matrix). A `0` there would assert a measurement nobody took;
- a failed count also stays `null`. A database error displayed as "you have
  zero delayed shipments" is the worst possible rendering of an outage.

---

## Migration 0021 — and the disclosure it exists to prevent

### Why a migration at all

§11 requires **invoice status** on the detail page, and M-70's doc is explicit
about where it may not come from: `gross_shipper_amount` is §18 staff-only, and
*"§11's 'invoice status' is a fact about an invoice, not a column on the
shipment — M-74 reads it from `invoices`, where amounts already live under
their own RLS."*

Except 0008's `invoices` is carrier-shaped: `carrier_id not null`, `load_id →
loads`, and one customer policy keyed on `my_carrier_ids()`. There is no column
a shipper invoice could hang from and no policy under which a shipper could
read one. The requirement is **unimplementable** against the shipped schema.

### The defect the RLS suite caught

The first draft added the two columns, kept `carrier_id NOT NULL`, and planned
to name the hauling carrier on a shipper invoice. The suite rejected it, and it
was right. 0009's shipped policy is

```sql
create policy "member read invoices" on invoices
  for select using (carrier_id in (select my_carrier_ids()));
```

so a shipper invoice carrying `carrier_id = <the hauling carrier>` is
**readable by that carrier**, `amount_cents` included — which is the shipper
gross. A carrier who knows the gross and their own `carrier_pay` has computed
PickLoads' margin, which §18 marks staff-only and §12 puts on the broker
must-not-see list. Two counterparties on opposite sides of one deal, sharing
one table.

The fix is structural, not a filter: **a shipper invoice names no carrier**, so
the carrier policy cannot match it under any query anyone can write. The NOT
NULL is replaced by the invariant that actually mattered —

```sql
check (carrier_id is not null or shipper_id is not null)
```

— every invoice is billed to somebody. Every existing row satisfies it
unchanged, every existing consumer filters `.eq("carrier_id", …)` and so cannot
see a null-carrier row, and §10b of the RLS suite asserts that carrier A, who
hauled shipment A, reads none of shipment A's shipper invoice.

### What 0021 is NOT

It is not shipper invoicing. Nothing in M-74 writes an invoice, no Stripe path
changes, and `/portal/shipper/billing` keeps its M-56 honest placeholder. This
migration makes the **read** expressible.

### DB changes

**Creates:** columns `invoices.shipment_id` (FK → `shipments`) and
`invoices.shipper_id` (FK → `shippers`), both nullable; constraint
`invoices_party_present`; indexes `idx_invoices_shipment` (partial) and
`idx_invoices_shipper` (partial); policy `"member read shipper invoices"`.
**Alters:** `invoices.carrier_id` drops NOT NULL. Nothing else on 0008 or 0009
is touched — 0009's carrier policy is byte-identical.

Only a SELECT policy is added. 0009's doctrine gives customers SELECT and
nothing else, and an invoice a customer can write is not an invoice.

### ROLLBACK (0021)

```sql
drop policy if exists "member read shipper invoices" on invoices;
drop index if exists idx_invoices_shipper;
drop index if exists idx_invoices_shipment;
-- Restoring the NOT NULL FAILS while any shipper invoice exists. That is
-- correct: those rows have no carrier and never can. Decide deliberately.
delete from invoices where carrier_id is null;   -- DESTRUCTIVE, review first
alter table invoices drop constraint if exists invoices_party_present;
alter table invoices alter column carrier_id set not null;
alter table invoices drop column if exists shipper_id;
alter table invoices drop column if exists shipment_id;
```

**Destructive for shipper invoices only** — every pre-0021 carrier invoice is
untouched, because both new columns are null on them and `carrier_id` still
holds its original value. `pg_dump -t invoices` first.

Roll back `src/lib/supabase/database.types.ts` and the two shipper shipment
routes **in the same deploy**, or the detail page selects a column that no
longer exists — which fails as an empty invoice section with a logged error
(`getShipmentInvoices` returns `{ invoices: [], failed: true }` and the UI says
so), never as a leak. No enum, trigger or function is created here, so there is
nothing else to unwind.

**Order:** 0021 rolls back **before** 0020…0017 and **after** nothing. It
depends on `shipments` (0017) and `shippers` (0005) existing.

---

## How

### §11's nine filters

| Filter | Query shape | Note |
|---|---|---|
| tracking number | `ilike '%…%'` on `tracking_number` | partial, so a customer can paste the last six digits |
| PO / reference | `or(shipper_reference.ilike,po_number.ilike)` | §11 names one filter over two columns |
| date | `gte`/`lte` on `pickup_appointment_at` | the **pickup** window — a shipper asks "what was picked up that week", not "what row was created" |
| origin | `or(origin_city.ilike,origin_state.ilike)` | |
| destination | `or(destination_city.ilike,destination_state.ilike)` | |
| status | `eq` on the enum | validated against `SHIPMENT_STATUSES`; anything else is dropped, never passed through |
| equipment | `ilike` | |
| delayed | `or(status.eq.delayed,delay_minutes.gt.0)` | **two** facts: dispatch may have flagged the status, or recorded minutes against a shipment still nominally in transit |
| delivered | `in (delivered, pod_uploaded, completed)` | |

**Free text is allow-listed, not escaped.** PostgREST's `or()` takes a
comma-separated, dotted expression string, so a comma or a dot in user input
changes the *shape* of the filter rather than the value inside it. Rather than
escape and get one escape wrong, `sanitizeTextFilter` keeps
`[A-Za-z0-9 -/#&']` and drops everything else including `%` and `_`. A shipper
searching `PO-4471/A` still finds it; a shipper pasting
`x,status.eq.completed` searches for the literal `xstatuseqcompleted` and finds
nothing, which is the honest outcome. Proved twice: a unit test asserts the
built expression has exactly two operands, and the integration lane submits the
hostile value against the real database and asserts it matches zero rows (it
would have matched a delivered shipment had the comma survived).

A shipment with no pickup appointment cannot satisfy a pickup-date window and
is correctly **excluded** rather than silently included.

### §25's summary-vs-history split, as structure

`getShipmentSummary` reads one row from `shipments` and touches
`shipment_events` **not at all** — asserted over a recording client (*"the only
table it queries is `shipments`"*, and the exact call chain is
`select · eq · eq · maybeSingle`), and again in the integration lane by
inspecting the SQL actually issued. Everything above the fold therefore costs
one indexed lookup whether the shipment has four events or four thousand.

`getShipmentTimelinePage` is the other half, bounded at 25 (+1 lookahead) with
a `?before=` cursor. The two run **concurrently** with the invoice and contact
reads in a single `Promise.all` — §25's "no N+1" applied to a detail page: four
tables, one round trip.

The dashboard applies the same rule one screen up: eight tiles as
`select("id", { count: "exact", head: true })`, so PostgREST returns a number in
a header and **no rows at all**. "Fetch the shipments and count them in JS" is
the same §25 failure wearing a different hat, and it looks identical in a diff.

### Reuse, not a second timeline

The task is explicit that M-73's timeline, phrase library and `shipment`
namespace are to be reused. Concretely:

- `buildPublicTimeline` took a `PublicTrackingDto`. It now takes
  **`TimelineSubject`** — `{ status, events, exceptions }` — which both
  `PublicTrackingDto` and `ShipperShipmentDto` satisfy structurally. Every
  existing caller compiles unchanged and there is exactly one implementation of
  "where is this shipment on §8's nine steps".
- `TrackingTimeline` takes the same widened prop plus an optional `headingId`,
  so two timelines can never collide on one page. `/track` passes nothing and
  behaves identically.
- `resolvePublicText` renders D-6 in the portal exactly as on `/track`: a
  `phrase:` token is translated into the reader's language, novel dispatcher
  prose is rendered verbatim with `lang="en"` under the honest "Written by
  dispatch, in English" label. A dispatcher's note must not read differently in
  two places.
- Statuses, milestones, event types, exceptions, severities, the §23 a11y
  sentences and the §30 labels all come from the `shipment` namespace. The only
  additions are `shipment.party.*` (six §18 party roles, first rendered by
  §11's contact block) and 52 **portal-chrome** strings in the v4 supplemental
  catalogue.

**Ten labels this module renders are deliberately NOT re-declared** — Paid,
Cancelled, Amount, Issued, Due, Company, Contact, Booked, In transit,
Outstanding invoices. All ten already exist in the extracted V4 dictionary with
the prototype's own five-locale wording *including ru/ht*, which the
supplemental catalogue can only mirror in English. Re-declaring them would have
**overwritten** those translations — the exact hazard M-69 recorded for "What
carriers say", and one this module hit and backed out of (`booked` → "Reservada"
would have become "Reservados"; `company` → Haitian "Konpayi" would have become
"Company").

### §2 brokerage gate, both directions

`brokerage_active` is false today and 0017's trigger refuses every shipment
INSERT while it is. So the honest pre-launch state is **not** an empty
operational table — that implies live brokerage with no freight in it — it is
the M-56 waitlist card this portal already uses on the overview, with the same
approved copy.

The gate is evaluated **together with** "does this shipper actually have
shipments":

| `brokerage_active` | has shipments | list route | tile row |
|---|---|---|---|
| false | no | waitlist card, no filters, no table | hidden |
| false | **yes** | the list, plus an honest "new bookings are paused" note | shown |
| true | either | the list | shown |

The second row is the one that matters. M-71 made its gate INSERT-only with a
stated reason — *"shipments already in flight must stay operable — refusing
their status updates would strand real freight"* — and hiding them
presentationally would be the same mistake in CSS. The integration lane asserts
it: the gate is closed in that database and a shipper with three shipments sees
three shipments.

A shipper with **no company record** gets its own state: quotes are matched by
verified email (M-56), shipments never are, so the page says the account is not
linked yet and gives the number to call.

### §11's ten detail blocks

| §11 requirement | Where |
|---|---|
| timeline | `TrackingTimeline` — M-73's, nine milestones, §23 text equivalent |
| current status | header cell, as a `track-status` badge with the state **in text** |
| ETA | header cell + §30's "ETA provided by dispatcher" label when `eta_source` says so |
| shipment summary | `<dl class="track-summary">` — appointments, equipment, commodity, weight, pallets, references, PO, both facility addresses |
| map, **when enabled** | `.psh-mapslot` — an **honest labelled region**, see below |
| documents | honest empty state, read-only until M-77 |
| support messages | link to `/portal/shipper/support` + the 24/7 number |
| **invoice status** | `invoices` under 0021's policy — status, amount, issued/due/paid |
| **shipment contacts** | `shipment_parties`, with M-71's visibility rule applied |
| **update history** | the bounded event page, D-6-resolved, `<ol>` + `<time datetime>` |

**The map slot is a placeholder, and says so.** M-80 owns the provider adapters
and §9's four privacy levels. Until then the region carries §30's
`label.milestone_tracking` badge, the last recorded city/state (or
`label.location_unavailable`), and the sentence *"Updates are entered by our
dispatch team as milestones are confirmed. This page does not show a live GPS
position."* Grey tiles, a truck marker or an empty `<div id="map">` would each
imply a capability that does not exist. A unit test asserts the slot contains
**no** `canvas`, `iframe`, `img` or `svg`, and that the rendered view contains
none of "live tracking", "real-time", "AI-powered", "artificial intelligence"
or "machine learning".

**Contacts and the rule M-71 encoded.** 0018 lets a shipper read every party on
its own shipment, and that is right: the consignee, the billing contact and the
notify party are the shipper's own counterparties. The **carrier** row is
different — a carrier dispatcher's direct line is the carrier's contact data
sitting on the shipper's shipment, and PickLoads is the party in the middle
(§12's model). So the carrier row's phone and email are withheld unless
`public_contact` is true — the flag M-71 shipped defaulting to **false** for
exactly this reason — and the UI says *"Contact through dispatch"* rather than
rendering a blank that reads as missing data. The company name is **not**
withheld: a shipper is entitled to know who is hauling their freight; the rule
is about channels. `driver` is deliberately absent from the rule because §18's
`shipment_party_role` has no such value — naming it would be a rule that never
fires.

### §18's financial columns: three layers, all of them explicit

1. **Projection.** Neither `SHIPMENT_LIST_COLUMNS` nor
   `SHIPMENT_DETAIL_COLUMNS` names `gross_shipper_amount`, `carrier_pay`,
   `margin`, `delay_reason_internal` or `public_access_hash`, so they never
   enter process memory on a shipper request. This is the mitigation M-71's
   residual risk **R-1** asks for at the application layer (RLS is row-level;
   M-83 still owns the column-level answer).
2. **DTO.** The page calls `toShipperDto`, whose allow-list names none of them.
3. **Type.** `ShipmentDetailRow` is `Omit<ShipmentRow, …the five>`, so a new
   `ShipmentRow` column is a **compile error** here until somebody decides
   whether a shipper may see it.

The event projection omits `internal_message`, `metadata` and the coordinates
for the same reason: 0019's policy already keeps `staff_only` **rows** out, but
a `shipper`-band row can still carry an internal note in `internal_message`,
and §7's rule is about the **note**.

Proved at four levels: a projection scan, a sentinel sweep over the DTO at this
call site's exact shape, a structural scan of the page module
(`toShipperDto(` present; `...shipment,`, `select("*")`, `: any`,
`as unknown as` and `tryCreateAdminClient` absent), and — in the integration
lane — a sweep over the real payload from a row that genuinely carries all five
sentinel values in the database.

### "Today" is Eastern, not UTC

The two "today" tiles use `operatingDayBounds`, derived from `Intl` rather than
a hard-coded −05:00. A UTC calendar day would move the boundary five hours and
put a 20:00 ET pickup on **tomorrow's** tile — a wrong number on an operational
screen, which §11's "no fake metrics" covers as much as an invented one.

The offset is sampled at **local midnight**, not at the caller's clock, in two
passes; and the day's end is the instant before the *next* local midnight
rather than `start + 24h`. Both details exist because the first implementation
got them wrong and the DST tests said so: on 2026-03-08 the zone is EST at
00:00 local and EDT by lunchtime, and the operating day is 23 hours long. Pinned
at an EST date, an EDT date, both transition days and every seventh day of a
year.

### §22 responsive · §23 accessibility

- **`.ptable--cards`** on both tables, with `data-th` on **every** body cell —
  asserted cell-by-cell against the header row, because a cell that loses its
  label renders as a bare value in a card at 320px.
- **Filters are a plain `<form method="get">`** inside a `<fieldset>` with a
  `<legend>`. Every one of the ten controls has a `<label for>` (asserted by
  walking the DOM). No key handlers, no JS requirement — which is also what
  makes them keyboard-reachable without anything to get wrong.
- **Pagination is a named `<nav>`** of real anchors carrying `rel="prev"` /
  `rel="next"`, and it **carries the active filters forward** (asserted).
- **The result count is `role="status"`**, so submitting a filter announces its
  effect instead of silently changing a table.
- **The error state is `role="alert"`**, not merely styled.
- **State is text**, never colour alone: status badges render the translated
  status word; milestone steps render "Completed" / "Current step" / "Not
  started"; a withheld contact channel says so.
- **The dark-surface CSS.** `.track-*` was authored for a white card on the
  public site (`color: var(--ink)` on `#fff`). Dropped onto the portal's
  `#12161a` unchanged it would be near-black on near-black — a real WCAG 1.4.3
  failure. Rather than fork the components (which would fork the timeline logic
  with them) the colours are restated under `.portal`, which only the portal
  shell sets. `/track` is untouched, and the axe + responsive suites that
  already scan it prove that.
- **No new colours.** Every value in the M-74 CSS block is an existing `@theme`
  token or a literal already present in `portal.css` (CLAUDE.md).

---

## Endpoints

| Surface | Kind | Auth | Notes |
|---|---|---|---|
| `/{locale}/portal/shipper/shipments` | page (5 locales, `force-dynamic`) | shipper session | `requireShipper` → membership → RLS |
| `/{locale}/portal/shipper/shipments/[shipmentId]` | page (dynamic) | shipper session | non-UUID, unknown and another tenant's id all `notFound()` |

**No server action, no route handler, no API addition.** M-74 is read-only:
the recording client used in tests throws on `insert`/`update` so a write would
fail the suite rather than ship.

**Every "not yours" is a 404, never a 403.** §3 forbids reaching another
company's shipment through URL manipulation; a 403 would answer the question
the manipulator is asking (*does this id exist?*). A malformed id is refused
before any query runs, which also keeps a scripted scan out of the database.

## Env vars

**None.** No new variable, no new `company_settings` key.

---

## Deployment

1. Apply `0021_invoice_shipment_link.sql`. Pure DDL plus one `alter column …
   drop not null`; on an `invoices` table of realistic size it takes
   milliseconds and takes an `ACCESS EXCLUSIVE` lock only for that instant.
   No backfill, no data migration.
2. Deploy. Page count **348 → 353** (five locales of the list route; the detail
   route is dynamic and prerenders nothing).

Nothing operator-visible changes at the moment of deploy: `brokerage_active`
stays `false`, so no shipment can exist and both new surfaces render their
honest waitlist / 404 states. The shipper sidebar gains one entry.

---

## Tests

| Suite | Count | Was | New in M-74 |
|---|---|---|---|
| `npm test` | **578** | 437 | +141 across four files |
| `npm run test:rls` | **386** | 357 | +29 (suite §10, plus two rewritten pre-existing assertions) |
| `npm run test:integration` | **78** | 47 | +31 (§27 portal lookup) |
| `npx playwright test` | **179** | 174 | +5 |
| `npm run build` | **353 pages** | 348 | 5 locales of the list route |

### What each lane proves

**`shipment-shipper-list.test.ts` (45)** — the §25 bound (`range` present,
span ≤ `MAX_PAGE_SIZE`, offset clamped so `?page=1e9` cannot become a 10⁹-row
OFFSET); the exact-count option and the total order key; each of §11's nine
filters producing its exact filter chain; the allow-list defeating an `or()`
reshape; the projection naming none of the five staff-only columns; a read
error reported as failure rather than as an empty list.

**`shipment-shipper-detail.test.ts` (27)** — **the split**: the summary's only
table is `shipments` and its call chain is exactly four calls; the history's
bound, lookahead, band filter, keyset cursor and total order key; the contact
visibility rule per role with a non-vacuity control; the invoice read scoped
and bounded; and the **DTO call-site proof** — a structural scan of the page
plus a sentinel sweep at this call site's exact shape, with the sweep shown to
find the sentinels in a naive passthrough.

**`shipment-shipper-tiles.test.ts` (25)** — the three status buckets disjoint
and `delayed`/`cancelled` in none of them; `operatingDayBounds` at EST, EDT,
spring-forward (23 h), fall-back (25 h) and every seventh day of a year, plus
the concrete failure it prevents; every tile query `head: true` and scoped;
`documents_awaiting_review` null with nothing queried for it; a failed count
null rather than zero, with a working-count control.

**`shipper-shipments-a11y.test.tsx` (42)** — both views **axe-scanned**
(wcag2a/2aa/21a/21aa/22aa) in nine states across three locales, plus the
structure a scanner cannot see: the card transform and a `data-th` on every
cell, `scope="col"` on every header, a `<label for>` on all ten filter
controls, the GET form and fieldset, the pager's `rel` anchors carrying active
filters forward, the `role="status"` count and `role="alert"` error, §11's ten
detail blocks, §22's mobile priority order, the reused nine-milestone `<ol>`
with its text equivalent, D-6's translated-phrase and `lang="en"` branches, the
§30 map-slot audit, the honest documents empty state, and a five-locale
catalogue walk over the six new party-role keys with es/fr authored and ru/ht
proved to mirror English.

**`tests/integration/shipper-shipments.test.ts` (31)** — §27's **portal
lookup**, the sixth of the eleven. The REAL exported functions from `src/`
against the REAL schema (0001…0021) as a REAL `authenticated` session with
`request.jwt.claim.sub` set, through a new RLS-applying psql adapter. Proves:
the list, summary, timeline, invoices, contacts and tiles all work against real
SQL; the shipper's two event bands come back and the `staff_only` and `carrier`
notes are present in the table and absent from the payload; all nine filters
narrow a real result set and compose; the hostile filter value matches zero
rows; page 2 of a 2-row page does not overlap page 1; the ceiling holds against
`pageSize = 100_000`; and the §2 gate is closed while three in-flight shipments
stay readable.

**`supabase/tests/20_rls_isolation.sql` §10 (+29)** — shipper A sees exactly
its own invoice and neither shipper B's nor either carrier's; carrier A still
reads its own dispatch-fee invoice (0009 untouched) and reads **nothing** of
the shipper invoice for the shipment carrier A is hauling; broker and
non-member read nothing; anon reads nothing; a shipper cannot mark its own
invoice paid, rewrite the amount, delete it, raise one, or **claim** another
party's by writing its own `shipper_id` onto it; admin reads all four (the
non-vacuity control); and the schema half asserted as the table owner —
`carrier_id` nullable, `invoices_party_present` refusing an invoice with
neither party, a carrier-only invoice still inserting, the FK refusing an
unknown `shipment_id`, and both §25 indexes present.

Two **pre-existing** assertions were rewritten rather than deleted, each with
the reason inline: *"shipperA cannot select invoices"* (0 → 1, its own) and
*"dispatcher reads all invoices"* (2 → 4, the fixture set grew).

**`tests/e2e/shipper-shipments.spec.ts` (5)** — both routes and a malformed id
bounce to `/login`; the bounce preserves the destination; neither route appears
in the sitemap and `robots.txt` disallows `/portal`; the sitemap contains
nothing tracking-number-shaped; all five locales are gated identically.

### Non-vacuity, by injection

- **The isolation test's own injection.** The application-level
  `.eq("shipper_id", …)` predicate is **removed** — the exact bug of forgetting
  the scope — and the same query is issued as shipper A. The database still
  returns only A's three shipments and never B's. A paired **control** runs the
  identical unscoped query as an admin and gets everything, so the assertion is
  shown to be capable of failing. A third injection looks shipment B up by its
  **tracking number** as shipper A, finds nothing, and then proves the row
  exists as the table owner (§5's identifier is not an access grant, restated
  through the client the portal actually uses).
- **The migration's own defect, caught and fixed.** The RLS suite rejected the
  first 0021 draft with *"carrierA sees only its own invoices (expected 1, got
  2)"* — the disclosure documented above. The suite found a real bug before the
  module shipped, which is the strongest available evidence that §10's zeros
  are not vacuous.
- **The DST bug, caught and fixed.** `operatingDayBounds` sampled the offset at
  the caller's clock; the spring-forward and fall-back tests failed with a
  one-hour error and a 24-hour day. Both are now correct and pinned.
- Plus the per-suite controls: the sentinel sweep shown to find sentinels in a
  naive passthrough, the axe scanner shown to report `image-alt`, the catalogue
  walker shown to return `undefined` for a key that does not exist, the
  contact-masking rule shown to leave a raw row's phone intact.

### Honest limitations

- **Both routes are axe-scanned in jsdom, not in a browser.** They sit behind a
  Supabase session and the e2e lane runs on placeholder credentials by design
  (M-41); minting a session and seeding a shipment would mean shipping a
  fabricated shipment fixture, which §30 forbids. The scan uses the same
  axe-core 4.12 engine on the same components. What it cannot see is
  **colour contrast** (jsdom applies no stylesheet) — covered structurally: the
  M-74 CSS introduces no new colours and exists precisely to restate the
  reused `.track-*` values against the dark surface. The e2e lane asserts the
  session gate, so the limitation is proved rather than assumed.
- **The integration adapter is not PostgREST.** It implements the operators
  M-74 uses and throws on anything else, so a future query shape cannot
  silently take an untested path — but a PostgREST behaviour M-74 does not
  exercise is not covered by it.
- **Nothing writes a shipper invoice yet.** 0021 makes the read expressible;
  the tile and the detail section will read `0` and "no invoice raised" in
  production until a module raises one. That is the honest state, not a stub.
- **`shipment_exceptions` does not exist** (M-78). The detail view handles
  exceptions in full and is tested against them; wiring is one argument.
- **Dispatcher scoping and column-level financial protection** remain M-71's
  R-1/R-2, owned by M-83. M-74 adds the projection layer, not the GRANT.

---

## Files

**New:** `supabase/migrations/0021_invoice_shipment_link.sql` ·
`src/lib/shipments/{shipper-list,shipper-detail,shipper-tiles}.ts` ·
`src/components/portal/{ShipmentListView,ShipmentDetailView,ShipperTiles}.tsx` ·
`src/app/[locale]/portal/shipper/shipments/page.tsx` ·
`src/app/[locale]/portal/shipper/shipments/[shipmentId]/page.tsx` ·
`tests/unit/{shipment-shipper-list,shipment-shipper-detail,shipment-shipper-tiles}.test.ts`
· `tests/unit/shipper-shipments-a11y.test.tsx` ·
`tests/unit/stubs/recording-supabase.ts` ·
`tests/integration/shipper-shipments.test.ts` ·
`tests/integration/helpers/psql-rls-supabase.ts` ·
`tests/e2e/shipper-shipments.spec.ts` · this doc.

**Changed:** `src/lib/shipments/public-timeline.ts` ·
`src/components/tracking/TrackingTimeline.tsx` · `src/lib/shipments/types.ts` ·
`src/components/portal/PortalSidebar.tsx` ·
`src/app/[locale]/portal/shipper/page.tsx` · `src/app/portal.css` ·
`src/lib/supabase/database.types.ts` · `scripts/extract-i18n.mjs` ·
`messages/{en,es,fr,ru,ht}.json` (regenerated) ·
`supabase/tests/{10_fixtures,20_rls_isolation}.sql` ·
`tests/e2e/{axe,responsive}.spec.ts` · `docs/modules/INDEX.md` ·
`docs/LAUNCH-RUNBOOK.md`.

### Launch runbook

Two things change for an operator and both are recorded: **migration 0021**
joins the order-and-rollback table (with the NOT-NULL caveat), and the gate
counts move to 578 / 386 / 78 / 179 / 353. No new environment variable, no new
`company_settings` key, no new smoke test beyond what the existing shipper
walkthrough covers, no go-live step.

---

## Extension points

- **M-75** (dispatcher) supplies the writes these pages read: the phrase picker
  (`PUBLIC_PHRASE_IDS` → `phraseToken(id)`), appointments, ETA updates and the
  public-update-vs-internal-note choice that decides which band a shipper sees.
  It can reuse `applyShipmentFilters` verbatim for the board's own filters —
  the builder is generic over the query object precisely so a second surface
  does not need a second implementation.
- **M-77** replaces the documents section's honest empty state with a real
  read, and gives `documents_awaiting_review` a table to count. Both are one
  function each; the tile already renders `null` correctly and the section
  already has its heading and empty state.
- **M-78** passes real `shipment_exceptions` rows into `toShipperDto`'s
  `exceptions` argument — one argument — and the banner, the timeline exception
  state and the phrase library are already built and tested for them.
- **M-80** fills `.psh-mapslot`. The region, its heading and its §30 labels
  exist; what it must not do is remove the honest label without also delivering
  a real position, and `label.live_location_available` already switches on
  `tracking_mode !== 'manual'`.
- **M-81** (broker portal) should follow this module's shape rather than
  copying its files: `toBrokerDto` exists, the broker event band exists, and
  `shipment_parties`' `public_contact` rule is already the broker rule in 0018.
  The contact-masking helper here is shipper-specific by design.
- **M-83** inherits the two named risks unchanged and can lift §10's
  policy-plus-schema assertion shape for the other tables it audits.
- **Shipper invoicing**, whenever it lands, writes rows 0021 already models.
  The one rule it must keep is the one 0021 exists to enforce: a shipper
  invoice names **no** carrier.
