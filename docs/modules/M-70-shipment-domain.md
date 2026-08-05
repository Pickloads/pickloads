# M-70 — Shipment Domain Foundation

**Status:** ✅ Complete · **Phase:** B (tracking core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-70 —
*"Shipment domain foundation: types, DTO serializers with financial-field
allow-lists, tracking-number generator (`PL-YYYY-######`, server-side, unique,
immutable), status/visibility enums"*. Authority: `docs/DIRECTIVE-tracking.md`
§§4, 5, 6, 7, 9, 10, 12, 16, 18, 19, 21, 24, 30.

**No migrations. No routes. No UI.** The tables land in M-71, the transition
engine in M-72. This module is the vocabulary and the serialization boundary
those modules are written against.

---

## What was built

| File | Contents |
|---|---|
| `src/lib/shipments/types.ts` | 17 enums + 10 row types + the i18n key builders. Every enum value list the directive names, plus the two deliberate additions recorded below. |
| `src/lib/shipments/tracking-number.ts` | `PL-YYYY-######` — format constants (including the SQL pattern and the index/trigger names M-71 must use), `formatTrackingNumber`, `parseTrackingNumber`, `normalizeTrackingNumber`, `isTrackingNumber`, `generateTrackingNumber` over a CSPRNG with rejection sampling. |
| `src/lib/shipments/dto.ts` | Five audience serializers — `toPublicTrackingDto`, `toShipperDto`, `toCarrierDto`, `toBrokerDto`, `toStaffDto` — plus the event-visibility matrix and the §9 location-privacy resolver. |
| `tests/unit/shipment-types.test.ts` (20) | Enum/vocabulary pins, lifecycle-order exhaustiveness, i18n key shape. |
| `tests/unit/shipment-tracking-number.test.ts` (19) | Format, round-trip, normalisation, rejection, generation distribution, JS-regex ↔ SQL-pattern equivalence. |
| `tests/unit/shipment-dto.test.ts` (38) | Key-set equality per audience, sentinel sweeps, event-visibility matrix, location privacy, structural guard on the serializers. |

Everything is a pure function or a type. No database client, no `server-only`,
no environment variable, no network call.

---

## Why

### Why a new `shipments` vocabulary at all

Plan §1, confirmed against the schema: `loads` is carrier-centric dispatch
work (`carrier_id NOT NULL` since 0001, a `compute_load_fee` BEFORE-INSERT
trigger three modules depend on, a six-value status enum ending in billing
states). The directive's shipment is shipper-centric brokerage work whose
first four statuses — `quote_requested`, `quote_sent`, `quote_accepted`,
`carrier_search` — have **no carrier at all**. Extending `loads` would mean
dropping a NOT NULL, rewriting the F-03 fee trigger and breaking every
exhaustive `Record<LoadStatus, …>` in the codebase.

`loads` is untouched by this module and remains the system of record for
dispatch. `ShipmentRow.load_id` is the nullable bridge for the case where a
brokered shipment is covered by a dispatched truck.

### Why the types come before the DDL

M-71 writes `shipments`, `shipment_events` and seven sibling tables. If the
column list is invented in SQL and then transcribed into TypeScript, the two
drift on the first `ALTER`. Here the TypeScript **is** the specification: the
enum arrays are the exact `CREATE TYPE` value lists, the `*Row` interfaces are
the exact column lists, and the tracking-number module exports the pattern,
index name and trigger name the migration must use verbatim.

### Why the DTO layer is the security core

§18: *"sensitive financial data must never be included in public shipment
queries … use database views or server-side serializers to control exposed
fields."* §19: the public route must return *"a strict public DTO."* §4 lists
eight things a public tracking page must never show. This module is where
those sentences become code, before any surface exists that could violate
them.

---

## How

### Allow-list construction, and why not a deny-list

Every DTO is built by naming each field in the object literal that produces
it. There is no spread of a row, no `delete`, no `omit()`, no key filter.

The difference only shows up in the future. When M-71 adds a column, or M-78
adds ETA detail, or M-88 adds a carrier rating, a deny-list exposes it to
every audience until somebody remembers to deny it; an allow-list keeps it
invisible until somebody decides otherwise. New columns are precisely where
margins, internal notes and compliance data arrive, so **invisible by default**
is the only safe default.

This is enforced three ways:

1. **Key-set equality.** `Object.keys(toPublicTrackingDto(...))` must *equal*
   the approved list — widening the serializer fails the test, it does not
   merely go unnoticed.
2. **Sentinel sweep.** A `ShipmentRow` with unique sentinel values in every
   `@staffOnly` financial field, plus sentinels in `public_access_hash`,
   `delay_reason_internal`, `internal_message`, event `metadata`,
   `internal_description` and `resolution`, is serialized for each audience
   and the resulting JSON is searched for every sentinel. Nested structures
   are covered because the search is over the serialized string, not the keys.
3. **Structural guard.** `tests/unit/shipment-dto.test.ts` reads `dto.ts` (with
   comments stripped) and fails if it ever contains `...shipment`, `...row`,
   `delete `, `omit(`, `: any` or `as unknown as`.

### Anti-vacuity

A safety test that cannot fail proves nothing. Three checks exist purely to
show these can:

- the same key-set assertion is run against a deliberately widened object and
  asserted to **fail**;
- the sentinel sweep is run against a naive `{ ...row }` serializer and
  asserted to **find** every sentinel — the exact failure mode this module
  exists to prevent;
- the staff DTO is asserted to **contain** the sentinels the customer DTOs
  must not, so "no sentinel found" can never be the result of a broken
  fixture.

There is also a static scan of `types.ts` for `@staffOnly` JSDoc tags: the
test fails if a future `@staffOnly` column is added without a sentinel, so the
sweep cannot silently stop covering the thing it is named after.

### The audience matrix

| | public | shipper | carrier | broker | staff |
|---|---|---|---|---|---|
| Internal id | — | ✅ | ✅ | ✅ | ✅ |
| Street addresses / ZIP | — | ✅ | ✅ | ✅ | ✅ |
| `gross_shipper_amount` | — | — | — | — | ✅ |
| `carrier_pay` | — | — | ✅ | — | ✅ |
| `margin` | — | — | — | — | ✅ |
| `public_access_hash` | — | — | — | — | **—** |
| `delay_reason_internal` | — | — | — | — | ✅ |
| Event bands read | `public` | `public`, `shipper` | `public`, `carrier` | `public`, `broker` | all five |
| Exact coordinates | — | at `exact` | at `exact` | at `exact` | always |

Three of those cells are judgment calls and are argued rather than assumed:

- **`carrier_pay` to the carrier.** §16 makes the carrier rate confirmation a
  carrier-visible document, so the figure is already contractually theirs;
  hiding it from the API while mailing it as a PDF would be theatre. What
  stays out is anything that lets them derive the margin.
- **No financial field to the broker partner — not even `carrier_pay`.** §12
  forbids brokers seeing "PickLoads commission" and "internal margin". A
  broker who knows what the carrier is paid and what they were quoted has
  computed the commission. The carrier gets their own rate because it is their
  own contract; a broker partner is not a party to it.
- **No `gross_shipper_amount` to the shipper.** §18 marks it staff-only
  alongside the other two, and this module follows the directive literally.
  §11's "invoice status" is a fact about an invoice, not a column on the
  shipment — M-74 reads it from `invoices`, where amounts already live under
  their own RLS.

`public_access_hash` is serialized by **no** audience, staff included. It is
the §4 secondary-verification credential, not data; M-73 compares against it
server-side. A value that never enters a payload cannot leak through a log
line, an error boundary or a screen share.

### Event visibility, and the broker band

§7 names four visibility levels (public / shipper / carrier / staff_only).
This module ships **five**, adding `broker`.

That is the same lesson `FINAL-IMPLEMENTATION-PLAN` §4 records against
`doc_visibility`: §12 requires broker partners to see an approved subset of a
shipment ("BOL, when authorized") while never seeing margin or unrelated
commentary. With no broker band there are only two options — show brokers the
`shipper` band, which carries the shipper's commercial correspondence, or show
them nothing, which makes §12 unimplementable. A distinct band is the only way
to write the rule down. `ShipmentDocumentVisibility` carries the same five
values for the same reason, and M-77 owns the document-type → audience matrix
written in them.

The customer bands deliberately do **not** nest: a shipper never reads
`carrier` or `broker` events. Only `staff` reads `staff_only`, which is §7's
hard rule (*"a staff-only note must never appear in the customer timeline"*)
and the single most important line in the DTO tests.

### Location privacy (§9's four levels)

`hidden` and `milestone_only` return nothing to any customer; `approximate`
returns city/state and the update time but never coordinates; `exact` returns
coordinates — **except to the public audience**, which is capped at city/state
because §9 forbids permanently exposing a live truck position to every public
visitor, and a tracking number plus a ZIP is not an account.

Redaction sets values to `null`; it never removes keys. A key set that varied
with the privacy setting would itself signal the setting.

Staff are unaffected by the level: it is a customer-facing control, and
dispatch cannot operate a shipment it is not allowed to see.

### Tracking numbers (§5)

`PL-YYYY-######`, six digits, canonical uppercase, 14 characters.

- **Generation** draws the sequence from the platform CSPRNG with rejection
  sampling (a plain `% 1e6` over a 32-bit draw would over-weight the low
  ~294k sequences). Year comes from `getUTCFullYear()`, so the server's
  timezone cannot decide which year a 23:30 UTC-eve shipment belongs to.
- **Guessing mitigation, stated honestly.** A drawn sequence removes the
  enumeration attack that matters commercially (incrementing a number you
  legitimately hold) and the volume signal a counter leaks (`PL-2026-000458`
  announces 458 shipments this year). It does **not** make the number a
  secret: 10⁶ values per year is a small space. §5 says as much — the
  mitigation is *"secure secondary verification"*, and the mandatory second
  factor, the rate limit and the enumeration logging M-73 builds are what
  actually protect the data. Nothing in this module may be read as making the
  number sufficient on its own.
- **Normalisation** is tolerant on lookup (case, surrounding and internal
  whitespace including NBSP, Unicode hyphen/en-dash/minus variants) and
  canonical on store. A number pasted out of a word processor must not fail a
  lookup over typography.
- **Rejection** is strict after normalisation: wrong prefix, wrong digit
  counts, a year before the programme existed (`PL-2025-…`), a seven-digit
  sequence, or any leading/trailing payload. Seven digits are not "999999 plus
  a stray character" — truncating would resolve one customer's lookup to
  another customer's shipment.
- **Collisions** are the caller's business: the unique constraint is the
  arbiter and M-71/M-75 retry on a 23505. Retrying here would require a
  database round trip and make a pure function stateful.

### i18n (§24, §30)

This module has no UI, so it exposes **keys, not strings**: `statusKey()`,
`eventTypeKey()`, `exceptionTypeKey()`, `exceptionSeverityKey()` all return
`shipment.<group>.<member>`, and every customer DTO carries `status_key`,
`event_type_key`, `exception_type_key` and `severity_key` beside the raw enum
value. No English label for a status, event or exception exists anywhere in
`src/lib/shipments/`.

**No catalogue entries were added.** The `shipment` namespace arrives with
M-73, which authors it in all five locales alongside the UI that renders it. A
key with no translation is worse than a key that does not exist yet — it
renders as the key.

---

## DB changes

**None.** No migration, no schema touch, no seed change. Migration chain
remains `0001 … 0016`.

### What M-71 must match

M-71 creates the tables. To keep the two in step:

| Item | Source of truth |
|---|---|
| Postgres enum value lists | The `SHIPMENT_*` / `ETA_*` / `TRACKING_*` `as const` arrays in `types.ts` — order included |
| `shipments` columns | `ShipmentRow` |
| `shipment_events` columns (all 18 of §7) | `ShipmentEventRow` |
| `shipment_exceptions`, `shipment_eta_history`, `shipment_locations`, `shipment_documents`, `shipment_parties`, `shipment_assignments`, `shipment_tracking_access`, `tracking_provider_connections` | the matching `*Row` interfaces |
| `tracking_number` CHECK | `TRACKING_NUMBER_SQL_PATTERN` (`^PL-[0-9]{4}-[0-9]{6}$`) |
| unique index name | `TRACKING_NUMBER_UNIQUE_INDEX` = `shipments_tracking_number_key` |
| immutability trigger name | `TRACKING_NUMBER_IMMUTABLE_TRIGGER` = `trg_shipments_tracking_number_immutable` |

Notes for whoever writes that migration:

- **Numbering.** The plan's Phase B table says M-71 is "0015–0016". Those
  numbers were consumed by M-69 (`referral_program_active`, `deadhead_miles`).
  M-71 starts at **0017**, and every later Phase B number shifts by two.
- Two `ShipmentRow` fields are **not** in §18's recommended list and are
  deliberate: `location_visibility` (§9's per-shipment privacy level has
  nowhere else to live) and `cancellation_reason` (§20 requires `cancelled` to
  record one, which M-72 cannot enforce against a column that does not exist).
- §18's category entries are expanded into columns: "origin fields" →
  `origin_company/address/city/state/zip`, likewise destination; "reference
  numbers" → `shipper_reference` + `po_number`; "current ETA" → the full §10
  field set (`estimated_pickup_at`, `estimated_delivery_at`, `eta_source`,
  `eta_confidence`, `eta_updated_at`, `delay_minutes`, `delay_reason_public`,
  `delay_reason_internal`) so M-78's engine and M-71's DDL cannot disagree.
- `public_access_hash` must be a hash, never the code. Nothing reads it back:
  no DTO serializes it at any audience.
- `shipment_tracking_access` stores the attempted tracking number but **never**
  the attempted secondary value in any form — hashing a recipient ZIP would
  build a rainbow-friendly ledger of exactly the credential §4 relies on.
- Integration credentials stay in environment variables (§15).
  `tracking_provider_connections` holds the per-shipment link and its
  lifecycle only.

---

## Endpoints

**None.** No route, no server action, no API handler. `/track`, the shipper
shipment pages and the dispatcher board are M-73/M-74/M-75.

## Env vars

**None.** Nothing in this module reads `process.env`, so it behaves
identically in the secretless build and e2e lanes.

---

## Deployment

Nothing to deploy and nothing to configure. The three modules are not imported
by any page yet, so the production bundle is byte-identical apart from the
build hash; the page count is unchanged at 343.

**Rollback: revert-only.** No schema, no data, no config, no feature flag.
`git revert` of the M-70 commit removes the files and the three test suites
and returns the tree to the M-69 state. There is nothing to un-migrate and no
window in which a partially rolled-back system is inconsistent.

---

## Tests

| Suite | Count | New in M-70 |
|---|---|---|
| `npm test` (vitest) | **268** (was 191) | 77 tests across three files, detailed below |
| `npm run test:rls` | **173** (unchanged) | No schema change, so nothing to assert |
| `npx playwright test` | **160** (unchanged) | No surface exists to exercise |

`tests/unit/shipment-types.test.ts` (20) — 18 statuses present, in §6's
lifecycle order, matching a `satisfies Record<ShipmentStatus, number>` guard
(adding a status without placing it in the lifecycle is a **compile** error);
the eight §7 sources; the five visibility bands including `broker`; §14's
dispatcher actions each having an event type; the four tracking modes, four
location levels, five providers; §10's four ETA sources; §16's eleven document
types; §21's thirteen exception types and four severities; no duplicate member
in any list and every member a legal Postgres enum label; distinct namespaced
i18n keys for every labelled member.

`tests/unit/shipment-tracking-number.test.ts` (19) — the directive's own
example, zero-padding and fixed length; round-trip at all four boundaries;
`RangeError` rather than a number the CHECK constraint would reject; eleven
normalisation variants (case, ASCII/NBSP whitespace, four dash characters);
seventeen malformed rejections including SQL-ish and markup payloads; the
adjacent-year case (`PL-2025-…`); sequence overflow; a multiline payload that
*contains* a valid number; 5 000 draws all well-formed and in range with
>4 950 distinct (a counter would produce 5 000 consecutive values); every
decile of the sequence space hit over 3 000 draws (the rejection-sampling
proof); JS regex ↔ SQL pattern equivalence over a nine-string corpus;
identifier names legal and within `NAMEDATALEN`.

`tests/unit/shipment-dto.test.ts` (38) — described under *How* above.

**Honest limitations.** These are pure-function proofs. They show that *if* a
caller passes a row to the right serializer, nothing forbidden comes out. They
cannot show that M-73 calls `toPublicTrackingDto` rather than returning the
row, or that RLS stops Shipper A reading Shipper B's row — those are M-73's
route tests and M-83's RLS proofs, which the plan already scopes. The
`@staffOnly` static scan covers `types.ts` only; a financial column added to a
different table gets its own decision.

---

## Files

**New:** `src/lib/shipments/types.ts` · `src/lib/shipments/tracking-number.ts`
· `src/lib/shipments/dto.ts` · `tests/unit/shipment-types.test.ts` ·
`tests/unit/shipment-tracking-number.test.ts` ·
`tests/unit/shipment-dto.test.ts` · this doc.

**Changed:** `docs/modules/INDEX.md` (row + totals) ·
`docs/LAUNCH-RUNBOOK.md` (stale gate counts and migration range — see below).

### Launch runbook

Nothing about launch changes: no env var, no migration, no `company_settings`
key, no smoke test, no go-live step. Saying so is the honest answer rather
than padding the runbook with a module that ships zero operator-visible
surface.

The only edits made are factual corrections in the pre-deploy gate block,
which an operator compares real output against: the quoted counts were "168
unit / 165 RLS / 145 e2e" (stale since M-69) and are now **268 / 173 / 160**,
and the RLS suite was described as rebuilding `0001 → 0013` when M-69 took the
chain to `0016`. Leaving those wrong is a real defect, just a small one.

---

## Extension points

- **M-71** writes the DDL from the table above. Adding a column means adding
  it to the matching `*Row` **and** deciding its audience in `dto.ts` — the
  staff-DTO completeness test fails on any `ShipmentRow` field that is not
  either serialized for staff or explicitly excluded (today the only exclusion
  is `public_access_hash`).
- **M-72** builds the transition engine on `ShipmentStatus`. `SHIPMENT_STATUSES`
  is declaration order, **not** a transition graph — `delayed` and `cancelled`
  are lifecycle states, not milestones, so deriving progress from the index
  would be wrong. §20's preconditions and impossible-transition list belong
  there, as does the `Record<ShipmentStatus, readonly ShipmentStatus[]>` map
  (the `loads.ts` `LOAD_TRANSITIONS` pattern).
- **M-73** adds the `shipment` i18n namespace in five locales, keyed by the
  builders here, and calls `toPublicTrackingDto` — never a raw row.
- **M-77** writes the document-type → audience matrix over
  `ShipmentDocumentVisibility`, whose `broker` value already exists.
- **M-78** extends the ETA surface; the enums and `ShipmentEtaHistoryRow` are
  in place, and `eta_source` is what makes §30's "ETA provided by dispatcher"
  label honest rather than decorative.
- **M-80** decides per-event coordinate disclosure. Customer event DTOs carry
  no latitude/longitude today, which is the honest position until provider
  consent and the §9 levels are wired end to end.
- **M-83** reuses the key-set + sentinel pattern for its public-DTO proofs and
  can import `PUBLIC_KEYS` thinking from this suite; M-88 applies the same
  pattern to carrier ratings, which §32 C requires never be exposed publicly.
