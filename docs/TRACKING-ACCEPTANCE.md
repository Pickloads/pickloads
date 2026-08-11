# Tracking acceptance — §31, walked

**Module:** M-84 · **Directive:** `docs/DIRECTIVE-tracking.md` §31 ·
**Baseline:** M-83 (`6dc5e34`)

§31 lists nineteen conditions and says the tracking system *"is accepted only
when"* all of them hold. This document walks each one, names the evidence, and
— where the evidence is weaker than the sentence — says so instead of rounding
up.

Three of the nineteen cannot be closed in a repository at all: they are
statements about a **running production environment**, and the only honest
thing a codebase can offer is the mechanism plus the smoke test that confirms
it. Those are marked **live-env**. The rest are closed here.

## Legend

| Mark | Meaning |
|---|---|
| **MET** | proved by an executing assertion, with a non-vacuity control |
| **MET (live-env)** | mechanism built and tested; final confirmation needs the production environment. The smoke test is named |
| **MET (gated)** | true, and only observable once `brokerage_active` is true |

---

## The nineteen

### 1 · Authorized shippers can view their shipments — **MET**

`getShipperShipments`, `getShipmentSummary` and `getShipmentTimelinePage` run
against a real PostgreSQL 16 as a real `authenticated` session, returning the
tenant's rows under the real 0018/0021 policies. §27's shipper flow is walked
as a **sequence** in `tests/integration/tracking-flows.test.ts` — the list
hands the detail an id, the detail names a document, the document is
downloaded — so the seams between steps are proved and not only the steps.

Non-vacuity: shipper B walks the identical six steps and reaches nothing at
every one of them, while an admin sees everything.

### 2 · Public users can securely track with secondary verification — **MET**

Two factors, always; the second is a keyed HMAC and is never stored. Proved
end to end in `tests/integration/public-tracking.test.ts` (happy path, three
refusal classes proved byte-identical, the rate-limit trip, the ledger), and
in the browser by `tests/e2e/track.spec.ts` and `tracking-flows.spec.ts`.

**Honest caveat (§24):** the page is offered in five locales and the
`shipment.*` catalogue is **363 of 411 strings untranslated in `ru` and
`ht`** — those two locales render the tracking system in English. Functionally
the criterion is met; linguistically it is not, for two of five audiences.
Measured and ratcheted by `tests/unit/i18n-coverage-ratchet.test.ts`; listed
under Open items below.

### 3 · Carriers can update only assigned shipments — **MET**

`ACTOR_PERMITTED_TARGETS` refuses non-carrier actions before preconditions are
even consulted, and the database refuses independently. Carrier A cannot read
carrier B's shipment or documents — asserted on the same live shipment as
every other refusal in `tracking-flows.test.ts` §27 security flow, with carrier
A's own access as the control. The driver link is scoped to one shipment by a
`NOT NULL` column and an immutability trigger, and stops working the moment
the carrier is released or replaced.

### 4 · Dispatchers can manage shipment operations — **MET**

The whole §14 surface: create, quote conversion, assignment, appointments,
status, ETA, delay, public update vs internal note, record call, record email,
exception, POD request, notification resend, release, search, and the
eight-column board. `tests/integration/dispatcher-operations.test.ts` walks
§27's dispatcher flow from create to complete and exercises every board
column's real SQL against real rows.

### 5 · Admins can audit every status change — **MET**

Every status change is an event, written in the same statement as the change,
in an append-only table. `audit_events` additionally journals staff actions
and every document download through a single writer. Corrections are additive
and carry a mandatory reason; the original event is provably unchanged.

### 6 · Shipment timelines preserve event history — **MET**

`guard_shipment_events_append_only` refuses `update` and `delete` for every
role **including the table owner**. Appointments, ETAs and assignments follow
the same rule — a reschedule is a new event carrying the previous value, a
release stamps `released_at` rather than deleting. Asserted in
`shipment-lifecycle`, `dispatcher-operations` and `shipment-eta-exceptions`.

### 7 · Status transitions are validated server-side — **MET**

Three independent gates: the engine (`evaluateTransition`), the RPC
(`apply_shipment_transition`, a compare-and-swap raising `PL409` on a stale
expectation), and the grant model (`execute` revoked from `public`). No
browser role can write to any shipment table — §19 proof 5 asserts `42501` for
`update`, `insert` and `delete` from every browser role. The engine's decision
and the RPC's decision are checked against each other on real rows.

### 8 · ETA changes create history — **MET**

`shipment_eta_history` rows, written in the same call as the column and the
event, carrying the previous value forward. Append-only. A no-op restatement
is refused (`PL422`) and writes nothing; a cleared ETA is recorded as a change;
pickup and delivery keep separate histories.

### 9 · Delays and exceptions are supported — **MET**

`shipment_exceptions` with a structured type and severity, triage, mandatory
resolution, one-way closure, idempotent opening, and a backfill that migrated
the tagged events M-75/M-76 shipped without deleting anything. Customer
visibility is enforced twice and swept for sentinels.

### 10 · Documents use private storage — **MET (live-env)**

The bucket is private and migration 0024 grants **no** customer policy on
`storage.objects` for it — the row decides and we serve the object. URLs are
signed for ≤300s after two permission gates, and the access is journalled
before the URL is returned.

Live-env: the bucket's privacy is a Supabase configuration fact. Smoke test 8
in `docs/tracking/launch.md` confirms it, and the runbook's R-8 item asks for
an object-level assertion that carrier A cannot fetch a signed URL for carrier
B's object path.

### 11 · POD can be uploaded and shared securely — **MET**

Upload → `pending` → review → `approved`, with `pod_uploaded` refused in all
four failure modes (no POD, unapproved, rejected, wrong type) and reachable
again only while the approval stands. A shipper reaching their own POD **and
being refused the rate confirmation on the same shipment, in the same
session** is asserted in `tracking-flows.test.ts` — the sharpest seam in the
document model.

### 12 · Customer notifications are logged — **MET**

Every notification is a queue row with an idempotency key, an attempt ledger
(append-only) and a settled outcome carrying the provider response.
Suppressions are terminal and recorded. The in-app feed row is written even
when the email channel is off.

### 13 · Public tracking exposes no private financial data — **MET**

Four layers, each independently tested: no `anon` policy and no `anon` table
privilege; column-level revoke on the financial four; an allow-listed public
DTO with a key-set test; and a **value** sweep for sentinels that a key-set
test structurally cannot perform. All of it re-asserted at route level in
`tracking-security.test.ts`, and again in `tracking-flows.test.ts` against a
shipment that genuinely carries the figures — so the sweep is not sweeping
nulls.

Anti-vacuity: the same assertions are run against a naive row passthrough and
fail.

### 14 · RLS isolation tests pass — **MET**

**806 assertions** in `supabase/tests/*.sql`, plus **369** in the integration
lane exercising the same policies through the real `src/` query builders.
§19's seven proofs are all proved at the database, including the sixth
(dispatcher least-privilege), which required migration 0030's fourteen
restrictive policies because until M-83 it was true only in application code.

Several tests remove the application-level tenant predicate and assert the
database still refuses — separating "the app filtered it" from "the policy
refused it".

### 15 · Mobile tracking works from 320px upward — **MET**

Twelve widths from 320 to 1920, in real Chromium behind the compiled
stylesheets, asserting overflow, inner overflow, ≥16px inputs, table
readability, map bounds and reduced-motion compliance. The predecessor scans
ran in jsdom with no stylesheet and could observe none of that; replacing them
surfaced twelve genuine defects.

### 16 · Portal and tracking pages meet accessibility requirements — **MET**

axe at 320 / 768 / 1440 with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa`, plus ten assertions for what axe cannot see (heading order, status
carried by text not colour, keyboard reachability, focus-visible, `aria-live`,
error and empty states, hover-without-focus, the map's text alternative,
meaningful document labels). Contrast uses the Q7 companion tokens where a V4
value fails AA for text.

**Honest caveat:** WCAG conformance is a claim about an experience, and an
automated suite covers perhaps half of it. No screen-reader user has tested
these surfaces. That is the next accessibility step and it is not a code task.

### 17 · No fake location or status data is presented — **MET**

Every provider adapter refuses every fetch — there is no telematics contract —
and the integration lane asserts `shipment_locations` holds no provider-sourced
row nobody recorded by hand. The estimator refuses a null distance rather than
substituting one. Revoking the last tracking link returns the shipment to
`milestone` tracking rather than leaving a stale position on screen.

**M-84 closed a live violation of this criterion.** §30 forbids claiming "live
tracking" while updates are manual; the marketing surfaces carried the claim
in **nine** places across five locales — `/shippers` (heading, hero,
metadata), the JSON-LD service description, the home-page teaser, the process
diagram, a services list, the shipper portal's empty state and an FAQ answer.
All are now §30's approved wording, and
`tests/unit/section-30-honest-labels.test.ts` is a standing guard in every
authored language, with non-vacuity controls proving both that it catches the
sentences that actually shipped and that it does not flag the honest uses of
the word "live".

### 18 · Production build passes — **MET**

`npm run build` — 388 pages. Plus `npm run typecheck`, `npm run lint`, and
`npm audit` at 0 (kept there by pinned `overrides` for postcss and sharp).

### 19 · Documentation and Launch Runbook are updated — **MET**

§29's eighteen documents exist under `docs/tracking/`, each with its named H1,
each linked from the index, each checked by
`tests/unit/section-29-docs.test.ts`. `docs/LAUNCH-RUNBOOK.md` gained §9d — a
tracking chapter covering all eight topics §29 names (environment variables,
migrations, public tracking configuration, map configuration, notification
setup, smoke tests, go-live checks, rollback steps).

---

## Summary

| Result | Count | Criteria |
|---|---|---|
| **MET** | 18 | 1–9, 11–19 |
| **MET (live-env)** | 1 | 10 |

Nothing is unmet. Two criteria carry honest caveats (2 — locale coverage; 16 —
no screen-reader testing), and one needs a production environment to confirm a
configuration fact (10).

---

## What is gated, not missing

Several behaviours are correct and currently unobservable because
`company_settings.brokerage_active` is `false` — the honest state for a
business whose MC authority is pending:

- No shipment can be created (migration 0017's trigger refuses the insert, and
  the create form renders an honest card instead).
- Therefore no public lookup can succeed against real freight.
- Therefore no notification can be generated for real freight.

**Freight already in flight is deliberately unaffected** by the gate: status,
ETA, notes, assignments and documents all keep working, and that is tested.
Every one of these behaviours is proved in the test lanes with the gate opened
deliberately, exactly as the RLS fixtures do.

Flipping the gate is an admin action requiring no deploy. See the runbook's
one-pager.

---

## Open items

These are real, they are not blockers for §31, and none of them is hidden.

| # | Item | Owner |
|---|---|---|
| **O-1** | **`shipment.*` is 363/411 untranslated in `ru` and `ht`**; the `v4` marketing namespace is 423/750 and 429/750. Two of five audiences read the product in English. Ratcheted so it cannot worsen; closing it is a translation project with a review step, not a code change | translation |
| **O-2** | No screen-reader testing has been done on any tracking surface (criterion 16's caveat) | accessibility |
| **O-3** | Storage object-level isolation (runbook R-8) — that carrier A cannot fetch a signed URL for carrier B's object path — needs a live Supabase project to assert | live-env |
| **O-4** | `/track`'s lookup form is client-rendered (it reads `?number=` via `useSearchParams`), so it is absent from the static HTML. M-84 added a server-rendered `<noscript>` block with the dispatch number; making the form itself work without JavaScript would mean giving up the prefill | product decision |
| **O-5** | next-intl ships the full message payload to every page, so `/track` carries staff-facing vocabulary (document type labels and similar) in its flight data. Not a data leak — labels, not values — but it is payload the anonymous visitor does not need | performance |
| **O-6** | Decisions **D-3…D-9** in `docs/FINAL-IMPLEMENTATION-PLAN.md` §6 remain formally unanswered; the recommended defaults are being applied | business |
| **O-7** | Observability (§26) is **M-84b**: Sentry wiring, the nine tracked signals and enforcement of the "never log" list. The signal vocabulary exists (`src/lib/shipments/observability.ts`) and is emitted; the sink does not | M-84b |

---

## How to re-verify this document

```bash
npm run typecheck && npm run lint && npm run build
npm test                  # includes the §27 index, the §29 doc check,
                          # the §30 guard and the i18n ratchet
npm run test:rls
npm run test:integration
npx playwright test
```

Then walk the ten smoke tests in `docs/tracking/launch.md` §6 against the
deployed environment, with a real shipment that is cancelled afterwards rather
than left in the data as fabricated freight.
