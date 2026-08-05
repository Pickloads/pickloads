# M-73 — Public Secure Tracking Page (`/track`)

**Status:** ✅ Complete (validated on PostgreSQL 16) · **Phase:** B (tracking
core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-73 —
*"Public `/track`: two-factor lookup (number + ZIP/access code), server-route
only (no anon table SELECT), rate limiting, enumeration protection, access
logging, strict public DTO, honest labels (§30) ×5 locales, accessible
text-equivalent timeline, public support-message button with Turnstile."*
Authority: `docs/DIRECTIVE-tracking.md` §§2, 4, 5, 7, 8, 15, 17, 19, 22, 23,
24, 25, 26, 30 and plan §4's restored rows for **§8**, **§24 + §17**, **§30**
and decision **D-6**.

Vocabulary and DTO: **`docs/modules/M-70-shipment-domain.md`** — the route
calls `toPublicTrackingDto`, never a raw row. Schema: **M-71** (0017–0018),
**M-72** (0019). One new migration, **0020**.

Shipper portal pages are M-74. The dispatcher board is M-75. Nothing here
touches either.

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0020_shipment_tracking_access.sql` | The §19 access ledger: 8 columns, 4 indexes, append-only trigger, one staff-SELECT policy, **zero anon policies, zero write policies** |
| `src/lib/shipments/access-code.ts` | The §4 secondary credential: HMAC-SHA-256 under `TRACKING_ACCESS_SECRET`, tolerant normalisation, non-short-circuiting comparison, a per-process decoy hash, fail-closed |
| `src/lib/shipments/public-lookup.ts` | The §19 lookup: service-role only, one refusal, one timing floor, mandatory ledger write, §25-bounded timeline, `toPublicTrackingDto` |
| `src/lib/shipments/phrases.ts` | **Decision D-6** — 29 curated public phrases + the free-text resolver and its honest label |
| `src/lib/shipments/public-timeline.ts` | §8's nine milestones as data + §23's text equivalent, as values not prose |
| `src/lib/shipments/public-tracking-state.ts` | The `useActionState` shape and the five localized error keys |
| `src/lib/validation/public-tracking.ts` | The Zod input — deliberately permissive on shape (see *Enumeration*) |
| `src/app/actions/public-tracking.ts` | The guard stack: rate limit (tighter) → Turnstile → Zod → lookup |
| `src/app/actions/tracking-support.ts` | §8's support button, delegating to the shipped `contact_messages` path |
| `src/app/[locale]/(site)/track/page.tsx` | The page — a static shell that reads no shipment |
| `src/components/tracking/*` (5 files) | Lookup form, result, timeline, support disclosure, date formatting |
| `scripts/extract-i18n.mjs` + `messages/*.json` | The `shipment` namespace M-70 deferred — **176 keys × 5 locales** |
| `src/app/v4.css` | `.track-*` + `.sr-only`, token-only, no new colours |
| `src/lib/seo.ts` | `/track` added to `PUBLIC_ROUTES` (sitemap + hreflang) |
| `.env.example` | `TRACKING_ACCESS_SECRET` — the one new variable |

Tests: `tests/unit/shipment-access-code.test.ts` (19) ·
`tests/unit/shipment-public-lookup.test.ts` (19) ·
`tests/unit/shipment-public-tracking-ui.test.ts` (29) ·
`tests/unit/tracking-result-a11y.test.tsx` (17) ·
`tests/integration/public-tracking.test.ts` (14) + the psql-backed PostgREST
adapter · `supabase/tests/20_rls_isolation.sql` §9 (+18) ·
`tests/e2e/track.spec.ts` (8) + `/track` added to the axe and responsive
suites.

Migrations **0001–0004 remain frozen**; 0017–0019 are untouched. The whole
module is additive: one new table, one trigger, one policy, one route.

---

## Why

### Why the credential is HMAC'd, not hashed

§4's second factor is a recipient ZIP or a short access code. A US ZIP has
~41 000 live values; `sha256(zip)` is a rainbow table an attacker builds in
under a second. Since the FIRST factor is a 14-character identifier printed on
every bill of lading, a leaked database dump under a plain digest would hand
over every shipment's protection at once.

`HMAC-SHA-256(value, TRACKING_ACCESS_SECRET)` removes the precomputation
attack entirely: without the env key an attacker cannot compute a candidate
digest at all. This is the same reasoning `src/lib/crypto.ts` applies to
`carriers.ein`; the difference is that a ZIP must be *comparable* rather than
*recoverable*, so a keyed one-way function is right where AES-GCM is right
there.

A per-row salt would be marginally better and was **not** used: it needs a
second column on `shipments`, whose schema shipped in M-71. The env key already
defeats the attack that matters, and `TRACKING_ACCESS_HASH_VERSION` gives a
rotation path that costs no migration.

**This module fails CLOSED**, unlike most of the repo. With
`TRACKING_ACCESS_SECRET` unset, every lookup returns `unavailable`. "We cannot
verify the credential" and "the credential is correct" are not the same
sentence, and the M-14 degradation idiom — warn, skip, carry on — would turn
the second one into the first.

### Why a server action rather than a route handler

§19 permits either. The action was chosen for what it does **not** create: a
URL.

`GET /api/track?number=…&zip=…` would place both factors in the address bar,
the browser history, the `Referer` header of every outbound link, and any
corporate proxy log between the customer and us. It would also give a crawler
something to fetch. A POST server action leaves the address bar on `/track` for
every visitor, so "individual results are never indexed" is true because there
is no address to index — proved in `tests/e2e/track.spec.ts`.

It also inherits `guardPublicForm`, so rate limiting and Turnstile are not
re-implemented at a second call site.

### Why `/track` is a static shell

§25: *"never cache private shipment data publicly."* The plan flags `/blog`'s
ISR as the pattern not to repeat here.

The page reads no shipment at all. It renders a form; every byte of shipment
data arrives in the body of an uncacheable POST response. The prerendered
artifact therefore contains nothing private — which is a stronger guarantee
than `force-dynamic`, because it does not depend on a directive staying in the
file. The `Revalidate 1m` the build prints for `/track` is the
`getBooleanSetting("brokerage_active")` TTL, exactly as on `/`, `/shippers` and
every other switchboard-reading page.

### Why the support button writes to `contact_messages`

Plan §5 regression risk **R-1**: `support_threads.profile_id` is
`NOT NULL references profiles(id)` in shipped migration 0007, so a guest ticket
**cannot exist**. Decision **D-5** assigns guest tickets to M-89 with their own
table; altering 0007 was ruled out by the task and would be wrong anyway
(0007's RLS assumes a profile on every row).

`submitTrackingSupportMessage` therefore writes nothing itself. It composes the
subject from the normalised tracking number **server-side** — so a submitter
cannot forge a different shipment's reference onto a message — and delegates to
`submitContactMessage`, the shipped path, which already carries Turnstile, the
rate limit, Zod bounds (5 000-character body) and the internal notification
email. One code path, one set of guarantees. The executive directive's
no-duplicate-APIs rule is satisfied by reuse, not by resemblance.

The message carries the customer's words and the reference. It carries **no**
shipment data: echoing a DTO into an email that leaves the platform would widen
§4's exposure surface for no operational gain.

---

## Decision D-6 — operator free text on a five-locale page

**Resolved per `FINAL-IMPLEMENTATION-PLAN` §6's recommendation: (b) a curated
phrase library translated ×5 for statuses, delay reasons and standard exception
messages, PLUS (a) an honest label for genuinely novel dispatcher free text.
Never machine-translate silently — §24 forbids it.**

### The problem

§24 requires every customer-facing tracking string in five languages and
forbids machine-translating customer-specific free text "without a defined
workflow". §7, §10 and §21 simultaneously require dispatchers to publish human
sentences (`public_message`, `delay_reason_public`, `public_description`). A
dispatcher in Irvington types English at 06:40; a Haitian-Creole-speaking
consignee opens `/track` at 06:41.

### The implementation

`src/lib/shipments/phrases.ts` holds **29 curated phrases** in three groups
matching D-6's three named categories:

| Group | Count | Example |
|---|---|---|
| `update.*` — standard public status notes | 9 | "The freight has been picked up." |
| `delay.*` — standard delay reasons | 8 | "The driver is taking a required rest break." |
| `exception.*` — standard exception messages | 12 | "Pickup is running later than scheduled. Dispatch is confirming a new time." |

A dispatcher picking from the library stores a **token** (`phrase:delay.traffic`)
in the same `text` column the migrations already ship — no schema change, no
backfill. `/track` resolves the token to `shipment.phrase.delay.traffic` and
renders it in the visitor's language.

`resolvePublicText` has three branches, in precedence order:

1. **token** → translated. The explicit case.
2. **exact canonical-English match** → translated. A dispatcher who typed the
   library's own sentence by hand meant the library's own sentence (matching
   is case- and punctuation-insensitive, and only the library's own strings
   match).
3. **anything else** → free text: rendered verbatim, with `lang="en"` so a
   screen reader switches voice instead of reading English with French
   phonemes, under the visible label **"Written by dispatch, in English"**
   (`shipment.label.dispatch_written`, translated ×5).

An **unknown or retired token** falls into branch 3 and renders as the literal
`phrase:whatever` under the honest label — visibly wrong rather than silently
blank. That is deliberate: a retired id should produce a support call, not a
gap.

`exception.other` deliberately has **no** canned phrase. §21's thirteenth type
is the catch-all, and a sentence for "something else happened" either says
nothing or says something untrue; M-70's DTO already omits an exception whose
`public_description` is null.

**Nothing is translated at request time.** There is no translation API, no
model call, no heuristic. Either the operator chose a sentence that has been
translated by a human, or the reader is told which language they are reading.

---

## How

### The guard stack (§19, CLAUDE.md security model)

```
POST /track (server action)
  1. rate limit    per IP, 4 / 10 min  (tighter than the shared default of 5)
  2. Turnstile     server-side siteverify
  3. Zod           presence + length only — see below
  4. lookup        service-role client, the ONLY door
     4a. normalise + validate the tracking number
     4b. one indexed SELECT, explicit projection, no financial columns
     4c. constant-time-ish HMAC comparison — ALWAYS, decoy when there is no row
     4d. write shipment_tracking_access — MANDATORY
  5. toPublicTrackingDto
  6. hold the response to MIN_RESPONSE_MS (350 ms) on every path
```

**Rate limit — 4, not 5, and not per-number.** A customer holding the right
paperwork needs one attempt; four leaves room for a typo, a re-send and a
shared office NAT, and caps a guesser at ~576 attempts a day per address
against a 10⁶ sequence space. A tighter **per-tracking-number** limit was
considered and rejected: it would let anyone who knows a customer's number lock
that customer out of their own tracking for ten minutes at a time — trading an
enumeration risk the second factor already covers for a denial of service
anyone can mount. The distributed-guessing shape it would have caught is made
*visible* instead: `idx_shipment_tracking_access_number` exists so an operator
can count attempts per number across every IP.

**Zod is permissive on shape, on purpose.** If Zod rejected `PL-1999-000001`
with "that isn't a PickLoads tracking number" while `PL-2026-999999` came back
with "no shipment matches", the two messages would together confirm which years
are live — a quarter of the search space. Malformed and well-formed-but-wrong
produce the same refusal. The only rejections are an empty field and an absurd
length (64 chars, so a script cannot post a megabyte into the ledger).

### §8's four blocks

| §8 requirement | Where |
|---|---|
| Header summary — number, status, type, origin, destination, estimated delivery, last update | `TrackingResult`, an `auto-fit` grid whose DOM order is §22's mobile priority (status → ETA → route) |
| Progress timeline — 9 milestones, completed with timestamps / current highlighted / future inactive / exception in an accessible warning style | `TrackingTimeline` over `buildPublicTimeline` |
| Shipment summary — appointments, equipment, commodity, weight, pallets, references, PO | `<dl class="track-summary">` |
| Contact — support, phone, email, support-message button | `.track-contact` + `<details class="track-support">` |

**Milestones are not statuses.** §6 has eighteen statuses; §8 shows nine steps.
`MILESTONE_PROGRESS` is a total `Record<ShipmentStatus, number>` behind a
`satisfies` guard, so a nineteenth status is a **compile error** rather than a
shipment that silently renders as "not started". `delayed` and `cancelled`
carry sentinels and derive their position from the timeline instead — a delayed
truck must not lose its "Picked Up" tick because dispatch flagged the delay,
and a cancelled shipment should still show how far it got (§7 forbids deleting
history; silently un-drawing it is the same lie in CSS).

Milestone labels get their own key branch (`shipment.milestone.*`) because §8's
wording is not §6's: "POD available" is a fact about the customer's paperwork,
"Proof of delivery received" is a fact about an operator's action. One key
serving both would force one of them to be wrong in five languages.

### §23 accessibility

* **Semantic timeline** — an `<ol>` with an accessible name, nine `<li>`, each
  carrying `<time datetime>`.
* **Text equivalent** — a `role="status"` sentence: *"5 of 9 steps complete.
  Current step: In transit."* It is the §23 requirement AND the `aria-live`
  target, so a second lookup announces one sentence instead of re-reading nine
  list items.
* **State in text, not colour** — every step renders a visible word
  ("Completed" / "Current step" / "Current step, needs attention" / "Not
  started"). Disable the stylesheet and the page still tells you where the
  truck is. The green dot, amber dot and red ring are a redundant second
  signal.
* **Keyboard** — no hover-only affordance anywhere; the support form is a
  `<details>` disclosure, not a modal, so there is no focus trap to get wrong
  and §22's "no mobile modal exceeding screen" is structurally impossible.
* **Reduced motion** — `@media (prefers-reduced-motion:reduce)` covers the new
  rules; the timeline has no animation to begin with.
* **Localized date/time** — `Intl` with the **active locale** and the
  **visitor's** time zone (a consignee asking "when does it get here" means
  their own clock), with the ISO value always present in `datetime`.

### §30 honest labels

All six the directive quotes, translated ×5:

| Key | Rendered where |
|---|---|
| `label.last_updated_by_dispatch` | under "Last update", always |
| `label.milestone_tracking` | when a location exists in manual (Mode A) tracking |
| `label.live_location_available` | only when `tracking_mode !== 'manual'` **and** a location exists |
| `label.location_unavailable` | when no location has been recorded |
| `label.eta_by_dispatcher` | when `eta_source` is `manual` or `dispatcher_adjusted` |
| `label.tracking_link_expired` | **authored, not yet rendered** — see below |

`label.tracking_link_expired` is the one label with no honest call site in
M-73: link expiry lives in `tracking_provider_connections.expires_at`
(M-80, Mode B) and in the driver-update token (M-76). Rendering it on `/track`
would require inventing a condition. It is authored in all five locales now
because §30 names it, and it is asserted present by
`tests/unit/shipment-public-tracking-ui.test.ts`; M-76/M-80 consume it. Saying
so is better than a fake trigger.

**Audited against §30's prohibitions.** No string this module writes contains
"live tracking", "real-time", "AI-powered", "artificial intelligence" or
"machine learning" — asserted three ways: over the 29 phrase strings, over the
entire English `shipment` namespace (176 keys), and over the rendered `main`
element in Playwright. The result page states plainly: *"Updates are entered by
our dispatch team as milestones are confirmed. This page does not show a live
GPS position."*

> **Audit finding, outside M-73's scope.** `/shippers` (M-12) renders the V4
> prototype's marketing copy "Live tracking" and a `LIVE TRACKING` flow node
> while tracking is Mode A / manual. That is a §30 exposure on M-12's page, not
> on this one; CLAUDE.md's "convert, never redesign" rule and this module's
> scope both say it is not M-73's to rewrite. Filed here for **M-74/M-85**,
> alongside plan §3's P-2/P-3 precedent for gating unfulfillable copy.

### §2 honest pre-brokerage state

While `company_settings.brokerage_active` is false, 0017's gate trigger refuses
to create a shipment at all — so every lookup honestly returns "no match".
Saying nothing would leave a visitor to conclude they mistyped. The page shows
a neutral notice: brokerage shipments begin when the FMCSA broker authority and
BMC-84 bond are active, and dispatch customers track loads in the Carrier
Portal. It claims no active brokerage (§2) and shows no fabricated shipment
(§30). `getBooleanSetting` fails closed, so an unreachable switchboard shows
the honest wording rather than implying brokerage is live.

### §25 performance

* Static shell, no shipment data in any cacheable artifact.
* One indexed SELECT for the shipment (`shipments_tracking_number_key`), one
  for the timeline — no N+1.
* Explicit column projection; the three financial columns and
  `delay_reason_internal` never enter process memory on a public request.
* Timeline capped at **25 public events**, filtered to the `public` band **in
  SQL** (`idx_shipment_events_audience`), fetched newest-first with one extra
  row to answer "is there more?" without a second query.
* `/track`'s client bundle is 7.4 kB; the build is **348 pages** (343 + 5
  locales of `/track`).

---

## Security — the enumeration threat model

### Assets and adversary

The asset is a customer's shipment status, route, appointments and references
(§4's public-safe subset). The adversary is unauthenticated, holds the public
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (it ships in the browser bundle), can script
requests, and may hold a legitimate tracking number for one shipment.

### Attack 1 — direct table access

**Blocked structurally.** 0018 (M-71), 0019 (M-72) and 0020 create **zero anon
policies** on `shipments`, `shipment_events`, `shipment_parties`,
`shipment_assignments` and `shipment_tracking_access`. There is no PostgREST
query, however crafted, that returns a shipment row to an anonymous session.
Asserted in `supabase/tests/20_rls_isolation.sql` (§7, §8 and the new §9).

The service-role client lives in one file (`public-lookup.ts`), behind
`import "server-only"` — a client-bundle import is a build error.

### Attack 2 — enumerating tracking numbers

`PL-YYYY-######` is 10⁶ per year, and M-70 is explicit that the number is an
**identifier, not a credential**. Four controls, none sufficient alone:

1. **The mandatory second factor.** No code path returns shipment data without
   a successful HMAC comparison.
2. **Rate limit**, per IP, tighter than every other public form.
3. **One indistinguishable refusal.** Unknown number, wrong secondary value and
   admin-suspended tracking return the *identical* value —
   `{ ok: false, code: "refused" }` — and render the *identical* sentence
   (`shipment.error.refused`). Malformed input joins them. Deep equality
   between the three is asserted in both the unit and integration lanes, and
   the e2e suite asserts the rendered message never names a factor.
4. **A flat timing profile.** The "no such number" branch performs a full HMAC
   + `timingSafeEqual` against a per-process CSPRNG **decoy** hash rather than
   short-circuiting, and every outcome is held to a 350 ms floor. Skipping the
   comparison would have made "unknown number" the fast path and turned the
   page into an existence oracle regardless of what the body said.

**Residual, stated honestly.** A *granted* lookup takes longer than a refusal
(it runs the timeline query). That is not an oracle: reaching it requires
already holding the correct credential. And the 350 ms floor flattens the
signal, it does not erase it — a determined attacker with thousands of samples
could still measure network-level variance. The rate limit, not the floor, is
what makes that impractical, and the ledger is what makes it visible.

### Attack 3 — brute-forcing the second factor

~41 000 realistic ZIPs against a 4-per-10-minutes budget is ~7 years per
shipment from one address. Distributed across addresses it is faster and the
per-IP limit cannot see it — which is why every attempt is logged with its IP
and its attempted number, and why `idx_shipment_tracking_access_number` and
`idx_shipment_tracking_access_ip` exist. §26's
`repeated_invalid_tracking_attempts` signal fires on every rate-limit trip.

### Attack 4 — harvesting the ledger

The access log is itself a target: it says which numbers exist and which were
guessed. So it has **one** policy — staff SELECT. No anon policy (an anon read
would publish our telemetry to the party generating it). No customer policy
(the rows carry third-party IPs; §15 makes access history an admin capability).
**No write policy at all, staff included** — a staff session that could write
here could forge the evidence. Every row arrives through the service role, and
`trg_shipment_tracking_access_append_only` refuses UPDATE and DELETE for every
role including the table owner.

### Attack 5 — the ledger becoming the credential store

`shipment_tracking_access` stores the attempted tracking **number** — it is the
thing being guessed, and a ledger that does not record the guess records
nothing. It stores the attempted **secondary value in no form at all**: not
plaintext, not truncated, not hashed. A table of hashes of attempted ZIPs would
be a rainbow-friendly index of exactly the credential §4 relies on, accumulated
in a table whose purpose is to be read by operators.

This is enforced four independent ways:

1. M-70's `ShipmentTrackingAccessRow` has no such field.
2. 0020's table has no such column.
3. `recordTrackingAccess` has no such **parameter** — there is no way to pass
   it.
4. `supabase/tests/20_rls_isolation.sql` §9a asserts the **exact 8-column set**,
   so a future migration adding `secondary_hash` fails the suite. The
   integration lane adds the value-level companion: after a lookup with a known
   secret, the whole table is swept for it (`to_jsonb(...)::text ilike`) and
   must return zero.

### Failure modes, and which way they fail

| Condition | Behaviour | Why |
|---|---|---|
| `TRACKING_ACCESS_SECRET` unset | every lookup `unavailable` | cannot verify ≠ verified |
| `SUPABASE_SERVICE_ROLE_KEY` unset | every lookup `unavailable` | no door, no data |
| ledger INSERT fails | lookup **refused**, even with a correct credential | §19 says the route logs access; an unlogged successful access is the record an investigation would need and not have |
| shipment or timeline query errors | `unavailable` | says nothing about any number, so not an oracle |
| `brokerage_active` false | no shipments can exist (0017 gate); honest notice shown | §2 |
| Upstash unreachable | limiter allows (existing M-14 behaviour) | Turnstile and the second factor still gate; a Redis outage must not take tracking down |

### What this module does NOT claim

* It does not make the tracking number secret.
* It does not protect against a customer forwarding their own tracking link and
  ZIP to somebody else. That is a disclosure decision the customer owns.
* It does not implement per-shipment revocation UI — §15's "revoke public
  codes" is M-75's dispatcher surface. The *mechanism* exists today
  (`public_tracking_enabled = false` refuses with the standard refusal, proved
  in the integration lane); only the button is elsewhere.
* Column-level protection of the three financial columns remains M-71's
  residual risk **R-1** (RLS is row-level). M-73 adds a second and third layer
  — the DTO allow-list and an explicit SELECT projection that never names them
  — but does not close R-1 itself, which is M-83's.

---

## DB changes

### Migration 0020 — `shipment_tracking_access`

M-70's `ShipmentTrackingAccessRow`, exactly: `id`, `shipment_id` (nullable —
null is the enumeration case), `tracking_number_attempted`, `outcome`
(`tracking_access_outcome`, created by 0017), `ip`, `user_agent`, `profile_id`
(for M-74's authenticated lookups), `accessed_at`.

Both foreign keys are **NO ACTION**, matching `audit_events.actor_id` (0005): a
ledger a cascade can rewrite is not a ledger. Length CHECKs on
`tracking_number_attempted` (64), `ip` (64) and `user_agent` (512) mean the app
is not the only thing bounding the row.

Four indexes, each answering a question an operator actually asks:

| Index | Question |
|---|---|
| `idx_shipment_tracking_access_ip` | is one network sweeping us? |
| `idx_shipment_tracking_access_number` | is one number being hammered from many networks? |
| `idx_shipment_tracking_access_shipment` (partial) | §15: who has looked up this shipment? |
| `idx_shipment_tracking_access_failures` (partial) | §26's failure feed |

### ROLLBACK (0020)

```sql
drop policy if exists "staff read shipment tracking access" on shipment_tracking_access;
alter table shipment_tracking_access disable row level security;
drop trigger if exists trg_shipment_tracking_access_append_only on shipment_tracking_access;
drop function if exists public.guard_shipment_tracking_access_append_only();
drop table if exists shipment_tracking_access cascade;
```

**DESTRUCTIVE**: drops the entire public-tracking access history, which is the
only record of enumeration attempts against the platform. `pg_dump -t
shipment_tracking_access` first. Note the **order** — the append-only trigger
goes before the table, because `drop table` is DDL and does not fire it while
clearing rows first would.

The `tracking_access_outcome` **enum is not dropped**: 0017 created it and 0017
is not being rolled back.

Roll back `src/lib/supabase/database.types.ts` and remove
`src/lib/shipments/public-lookup.ts` + the `/track` route **in the same
deploy**, or the page inserts into a table that no longer exists — which fails
*closed* (the lookup treats a failed ledger write as a refusal), so the visible
symptom is "tracking is temporarily unavailable", never a silent unlogged
lookup. `shipments`, `shipment_events`, `shipment_parties` and
`shipment_assignments` are untouched.

---

## Endpoints

| Surface | Kind | Auth | Guards |
|---|---|---|---|
| `/{locale}/track` | page (static shell, 5 locales) | public | none needed — renders no shipment |
| `lookupTracking` | server action | public | rate limit 4/10min → Turnstile → Zod → HMAC → DTO → ledger |
| `submitTrackingSupportMessage` | server action | public | delegates to `submitContactMessage`: rate limit 5/10min (shared `contact-message` bucket) → Turnstile → Zod |

No REST route, no `/api` addition, no anon database policy.

## Env vars

**One, new: `TRACKING_ACCESS_SECRET`.** Any strong random string
(`openssl rand -hex 32`). Unlike every other secret in this repo it **fails
closed** — see *Security*.

> `.env.example` was updated on disk and carries the full note, but it is
> matched by `.gitignore`'s `.env*` rule and has never been tracked in this
> repository (`git ls-files .env.example` → empty, since M-00). Widening that
> rule is a repo-wide change outside M-73's scope, so the **committed** source
> of truth for this variable is the environment-variable table in
> [`docs/LAUNCH-RUNBOOK.md`](../LAUNCH-RUNBOOK.md), where it is listed with its
> fail-closed behaviour and its rotation consequence. Flagged here rather than
> left to be discovered.

Rotation invalidates every existing `public_access_hash`; every shipment then
needs its access code re-issued by dispatch. Treat it as long-lived.

---

## Deployment

1. Apply `0020_shipment_tracking_access.sql`.
2. Set `TRACKING_ACCESS_SECRET` in Vercel (all environments).
3. Deploy. `/track` appears in the sitemap for all five locales; page count
   343 → **348**.

No `company_settings` key is added. No feature flag gates `/track` itself: with
`brokerage_active` false no shipment can exist, so the page honestly shows its
notice and every lookup honestly finds nothing.

---

## Tests

| Suite | Count | Was | New in M-73 |
|---|---|---|---|
| `npm test` | **437** | 353 | +84 across four files |
| `npm run test:rls` | **357** | 339 | +18 (suite §9) |
| `npm run test:integration` | **47** | 33 | +14 (§27 public lookup) |
| `npx playwright test` | **174** | 160 | +8 flow, +1 axe, +5 responsive |
| `npm run build` | **348 pages** | 343 | 5 locales of `/track` |

### What each lane proves

**`shipment-access-code.test.ts` (19)** — the hash is keyed (the same ZIP under
a different secret is a different digest); normalisation survives NBSP, en
dashes and paste whitespace; ZIP+4 resolves to the ZIP but a 9-character
alphanumeric code does not truncate; near-misses, prefixes, the decoy, a
malformed stored hash and a null hash all reject identically; everything fails
closed with no key.

**`shipment-public-lookup.test.ts` (19)** — **the DTO call-site proof M-70's
doc said its own suite could not give**: the route's output key set *equals*
`toPublicTrackingDto`'s and *does not equal* the row's, and a sentinel sweep
over the serialized payload finds none of `gross_shipper_amount`, `carrier_pay`,
`margin`, `delay_reason_internal`, `public_access_hash`, the street address or
the internal id. A structural scan of the module asserts `toPublicTrackingDto(`
is called and `...shipment`, `tracking: shipment`, `select("*")` and `: any`
are absent. Plus: the three refusals deep-equal; a malformed number never
queries the table but still reaches the ledger; both failure branches sit on
the response floor; the ledger row's key set is exactly six fields and contains
the secret in no form; a failed ledger write refuses a *correct* lookup.

**`shipment-public-tracking-ui.test.ts` (29)** — D-6 resolution across all four
branches; the library and catalogue proved not to have drifted; §8's nine
milestones and their four states, including that a delayed shipment keeps its
completed ticks and a cancelled one has no current step; the §23 text
equivalent as values; and a catalogue walk asserting **every** key the code can
generate (18 statuses, 20 event types, 13 exception types, 4 severities, 9
milestones, 29 phrases, 5 errors, 6 §30 labels) exists in **all five**
dictionaries.

**`tracking-result-a11y.test.tsx` (17)** — the result view rendered and
**axe-scanned** (wcag2a/2aa/21a/21aa/22aa) in four states: in transit,
exception, cancelled, and Spanish. Plus the semantics: `<ol>` with an
accessible name, nine items, five "Completed" + one "Current step" + three "Not
started" as *text*, `<time datetime>`, `role="status"` text equivalent, the
`<details>` support form with no `role="dialog"`, the `noindex` meta, D-6's
`lang="en"` free-text branch, and none of §4's forbidden values in the rendered
text.

**`tests/integration/public-tracking.test.ts` (14)** — the REAL
`lookupPublicTracking` against the REAL schema (0001…0020) through a
psql-backed PostgREST adapter: happy path returns the DTO with no financial
value from a row that genuinely has them; the `staff_only` event is proved
present in the table and absent from the timeline; ZIP+4 works; the three
refusals are byte-identical; the rate-limit trip lands a `rate_limited` row;
every outcome satisfies the real enum and CHECKs; and the submitted secret is
swept for across the entire ledger table and found zero times.

**`supabase/tests/20_rls_isolation.sql` §9 (18)** — the exact 8-column set;
anon, the owning shipper, the assigned carrier and a broker partner all read
nothing while staff read both rows (the non-vacuity control); no session can
INSERT, staff included; UPDATE/DELETE refused as the table owner with RLS
bypassed; the length CHECKs; and the service role appending successfully so the
refusals are not a missing grant.

**`tests/e2e/track.spec.ts` (8)** — §27's public-tracking flow: two required
factors, the number alone failing to submit at all, invalid access failing
safely with one message that names neither factor, malformed and unknown
producing the *same* text, neither factor reaching the URL, `/track` indexable
and in the sitemap for all five locales while the sitemap contains nothing
tracking-number-shaped, the §2 honest notice, and full keyboard reachability.

### Non-vacuity, by injection

Five assertions are proved capable of failing:

1. the DTO key-set assertion, run against a naive `{ ...row }` passthrough,
   **throws**;
2. the sentinel sweep, run against the same passthrough, **finds** `margin` and
   the internal delay note — the exact leak the real test denies;
3. the enumeration equality, run against a refusal carrying
   `reason: "bad_secondary"`, **throws**;
4. the catalogue walker, given a key that does not exist, **throws**;
5. the axe scanner, given `<img src="x.png">`, **reports** `image-alt`.

Plus the §30 copy scan, which is shown to find all three forbidden claims in a
deliberately over-claiming sentence.

### Honest limitations

* **The result page is axe-scanned in jsdom, not in a browser.** A live result
  needs a shipment in a database, and the e2e lane runs on placeholder
  credentials by design (M-41); seeding one would mean shipping a fabricated
  shipment, which §30 forbids. The scan uses the same axe-core 4.12 engine on
  the same component. What it cannot see is **colour contrast** (jsdom applies
  no stylesheet, so that rule reports "incomplete"): covered structurally
  instead — `.track-*` introduces no new colours, and the palette it draws from
  is scanned in a real browser on `/track` and sixteen other routes.
* **The rate limiter is stubbed in the integration lane.** The real one is
  Upstash Redis over the network. What is proved is the wiring — that the
  action passes the tighter limit, that a refusal stops the lookup, and that
  the trip reaches the ledger.
* **`shipment_exceptions` does not exist yet** (M-78). The lookup passes an
  empty exception list, which is the honest state: no banner rather than a
  banner with nothing behind it. The DTO and the UI already handle exceptions
  in full and are tested against them; wiring is one argument.
* **The timing floor flattens, it does not erase.** See *Security*, Attack 2.

---

## Files

**New:** `supabase/migrations/0020_shipment_tracking_access.sql` ·
`src/lib/shipments/access-code.ts` · `src/lib/shipments/public-lookup.ts` ·
`src/lib/shipments/phrases.ts` · `src/lib/shipments/public-timeline.ts` ·
`src/lib/shipments/public-tracking-state.ts` ·
`src/lib/validation/public-tracking.ts` · `src/app/actions/public-tracking.ts` ·
`src/app/actions/tracking-support.ts` ·
`src/app/[locale]/(site)/track/page.tsx` ·
`src/components/tracking/{TrackingLookup,TrackingResult,TrackingTimeline,TrackingSupportForm}.tsx`
· `src/components/tracking/format.ts` ·
`tests/unit/{shipment-access-code,shipment-public-lookup,shipment-public-tracking-ui}.test.ts`
· `tests/unit/tracking-result-a11y.test.tsx` ·
`tests/integration/public-tracking.test.ts` ·
`tests/integration/helpers/psql-supabase.ts` · `tests/e2e/track.spec.ts` ·
this doc.

**Changed:** `scripts/extract-i18n.mjs` (+ the `shipment` namespace, 176 keys) ·
`messages/{en,es,fr,ru,ht}.json` (regenerated) · `src/app/v4.css` (+`.sr-only`,
`.track-*`) · `src/lib/seo.ts` (`/track` in `PUBLIC_ROUTES`) ·
`src/lib/forms/guard.ts` (optional `limit` parameter — additive, every existing
caller unchanged) · `src/lib/supabase/database.types.ts` (0020 registered) ·
`tests/e2e/{axe,responsive}.spec.ts` · `supabase/tests/20_rls_isolation.sql`
(§9) · `package.json` (`axe-core` promoted from transitive to explicit
devDependency — same version, no new package in the tree, `npm audit`
unchanged) · `.env.example` · `docs/modules/INDEX.md` ·
`docs/LAUNCH-RUNBOOK.md`.

---

## Extension points

* **M-74** (shipper portal) reuses `shipment_tracking_access` for authenticated
  lookups — that is what `profile_id` is for. It reads the same
  `buildPublicTimeline`/`phrases` modules with `toShipperDto`; only the
  serializer changes.
* **M-75** (dispatcher) supplies the phrase PICKER: render `PUBLIC_PHRASE_IDS`,
  store `phraseToken(id)`. It also owns §15's "revoke public code" button —
  the mechanism (`public_tracking_enabled`, `public_access_hash = null`) and
  its refusal path already work and are tested. `hashSecondaryValue` is the
  function that sets a code.
* **M-76/M-80** consume `label.tracking_link_expired`, the one §30 label
  authored here without a call site.
* **M-78** passes real `shipment_exceptions` rows into
  `lookupPublicTracking`'s `exceptions` argument — one line — and the banner,
  the timeline exception state and the phrase library are already built for
  them.
* **M-80** flips `label.live_location_available` on for real by setting
  `tracking_mode` to `link`/`eld`; the branch already exists and is tested.
* **M-83** should reuse §9a's exact-column-set assertion pattern for the other
  credential-adjacent tables, and can lift the enumeration equality test as its
  §19 "prevents enumeration" proof.
* **M-84b** replaces the body of `logShipmentSignal` with a Sentry capture; the
  two signals this module emits (`public_tracking_failure`,
  `repeated_invalid_tracking_attempts`) need no call-site change.
* **Adding a phrase**: add it to `PUBLIC_PHRASES`, add
  `phrase.<id>` to `SHIPMENT` in `scripts/extract-i18n.mjs` with es/fr, run the
  generator. The drift test fails if you do one without the other.
