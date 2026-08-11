# M-76 — Carrier Update Experience + Driver Update Link

**Status:** ✅ Complete (validated on PostgreSQL 16) · **Phase:** B (tracking
core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-76 —
*"Carrier update experience (portal, permission-scoped transitions only) +
`/driver/update/[token]`: shipment-scoped, short-lived, revocable,
rate-limited, audit-logged, non-enumerable, consent-aware."*
Authority: `docs/DIRECTIVE-tracking.md` §§3, 9, 13, 19, 20, 22, 23, 24, 25, 26,
30.

Engine and event vocabulary: **M-72, called, never reimplemented.** DTOs and
enums: **M-70**. Schema: **M-71** (0017–0018), **M-72** (0019), **M-73**
(0020), **M-74** (0021), **M-75** (0022). Query idiom, filter builder,
pagination bound and timeline cursor: **M-74's, imported verbatim.** Access-gate
shape: **M-75's `resolveShipmentAccess`, mirrored — not copied.** One new
migration, **0023**.

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0023_driver_update_tokens.sql` | 1 enum, 2 tables, 6 indexes, 2 triggers, 3 policies, 4 `security definer` functions, and the repo's first **column-level privilege revoke** |
| `src/lib/shipments/driver-token.ts` | Minting, HMAC hashing, TTL, strict normalisation. `server-only` |
| `src/lib/shipments/driver-token-state.ts` | The pure half — `active`/`expired`/`revoked`, minutes remaining, the URL. A plain module, so client components share the rule |
| `src/lib/shipments/driver-access.ts` | Redemption, issuance, revocation, consent, the §13 rate-limit policy, the §26 signals |
| `src/lib/shipments/carrier-access.ts` | The §19 gate every carrier action passes through |
| `src/lib/shipments/carrier-shipments.ts` | The carrier's list, detail, timeline and driver-link reads — cookie-bound only |
| `src/lib/shipments/carrier-updates.ts` | **§13's action list as data**, the carrier-vs-driver matrix, the refusal vocabulary |
| `src/lib/validation/carrier-shipments.ts` | 8 Zod schemas whose key sets exclude every financial column |
| `src/app/actions/carrier-shipments.ts` | §13's **5 carrier actions** |
| `src/app/actions/driver-updates.ts` | §13's **4 driver actions** |
| `src/components/portal/CarrierShipmentListView.tsx` · `CarrierShipmentDetailView.tsx` | The carrier surface |
| `src/components/driver/DriverUpdateView.tsx` | The driver surface + §30's expired card |
| `src/app/[locale]/portal/carrier/shipments/{page,[shipmentId]/page}.tsx` | Two routes |
| `src/app/[locale]/driver/{layout,update/[token]/page}.tsx` | The chromeless driver route |

Changed in place: `src/lib/shipments/transitions.ts` (**one** actor-gate
widening, argued below) · `src/lib/shipments/eta.ts` (actor union widened to
§13's two new actors) · `src/lib/shipments/types.ts` (2 enums, 3 row types) ·
`src/lib/supabase/database.types.ts` (0023's 2 tables + 4 functions) ·
`src/app/actions/dispatcher-shipments.ts` (+2 driver-link actions — §13 permits
a dispatcher OR the carrier to issue) · `src/components/portal/ShipmentOpsForms.tsx`
+ `ShipmentStaffDetailView.tsx` + the admin detail route (the dispatcher's
driver-link block) · `src/components/portal/PortalSidebar.tsx` (one nav entry) ·
`src/app/v4.css` (the `.driver-*` block) · `src/app/robots.ts` (`/driver`
disallowed) · `scripts/extract-i18n.mjs` (**113 new keys × 5 locales**).

Migrations **0001–0004 remain frozen**; 0017–0022 are untouched.

---

## Why

### Why the driver link is an opaque random string with a server-side row

§13 gives the requirement in its own words: *"Do not expose internal shipment
IDs in predictable URLs."* That constrains the token's **construction**, not
merely its handling, and it rules out the obvious shape.

A **signed JWT** was considered and rejected on two counts. It would put the
shipment id inside the URL in a base64 segment anybody can decode — §13 says
"do not expose", not "do not expose in cleartext" — and it would make
revocation a denylist problem, when §13 asks for revocation outright. A **hash
of the shipment id plus a salt** fails the same way one step later: it is
derived, so it cannot be revoked without a row, and two links for the same
shipment would collide.

So: 32 CSPRNG bytes, base64url, derived from nothing.
`tests/unit/shipment-driver-token.test.ts` asserts that property directly —
across a thousand mints, no token contains any fragment of the shipment id, the
carrier id or the tracking number, and no two consecutive mints share a
six-character prefix. That is the difference between a property and an
intention.

### Why the token is stored as an HMAC, and why that buys less here than on `/track`

M-73's `access-code.ts` uses HMAC because a recipient ZIP has ~41 000 realistic
values, so `sha256(zip)` is a lookup table an attacker builds in a second. A
256-bit random token is not brute-forceable at all, so the keyed digest buys
something narrower — and it is worth saying which thing, rather than repeating
the earlier argument as though it transferred whole:

* a **database dump alone cannot verify** a token somebody separately obtained
  (a shoulder-surfed phone, a forwarded text, a proxy log), because computing
  the candidate digest needs `DRIVER_TOKEN_SECRET`;
* the storage format is **identical to the one already reviewed**, which is
  worth more than a marginally cheaper hash.

`hashDriverToken` returns **null** without the key rather than falling back to
an unkeyed digest, and `issueDriverToken` refuses to write. A credential module
fails closed; "we cannot verify" and "verified" are not the same sentence.

### Why `token_hash` is revoked at COLUMN level — the repo's first

M-71 recorded residual risk **R-1**: RLS is row-level, so every column of a row
a customer may read is in the payload. For an operational column that is a
documented risk. For a bearer credential it would be a mistake, so 0023 does
what no earlier migration needed to:

```sql
revoke all on shipment_driver_tokens from authenticated, anon;
grant select (…every column except token_hash…) on shipment_driver_tokens to authenticated;
```

Column privileges are checked **in addition** to RLS, and the order is
load-bearing: a table-level SELECT overrides a column-level revoke, so the
revoke has to come first. The result is that no browser-reachable role can name
`token_hash` in a select list **whatever policy is written later**. §12 of the
RLS suite asserts it as a catalog fact
(`has_column_privilege(... ) = false`), with `expires_at` asserted readable as
the non-vacuity control.

That gives the column **three independent guarantees**: the privilege above,
the `DriverTokenView` type (an `Omit`, so rendering it is a compile error), and
the projection string. M-71's R-1 does not apply to this table — which is the
one place in the schema where it would have mattered.

### Why redemption is one SQL function

§13 requires the driver path to be rate limited **and** audit logged **and** to
refuse expired and revoked tokens. Done in the application those are three
round trips with two race windows: two concurrent presentations both pass the
rate check, and a token revoked between the read and the ledger write is
recorded as granted.

`redeem_shipment_driver_token()` does the count, the lookup, the
expiry/revocation/carrier checks, the usage bump and the ledger insert in **one
statement**, so the record and the decision cannot disagree. It is M-72's
doctrine applied to a read: *the thing that must be atomic goes in SQL.*

It is also the only door — no other code path reads the token table by hash.

### Why the rate limit is the LEDGER and not Upstash

Every other public write in this repo rate-limits through `guardPublicForm` →
Upstash. The driver **page load** cannot, for two specific reasons:

1. It is a GET on a bearer credential, so the limit has to apply **before
   anything is read**.
2. §13 requires the same event to be **audit logged**. One write serving both
   requirements is the only way they cannot drift — a limiter in Redis and a
   ledger in Postgres will eventually disagree about what happened, and the
   disagreement will be discovered during an incident.

There is a third reason worth stating plainly: **the ledger limit works in
every environment.** `checkRateLimit` is a documented no-op without Upstash
credentials, which is fine for a lead form and is not fine for the enumeration
budget on a bearer credential.

The driver's **POSTs** still go through `guardPublicForm` (Upstash + Turnstile)
on top of it. That is not redundancy — the two cap different things: Upstash
caps POSTs per address, the ledger caps token **presentations** per address.
Neither substitutes for the other.

**Two counters, one window:**

| Limit | Value | Threat |
|---|---|---|
| failed presentations / IP / 10 min | **8** | enumeration. A driver with a working link produces zero |
| total presentations / IP / 10 min | **60** | flooding. Must clear the honest ceiling — a yard of drivers behind one carrier NAT, each reloading on bad signal |

A per-TOKEN limit is deliberately **not** added, for the reason M-73 records
against a per-tracking-number limit: it would let anyone holding the link lock
the driver out of their own updates. The compensating control for a leaked
token is short expiry plus revocation, not a lockout.

### The one actor-gate widening, and why the driver did not get it

§13's carrier list opens with **"confirm dispatch"** — the
`carrier_assigned → dispatched` edge. M-72 shipped `ACTOR_PERMITTED_TARGETS.carrier`
starting at `en_route_to_pickup`, so that action was unreachable. M-76 adds
`dispatched` to `carrier`: the reviewed diff M-72's own doc asks for, rather
than a carrier surface passing `actor: "dispatcher"`.

`driver` does **not** get it, and the asymmetry is the point of having two
actors at all. Confirming dispatch is a **carrier office** act — it asserts the
company has committed a truck to a load. The driver token is a bearer
credential in a truck (see the threat model below), and a driver who could
confirm dispatch could commit their employer to freight from a phone somebody
else is holding. Everything from `en_route_to_pickup` onward is identical for
both, because from there on they are reporting the same truck.

M-72's unit suite used to assert `driver` and `carrier` were **equal**. That
assertion is now the strict-subset one plus the single named difference, which
is **stronger**: an accidental widening of `driver` fails, and so does a second
divergence added without saying so.

### §13's words are not §6's statuses

Four of §13's phrases are not status names, and guessing would have produced a
surface offering illegal edges:

| §13 says | §6 status | why |
|---|---|---|
| "confirm dispatch" | `dispatched` | the carrier accepting the run |
| "loaded" | `loading` | the truck is under the freight; `picked_up` is when it leaves |
| "departed pickup" | `picked_up` | §6's `picked_up` **is** the departure milestone |
| "delivered" | `delivered` | reachable only via `unloading` |

**`unloading` is a twelfth action §13 does not name, and it has to exist.**
§6's graph routes `arrived_at_delivery → unloading → delivered`, so a surface
offering §13's "arrived at delivery" and §13's "delivered" with nothing between
them would offer an edge M-72 refuses. §13 says its list *"may include"*, so
adding the step the graph requires is completing the list, not widening it.

### Why the buttons are `offeredCarrierActions`, and why that is not enough

Both surfaces render `offeredCarrierActions(actor, status, facts)` — §13's list
intersected with M-72's graph, actor gate and preconditions — so a control the
engine would refuse is never drawn. That is M-72's own instruction to its
callers.

The server re-evaluates all of it, because **a hidden button is not a control**.
`tests/unit/carrier-shipment-actions.test.ts` enumerates both action modules'
exports and drives each through every refusal with `rpcCalls` and `writes`
asserted empty.

The refusal check runs **twice**, and the split matters: the fact-independent
refusals (`unknown_action`, `actor_not_permitted`, `terminal_status`) are
checked with no facts argument and therefore cost **zero database reads**. That
is what makes probing the transition graph through a leaked driver link cheap
for us and expensive for whoever is doing it.

### §9/§13 consent: gated location, never gated status

*"Driver consent must be considered for location tracking."* Three properties
make this consent rather than a setting:

* the column **defaults to `pending`** and the checkbox starts **unticked**, so
  nothing is granted by omission;
* `denied` is a **first-class, reversible** choice, not a synonym for "has not
  answered";
* a city/state supplied without consent is **refused**, not silently dropped —
  a location quietly discarded is a driver who believes dispatch knows where
  the truck is. The refusal is journalled as an `update_rejected` ledger row.

What is **not** gated is the driver's ability to report a **status**. That is a
fact about freight and §13's whole purpose; consent governs the location fields
beside it. The location fields are absent from the DOM until consent is
granted, and the server refuses them independently, because a hidden field is
not a control.

`TrackingConsentStatus` is **M-70's enum, created in SQL by 0017** — checked
before inventing one, and reused. `TrackingProviderConnectionRow` was the
nearest existing row type and was rejected with a reason recorded in
`types.ts`: it models a link a **provider gives us** (`tracking_url` points
outward, `last_polled_at` describes a poller), not a credential **we give a
driver**.

---

## The driver-token threat model

Stated honestly, because the compensating-control argument only works if the
threat is named first.

### Assume the token leaks. It will.

The link travels by SMS to a phone in a truck. Realistically it will end up in:
a forwarded text to a second driver; a screenshot in a WhatsApp group; a
carrier's dispatch spreadsheet; an SMS gateway's logs; a phone somebody sells;
a browser history on a shared cab tablet; a proxy log at a shipper's facility
wi-fi. **Any design whose security rests on the token staying secret is wrong.**

So the question is not "can it leak" but "what can the holder of a leaked link
actually do, for how long, and who finds out".

### What a leaked link grants

| Can | Cannot |
|---|---|
| See ONE shipment's tracking number, lane, appointments and equipment | See any rate, invoice, margin, shipper identity, reference or PO number |
| Report an operational status on that one shipment | Confirm dispatch, cancel, complete, accept a quote, correct a status |
| Report a city/state, **if consent was granted** | Read the timeline, the documents, the contacts or any other shipment |
| Update an ETA and open an exception on that shipment | Touch any other carrier's freight, or any other shipment of the same carrier |
| — | Learn any internal id: the shipment id is never rendered and the forms carry the token |

The blast radius is **one shipment's operational status**, for at most the
token's remaining life.

### The compensating control set

| Control | Value | What it costs an attacker |
|---|---|---|
| **Short expiry** | 24h default, 1–168h clamp | A link found in a forwarded text next week is dead |
| **Revocation** | one-way, one click, both surfaces | The carrier who realises kills it in seconds; un-revoking is refused by a trigger |
| **Carrier binding** | re-checked on every presentation | Reassigning the freight invalidates every old link automatically |
| **Rate limit** | 8 failures / 60 total per IP / 10 min | Guessing is pointless at 2^256; flooding is bounded |
| **Audit ledger** | every presentation, granted or not | Abuse is visible, countable and attributable to an IP and a user agent |
| **No financial data** | not a column in the redeem payload | The commercially valuable thing is not reachable at all |
| **Compare-and-swap** | M-72's | A stale link cannot overwrite a status somebody else moved |

### What is NOT mitigated, and is accepted

* **A leaked link can post a FALSE status for the life of the token.** A driver
  who forwards their link to a friend has delegated their reporting. This is
  the same trust model as handing somebody a phone, it is inherent to "no
  account required" (§13's own requirement), and the mitigation is
  *detectability* rather than prevention: every update carries
  `driver_token_id` in `metadata`, so "which link said that?" always has an
  answer, and a dispatcher who does not like the answer revokes it.
* **A shared IP shares a rate budget.** A yard behind one NAT can, in
  principle, exhaust the 60-presentation window. The failure mode is a driver
  told to wait ten minutes or call dispatch — chosen deliberately over a
  per-token limit, which would let an attacker lock a driver out of their own
  freight.
* **Consent is per LINK, not per person.** A re-issued link starts at
  `pending` again. That is the conservative direction: a driver who granted
  location sharing yesterday is asked again today rather than assumed.
* **The token is in the URL**, so it is in the browser's history and in any
  `Referer` a third-party asset would send. The page loads **no third-party
  asset** except Turnstile (Cloudflare, first-party to the security control),
  and carries `noindex, nofollow, nocache` plus a `robots.txt` disallow.
* **`DRIVER_TOKEN_SECRET` rotation invalidates every live link at once.** There
  is no dual-key verifier today. `DRIVER_TOKEN_HASH_VERSION` and 0023's
  `^v[0-9]+:` CHECK exist so a `v2:` writer can land beside a two-version
  verifier; until then, rotation is a deliberate mass revocation and the
  runbook says so.

### Why not require a second factor, like `/track` does

`/track` asks for a tracking number **and** a ZIP because a tracking number is
printed on paperwork and is not a secret. A driver token **is** a secret: 256
bits, unguessable, single-shipment, expiring. Adding a second factor would mean
asking a driver at a dock, one-handed, in gloves, to type something — and the
realistic outcome is that dispatch starts reading updates over the phone
instead, which is worse for everyone including the customer.

Turnstile is on the POSTs, which is where automation would attack.

---

## §22 — phone-first, argued rather than asserted

The driver page is not "responsive down to phone". It is designed **at** the
phone and allowed to grow.

* **One column at every width.** There is no multi-column arrangement, so there
  is nothing to reflow and no breakpoint that can be wrong. The shell stops
  growing at 560px and centres.
* **56px minimum on every interactive control** — a third above WCAG 2.5.8's
  44px floor, because the target is a gloved thumb on a cold morning.
* **The status choices are RADIO BUTTONS, not a `<select>`.** A native select
  on a phone opens a picker over the whole screen and needs two taps plus a
  confirm; a stack of big radios needs one, and shows every option without a
  gesture.
* **16px minimum font on inputs.** Below that iOS Safari zooms the viewport on
  focus, and the layout that fitted 320px no longer does — §22's *"no form
  controls outside viewport"*, caused by the browser rather than the CSS.
* **No `:hover` rule exists in the `.driver-*` block at all.** §22 forbids
  hover-only interactions; the strongest version of that is a stylesheet with
  no hover state to depend on. `:focus-visible` is styled instead.
* **No table.** The summary is a `<dl>`; the tracking number carries
  `overflow-wrap: anywhere`.
* **320px joined the responsive suite**, for every route rather than only this
  one. §22 names it first and the directive means it; it was absent from M-62's
  five viewports because no surface had been designed at it.

The carrier surface reuses the audited portal vocabulary (`.pcard`,
`.ptable--cards` with a `data-th` on every cell, `.psh-*`), so 320px works
because the shipped mechanism works.

**Zero new colour.** A unit test parses `v4.css`, extracts every hex in the
M-76 block and asserts each already appears earlier in the file.

---

## §23 accessibility

* `<fieldset>` + real `<legend>` per form; a `<label for>` on **every** control
  (asserted by walking the DOM);
* `role="alert"` on every refusal and `role="status"` on every confirmation, so
  a driver using VoiceOver **hears** the result rather than hunting for it;
* `aria-busy` while an action runs; `<time datetime>` on every instant;
* **state is text, never colour** — "Active" / "Expired" / "Revoked",
  "Sharing location" / "Not sharing location";
* the skip link is still first on the driver route, asserted in the browser;
* **axe-core in eight states** (carrier list, carrier detail, detail with no
  available actions, detail with a failed link read, driver page pending
  consent, driver page with consent granted, driver page on a terminal
  shipment, the expired card) — zero violations, with the scanner shown to
  report `image-alt` as the capability control. The driver page is
  **additionally** scanned in a real browser by the Playwright axe suite,
  because it needs no session — which is the one thing that makes its colour
  contrast covered rather than argued.

---

## §24 i18n — 113 keys × 5 locales

`en`/`es`/`fr` **authored**; `ru`/`ht` **mirror English and are flagged** for
native review in the runbook — the established M-42/M-55/M-69/M-73 precedent,
and the only alternative to the machine translation §24 forbids.

Declared in `scripts/extract-i18n.mjs`, not in `messages/*.json`, because those
five files are **build artifacts** the generator overwrites. Three branches:
`action.*` (§13's twelve actions plus M-77's two deferred ones), `consent.*`
(M-70's six `TrackingConsentStatus` values), `driver.*` (51) and `carrier.*`
(42).

**The server actions return message KEYS, not English sentences.** A refusal
from `driver-updates.ts` is `shipment.driver.expired_body`, resolved by the
component in the reader's language. An English string returned from a server
action would make every refusal English whatever the page's locale — M-73's
rule for `/track`, applied where it matters most.

---

## §30 — the label M-73 could not render

`docs/modules/M-73-public-tracking.md` recorded it plainly:

> `label.tracking_link_expired` is the one label with no honest call site in
> M-73 … It is authored in all five locales now because §30 names it … M-76/M-80
> consume it. Saying so is better than a fake trigger.

**This module is that call site.** `DriverLinkExpired` renders
`shipment.label.tracking_link_expired` as the page heading, and the e2e suite
asserts the exact string in all five locales against the running build.

It is the same card for **four** genuinely different causes — the token never
existed, expired, was revoked, or belongs to a carrier that no longer has the
freight. §13 requires the link to be non-enumerable, so those four must be
indistinguishable to whoever holds it, and the unit suite asserts **deep
equality** across the four action results. The distinction lives in
`shipment_driver_token_access`, where only staff can read it.

`rate_limited` and `unavailable` get their own wording because neither says
anything about any particular token: both are true for every input, including
inputs that do not exist, so neither is an oracle.

**BOL/POD upload is M-77's, and both surfaces say so** in the words a carrier
and a driver will read — not omitted, and not a button that does nothing. A
unit test asserts no action in `CARRIER_UPDATE_ACTIONS` claims to upload
anything and that the placeholder names the owning module.

---

## §26 observability

Five call sites, all through M-72's `logShipmentSignal` with no new signal
string, so **M-84b changes one function body and no call site**:

| Signal | Emitted when |
|---|---|
| `unauthorized_access_attempt` | a carrier session requests an unassigned shipment; a driver link is presented and refused; a redeemed link's update is rejected; the module is unconfigured |
| `repeated_invalid_tracking_attempts` | the driver-link rate limit trips — §26's named signal, on a different credential |
| `status_update_error` | issuance fails |
| `eta_calculation_failure` | the ETA path fails (M-75's mapping, unchanged) |

The **ledger** is where an operator counts them:
`idx_driver_token_access_ip` answers "is one network sweeping us?" and
`idx_driver_token_access_failures` is the feed M-84b will read.

§26's never-log list is honoured by construction: `logShipmentSignal` has no
parameter a token could arrive through, and its `detail` sweep already drops
strings containing `token=` or `access_token` whole.

---

## DB changes

### Migration 0023 — `0023_driver_update_tokens.sql`

**Creates:** enum `driver_token_outcome` (7 values); tables
`shipment_driver_tokens` (18 columns) and `shipment_driver_token_access`
(8 columns); indexes `idx_driver_tokens_shipment`, `idx_driver_tokens_carrier`,
`idx_driver_tokens_live` (partial), `idx_driver_token_access_ip`,
`idx_driver_token_access_shipment` (partial),
`idx_driver_token_access_failures` (partial); functions
`guard_driver_token_immutable()` + `trg_driver_tokens_immutable`,
`guard_driver_token_access_append_only()` +
`trg_driver_token_access_append_only`; RLS + 3 policies; the column-privilege
model; functions `issue_shipment_driver_token()`,
`revoke_shipment_driver_token()`, `redeem_shipment_driver_token()`,
`set_driver_token_consent()` — all `security definer`, EXECUTE to
`service_role` only after an explicit `revoke all … from public`.

**Creates nothing else.** No change to any existing table, column, policy,
trigger, enum or grant.

**ROLLBACK:**

```sql
drop policy if exists "staff manage driver token access" on shipment_driver_token_access;
drop policy if exists "staff manage driver tokens" on shipment_driver_tokens;
drop policy if exists "carrier member read driver tokens" on shipment_driver_tokens;
alter table shipment_driver_token_access disable row level security;
alter table shipment_driver_tokens       disable row level security;
drop function if exists public.set_driver_token_consent(text, boolean, text, text);
drop function if exists public.redeem_shipment_driver_token(text, text, text, integer, integer, integer);
drop function if exists public.revoke_shipment_driver_token(uuid, text, uuid, shipment_event_source);
drop function if exists public.issue_shipment_driver_token(uuid, uuid, text, timestamptz, uuid, text, text, uuid, text, shipment_event_source);
drop trigger if exists trg_driver_token_access_append_only on shipment_driver_token_access;
drop function if exists public.guard_driver_token_access_append_only();
drop trigger if exists trg_driver_tokens_immutable on shipment_driver_tokens;
drop function if exists public.guard_driver_token_immutable();
drop table if exists shipment_driver_token_access cascade;
drop table if exists shipment_driver_tokens cascade;
drop type if exists driver_token_outcome;
```

**DESTRUCTIVE** — drops every issued driver link and the entire record of who
presented one, which is the evidence §13's "audit logged" requirement exists to
produce. Take a dump first (`pg_dump -t shipment_driver_tokens -t
shipment_driver_token_access`). **Mind the order**: the append-only trigger goes
before its table, because `drop table` is DDL and does not fire it while any
attempt to clear rows first would.

Roll back `src/lib/supabase/database.types.ts` and delete
`src/lib/shipments/driver-*.ts` plus the `/driver/update/[token]` route in the
**same deploy**, or the route calls functions that no longer exist — which
fails **closed** (an unreachable redeem is an `unavailable` refusal, never an
unlogged grant), so the visible symptom is the honest "temporarily unavailable"
card.

**The carrier surface survives a 0023 rollback.** `/portal/carrier/shipments`
reads `shipments` and `shipment_events` only; deleting the driver-link block
from `CarrierShipmentDetailView` and the two actions from
`carrier-shipments.ts` leaves §13's status, ETA and exception updates working.
0017–0022 are untouched and need no rollback of their own; 0023 rolls back
**before** them and after nothing.

**The M-72 actor-gate widening is a separate, independent rollback.** Removing
`"dispatched"` from `ACTOR_PERMITTED_TARGETS.carrier` and reverting the two
unit assertions restores M-72's exact behaviour; §13's "confirm dispatch" then
stops being offered, which the surface handles (the button is drawn from
`availableTransitions`).

---

## Security review

### The policy and privilege matrix

| Table | staff | carrier member | shipper | broker | anon |
|---|---|---|---|---|---|
| `shipment_driver_tokens` | SELECT | SELECT own `carrier_id` | **none** | **none** | **none** |
| `shipment_driver_token_access` | SELECT | **none** | **none** | **none** | **none** |

| Privilege | authenticated | anon | service_role |
|---|---|---|---|
| `shipment_driver_tokens` SELECT (17 cols) | ✔ | ✖ | ✔ |
| `shipment_driver_tokens.token_hash` SELECT | **✖** | **✖** | ✔ |
| `shipment_driver_tokens` INSERT/UPDATE/DELETE | ✖ | ✖ | ✔ |
| `shipment_driver_token_access` SELECT | ✔ (policy → staff only) | ✖ | ✔ |
| `shipment_driver_token_access` write | ✖ | ✖ | ✔ |
| all four 0023 functions | ✖ 42501 | ✖ 42501 | ✔ |

Six decisions worth arguing:

* **The carrier read policy on `shipments` was NOT widened.** M-71's doc says
  it in those words. §12 of the RLS suite asserts `pg_policies.cmd = 'SELECT'`
  as a **catalog fact**, asserts that no non-staff policy on any of the four
  shipment tables is anything but SELECT, and asserts `shipments` still carries
  exactly four policies. A future `for all` fails a test rather than passing a
  review.
* **No anon policy, on a page anon reaches.** The driver route holds no anon
  key path at all: it reaches its shipment through `redeem_…` under the service
  role, exactly as `/track` does. §19's no-anon-SELECT rule is unbroken.
* **No write policy for anyone, staff included.** A staff session that could
  UPDATE the token table could extend an expiry with no event. Issue, revoke,
  redeem and consent are the four functions.
* **The ledger keeps a table-level SELECT for `authenticated`** because its
  policy is `is_staff()`; revoking the privilege outright would make that
  policy dead code and §15's "view access history" unimplementable. A carrier
  session reaching the table reads **zero rows** — a policy result, asserted —
  while anon cannot reach it at all.
* **A shipper and a broker partner read no driver link.** Which truck and which
  driver is carrier operational data, next to §12's "carrier's private packet"
  on the must-not-see list.
* **`issued_by_role` excludes `driver` by CHECK.** A driver cannot issue their
  own link, which is what stops a leaked link from minting a fresh one.

### Residual risks, stated plainly

**R-1 — a leaked link can post a false status for its remaining life.** Named,
argued and accepted in the threat model above. The mitigation is
detectability + revocation, not prevention. It is inherent to §13's own "no
full portal account required".

**R-2 — the driver page's §20 facts are approximated.** The page does not read
the event timeline (§13 grants a driver "limited status transitions" and no
history), so `pickup_confirmation_required` is inferred from the current status
rather than from the recorded arrival event. The consequence is bounded in one
direction only: the page can **over-offer**, never over-permit — the server
action re-resolves the real facts through `shipment_transition_facts()` before
writing, and the worst outcome is a control that returns a typed refusal into a
`role="alert"` region. Same trade, same mitigation, as M-75's R-4.

**R-3 — consent is asserted by whoever holds the link.** If the link has been
forwarded, the consent recorded is the forwardee's. This is the same trust
boundary as R-1 and cannot be closed without an account, which §13 forbids
requiring. It is bounded by what consent unlocks: two free-text fields the
driver types, not a device permission.

**R-4 — `DRIVER_TOKEN_SECRET` rotation is a mass revocation.** No dual-key
verifier exists. The version prefix and the CHECK make the successor possible;
the runbook records the consequence.

**R-5 (inherits M-71/M-72/M-75) — dispatcher scoping is query-level.** M-76 adds
no policy and does not widen the risk. `revokeDriverTokenAction` scopes its
token read by `shipment_id` through the cookie-bound client, so a dispatcher
cannot revoke a link on a shipment outside their scope; the underlying
`shipments` policy remains M-83's.

---

## §25 — what is bounded, and how it is proved

| Requirement | Implementation | Proof |
|---|---|---|
| server-side pagination | `pageRange` + `range()`, `MAX_PAGE_SIZE` **imported from M-74** so a second ceiling cannot exist | M-74's unit suite already asserts the ceiling; the carrier list uses the same builder |
| bounded reads | timeline 25+1 keyset, `DRIVER_TOKEN_LIMIT` 20 | unit + integration |
| indexed columns | `idx_shipments_carrier` (M-71, partial, written for this list), `idx_shipment_events_audience` (M-72), 0023's three | the predicates are exactly the shapes those indexes were written for |
| no N+1 | carrier detail is 3 fixed reads in one `Promise.all`; the admin detail went from 6 to 7 in the same `Promise.all`; the refusal path resolves facts **once** and hands them to the engine | the integration lane counts the RPCs |
| `?page=1e9` | `parsePage` clamps at 10 000 (M-74's) | unit |

The list projection names **no** financial column at all — not even
`carrier_pay`: a list renders a lane and a status, and a rate on a scrollable
board is a number somebody screenshots. The **detail** projection names
`carrier_pay` (their own contract, per M-70's DTO doc) and still omits
`gross_shipper_amount` and `margin`, so two of §18's three never enter process
memory on a carrier request.

---

## Endpoints

| Surface | Kind | Auth | Notes |
|---|---|---|---|
| `/{locale}/portal/carrier/shipments` | page (5 locales, `force-dynamic`) | carrier session | list, 4 filters, pagination |
| `/{locale}/portal/carrier/shipments/[shipmentId]` | page (dynamic) | carrier session, scoped | detail + §13's actions + driver links |
| `/{locale}/driver/update/[token]` | page (dynamic, `noindex`) | **none — a bearer token** | §13's driver surface |

**9 server actions** (5 carrier + 4 driver), plus **2** added to M-75's
dispatcher module. No route handler, no API addition.

## Env vars

**One new, and it is required for the feature to exist at all:**

| Variable | Required | Effect when unset |
|---|---|---|
| `DRIVER_TOKEN_SECRET` | for driver links | No link can be minted or verified. Both issuing surfaces render an honest notice instead of a form; the driver route renders "temporarily unavailable". **Fails closed** |
| `DRIVER_TOKEN_TTL_HOURS` | no (default 24) | Clamped to [1, 168] |

Generate with `openssl rand -base64 48`. Rotating it invalidates every live
link (R-4).

---

## Deployment

1. Apply `0023_driver_update_tokens.sql` after 0022. One enum, two empty
   tables, six indexes, two triggers, three policies, four functions and a
   grant model — milliseconds, no lock on any existing table, no backfill.
2. Set `DRIVER_TOKEN_SECRET` **before** deploying the app, or the surfaces ship
   with their honest "not configured" notice.
3. Deploy. Page count **363 → 368** (five locales of the carrier list; both
   detail routes are dynamic and prerender nothing).

Nothing operator-visible changes at the moment of deploy: `brokerage_active`
stays `false`, so no shipment exists to update and both carrier surfaces render
the honest gate notice. The carrier sidebar gains one entry.

Verify with the four commands CI uses:

```bash
npm test                 # 966 unit
npm run test:rls         # 447 assertions — rebuilds from 0001 → 0023 + seed + fixtures
npm run test:integration # 157 tests — rebuilds from 0001 → 0023 + seed
npx playwright test      # 229 chromium
```

---

## Tests

| Suite | Count | Was | New in M-76 |
|---|---|---|---|
| `npm test` | **966** | 815* | **+151** across four files |
| `npm run test:rls` | **447** | 397 | **+50** (suite §12) |
| `npm run test:integration` | **157** | 128 | **+29** |
| `npx playwright test` | **229** | 187 | **+42** |
| `npm run build` | **368 pages** | 363 | 5 locales × 1 route |

\* 799 at M-75's HEAD; 815 after M-76's edits to two existing suites (the
dispatcher action suite discovers exports, so the two new driver-link actions
added 14 assertions to it automatically).

### What each lane proves

**`shipment-driver-token.test.ts` (22)** — 43-character base64url shape, 1000
distinct mints, the §13 **non-enumerability property asserted directly** (no
token contains any fragment of the shipment id, carrier id or tracking number
across 1000 mints; no two consecutive mints share a 6-char prefix); the storage
format against **0023's own CHECK regex**; determinism under one key and
divergence under another; fail-closed minting and hashing; strict normalisation
accepting a percent-encoded paste and refusing ten near-misses; constant-time
verification refusing a malformed, absent or `v2:` stored hash; a mask that
contains **no 4-character substring** of the token; the TTL default, the clamp
in both directions and the expiry instant; `expired` at the **inclusive**
boundary so TypeScript and 0023's `<=` agree; and revocation outranking expiry
with zero minutes remaining.

**`carrier-driver-updates.test.ts` (20)** — §13's list item by item including
the four phrases that are not statuses; `unloading` present and justified
against the graph; no action claiming to upload; every label key resolving in
**all five catalogues**; the driver's strict subset with `confirm_dispatch` as
the single named difference, enforced **independently** in this module and in
M-72's actor gate; neither actor reaching cancel/complete/accept/assign/POD from
**any** status, with staff proved to keep them as the non-vacuity control; and
the **full cross product** — 12 actions × 18 statuses × 2 actors compared
against `availableTransitions`, asserting the complement (>300 withheld) as well
as the positives.

**`carrier-shipment-actions.test.ts` (72)** — both action modules' exports
**discovered, not listed**, each driven through every refusal (no session ·
shipper session · staff session · suspended · no carrier record · another
carrier's shipment · malformed id) with `rpcCalls` and `writes` asserted empty,
plus an in-scope control proving none refuses when it should not. Then the
contract: a status update issues exactly `[facts, transition]` and no raw
`shipments` write; a stale page is refused **before** the engine; `PL409`
renders as "refresh"; a POST carrying **every** `CARRIER_FORBIDDEN_FIELD`
changes nothing but the transition; revoking a link on another shipment is
refused; the four driver refusals are **deeply equal**; `confirm_dispatch` from
a driver link is refused, journalled and never reaches the engine; and consent
gates location in four states (pending refuses, denied refuses, absent location
succeeds, granted succeeds) while never gating status.

**`carrier-driver-a11y.test.tsx` (37)** — axe in eight states plus the scanner
capability control; §30's label rendered **in five locales**; the three words
that do appear (`gps`, `invoice`, `margin`) asserted to sit only inside an
explicit denial, sentence by sentence, rather than banned outright — a blanket
ban would have forced the honest sentences out; no currency figure and no
internal shipment id anywhere in the driver DOM, **including hidden fields**;
radios not a select, with exactly the offered ids; location fields absent until
consent and present after; the consent box unticked; a `<label for>` on every
control and a `<legend>` on every fieldset; `data-th` on every body cell matched
against its header; `<time datetime>` everywhere; link state as text; a revoke
control only on a live link; no `v1:` anywhere; and the stylesheet's own
guarantees parsed out of `v4.css` — 56px minimums, 16px inputs, **zero**
`:hover`, `:focus-visible` present, reduced motion, and no new colour.

**`tests/integration/carrier-driver-updates.test.ts` (29)** — the REAL exported
code from `src/` (the §13 list, the transition engine, the token hasher, the
rate-limit constants) against the REAL schema `0001…0023` on local PG16, through
the REAL 0019/0022/0023 functions. §27's carrier flow end to end (confirm
dispatch → en route → arrived → loaded → departed → in transit → arrived at
delivery → unloading → delivered), with every event landing at the `carrier`
band; the closing actions refused in **both** layers; `confirm_dispatch` offered
to a carrier and refused to a driver on a real write. Then §13's isolation
(issuing for the wrong carrier `PL422`, another carrier's driver `PL422`, no
carrier at all `PL422`, and a link that **stops working** when the freight is
reassigned), the immutability trigger refusing to re-point shipment/carrier/hash
as the table **owner**, expiry and one-way revocation with idempotent
re-revocation, the refusal payload proved to carry **only** `{outcome}`, the
rate limit tripping on failures and on a flood with a different-network control
and a **window** control (an hour-old burst ignored; the same rows inside a
120-minute window refused), one ledger row per presentation, `use_count` bumped
only on a grant, the ledger append-only for the owner, its exact column list,
the issue and revocation landing on the timeline at the `carrier` band and
**not** the public or shipper band, the consent lifecycle
(pending → granted → no-op re-grant → denied, refused on a revoked link), the
redeem payload proved to leak **no** financial value on a shipment that really
has them, and §2's gate proved not to strand in-flight freight.

**`supabase/tests/20_rls_isolation.sql` §12 (+50)** — the carrier policy proved
un-widened as a catalog fact; `token_hash` unreadable by `authenticated` and
`anon` with `expires_at` as the control; no browser write privilege on either
table; both exact column lists; carrier A reading its own three links (active +
revoked + expired, so the count is a policy statement) and **none** of carrier
B's; a carrier **member** getting the same view as the owner; shipper, broker,
outsider and anon reading nothing; staff reading all four and the whole ledger
as the non-vacuity control; staff unable to edit a link directly; all four
functions refused `42501` to an **admin** session and to anon, with the grant
model read out of `pg_proc`; and, as the table **owner**, the immutability
trigger, one-way revocation, the append-only ledger, the `token_hash` format
CHECK, its unique index, the `issued_by_role` CHECK refusing `driver`, the
`expires_at > issued_at` CHECK, the consent-timestamp CHECK, and the
`pending` default read out of `information_schema`.

**`tests/e2e/carrier-driver-updates.spec.ts` (14)** — both carrier routes and a
malformed id bounce to `/login`; none of five query parameters is a second door;
all five locales gate identically; a bare POST leaks no tracking number and no
`carrier_pay`; the driver route renders §30's label with a `tel:` escape;
**four differently-malformed tokens produce byte-identical pages** to a
well-formed one; no shipment, money or internal id in the DOM; `noindex,
nofollow` plus no site nav, no footer and the skip link still first;
`/driver` disallowed in `robots.txt` and absent from the sitemap; the refusal in
five locales; and, at **320px**, zero horizontal overflow with a call button
over 44px tall.

Plus `axe.spec.ts` scans the driver route in a real browser, and
`responsive.spec.ts` measures it at **six** viewports (320px is new, for every
route).

### Non-vacuity — proven by injection, not asserted

Five defects were injected one at a time and the suites re-run; each failed
loudly, then the tree was restored and every lane returned to green.

| Injected defect | Suite | Assertion that caught it |
|---|---|---|
| `"carrier member read driver tokens"` widened to `using (true)` | RLS | *carrier A reads its OWN three driver links* — expected 3, got 4 |
| `grant select (token_hash)` added back to `authenticated` | RLS | *authenticated CANNOT select shipment_driver_tokens.token_hash* |
| `"dispatched"` added to `ACTOR_PERMITTED_TARGETS.driver` | **unit ×2 files** | M-72's own strict-subset test **and** M-76's *CONFIRM DISPATCH is carrier-only in BOTH layers* — with no database |
| consent gate removed from `driverStatusUpdateAction` | unit ×2 | *REFUSES a city/state supplied without consent* and *refuses a location under `denied` too* |
| `redeem_…`'s revocation check removed | integration ×3 | *REFUSES a revoked link*, *REVOKED outranks EXPIRED*, and *`use_count` bumps only on a grant* |

The third row is worth reading twice, because what it caught is **not** what
it broke. Widening M-72's actor gate did NOT make the action test's
`confirm_dispatch` refusal fail — `carrier-updates.ts`'s own §13 list is an
independent second barrier and still refused it. What failed were the two
assertions whose whole job is to compare the layers. That is defence in depth
working, and it is why both assertions exist: a single-layer test would have
reported the widening as harmless.

**Two real defects the lanes caught before ship**, both worth recording:

1. **The refusal pre-check refused every legitimate "delivered".**
   `refuseCarrierAction` was called with the raw facts, whose
   `deliveryTimestamp` is null — but §20's `delivery_timestamp_required` is a
   property of the assertion being made, and `applyShipmentTransition` merges
   the event time before judging. The pre-check therefore refused a transition
   the engine would have accepted. The integration lane's §27 walk failed on
   the last step; the fix merges the same timestamp in both places, in both
   action modules.
2. **A cross-file flake in the shared integration database.** M-75 asserts that
   a hostile search value (`' or 1=1 --` → `ilike 'PL%11'`) finds nothing;
   M-76's ~25 shipments used random tracking numbers, so roughly one run in
   five had a number legitimately ending in `11`. Fixed on both sides: M-76's
   numbers are deterministic in a `076xxx` band that skips `…11`, and M-75's
   assertion now compares against `ilike 'PL%'` — a statement about the
   **parser** rather than about the fixture population, which is what it was
   always meant to be.

### Honest limitations

- **The carrier routes are axe-scanned in jsdom, not in a browser.** They sit
  behind a Supabase carrier session and the e2e lane runs on placeholder
  credentials by design (M-41). The scan uses the same axe-core 4.12 engine on
  the same components; what it cannot see is colour contrast, covered
  structurally by the no-new-colour assertion and by the fact that the
  components reuse `portal.css`'s audited vocabulary. The e2e lane asserts the
  session gate, so the limitation is **proved** rather than assumed. The
  **driver** page has no such limitation — it is scanned in the browser.
- **The e2e lane can only reach the driver page's REFUSAL.** A grant needs a
  database. The granted state is axe-scanned in jsdom and exercised end to end
  in the integration lane; seeding a fabricated shipment into the product to
  make the browser reach it is what §30 forbids next to fake GPS.
- **`resolveCarrierShipmentAccess` is proved against a stubbed client.** It
  proves the layer — a refusal before any write, for every action. That the SQL
  underneath is right is the RLS suite's and the integration lane's job.
- **Nothing here uploads a document.** BOL and POD are M-77's, and both
  surfaces say so.
- **The driver page shows no map and no timeline.** §13 grants a driver limited
  transitions, not history; a map is M-80's and would need location data this
  page deliberately does not read.

---

## Files

**New:** `supabase/migrations/0023_driver_update_tokens.sql` ·
`src/lib/shipments/{driver-token,driver-token-state,driver-access,carrier-access,carrier-shipments,carrier-updates}.ts`
· `src/lib/validation/carrier-shipments.ts` ·
`src/app/actions/{carrier-shipments,driver-updates}.ts` ·
`src/components/portal/{CarrierShipmentListView,CarrierShipmentDetailView}.tsx`
· `src/components/driver/DriverUpdateView.tsx` ·
`src/app/[locale]/portal/carrier/shipments/page.tsx` ·
`src/app/[locale]/portal/carrier/shipments/[shipmentId]/page.tsx` ·
`src/app/[locale]/driver/layout.tsx` ·
`src/app/[locale]/driver/update/[token]/page.tsx` ·
`tests/unit/{shipment-driver-token,carrier-driver-updates,carrier-shipment-actions}.test.ts`
· `tests/unit/carrier-driver-a11y.test.tsx` ·
`tests/integration/carrier-driver-updates.test.ts` ·
`tests/e2e/carrier-driver-updates.spec.ts` · this doc.

**Changed:** `src/lib/shipments/{transitions,eta,types}.ts` ·
`src/lib/supabase/database.types.ts` ·
`src/app/actions/dispatcher-shipments.ts` ·
`src/components/portal/{ShipmentOpsForms,ShipmentStaffDetailView,PortalSidebar}.tsx`
· `src/app/[locale]/portal/admin/shipments/[shipmentId]/page.tsx` ·
`src/app/v4.css` · `src/app/robots.ts` · `scripts/extract-i18n.mjs` ·
`messages/*.json` (generated) · `supabase/tests/{10_fixtures,20_rls_isolation}.sql`
· `tests/unit/{shipment-transitions,dispatcher-shipment-actions,dispatcher-shipments-a11y}.test.ts`
· `tests/integration/{dispatcher-operations,shipper-shipments}.test.ts` ·
`tests/e2e/{axe,responsive}.spec.ts` · `docs/modules/INDEX.md` ·
`docs/LAUNCH-RUNBOOK.md`.

---

## Extension points

- **M-77** (documents) replaces `DEFERRED_CARRIER_ACTIONS` with real upload
  actions on both surfaces and completes `approved_pod_required` by replacing
  one literal in `shipment_transition_facts()` (the expression is in 0019's
  comment). Adding `pod_uploaded` to `ACTOR_PERMITTED_TARGETS.carrier` is the
  diff that would let a carrier close it out, and it should **not** be made
  until document approval is a real state.
- **M-78** (exceptions) backfills from the events this module writes: every
  carrier- and driver-reported exception carries
  `metadata.exception_source = "m76_carrier_report"` or `"m76_driver_report"`
  plus `reported_by`, alongside M-75's `m75_event_only` marker. Severity is
  fixed at `medium` here because §21 makes triage an operational decision; M-78
  owns the triage surface.
- **M-79** (notifications) can notify a shipper when a driver reports a
  milestone: the events already exist, carry `driver_token_id`, and are at the
  `carrier` band, so publishing a customer-facing sentence is a dispatcher act
  through M-75's phrase picker — **not** a translation of the driver's note
  (D-6).
- **M-80** (providers) is where `TrackingProviderConnectionRow.consent_status`
  becomes the second consent surface. The two are deliberately separate: this
  one is a driver typing a city, that one is a provider streaming a position,
  and a single flag covering both would let one grant authorise the other.
- **M-83** inherits R-5 unchanged and can lift §12's column-privilege assertion
  shape for any other credential column it audits — it is the strongest
  guarantee in the schema and applies wherever a secret shares a row with
  readable data.
- **M-83b** extends `tests/integration/`; the **carrier update** test is now the
  eighth of §27's eleven named tests proved end to end.
- **M-84b** replaces `logShipmentSignal`'s body. Every M-76 failure path already
  emits one of §26's nine signals with no call-site change needed.
- **Shortening the TTL** is `DRIVER_TOKEN_TTL_HOURS`, clamped and documented.
  **Adding a dual-key verifier** (R-4) is a `v2:` writer plus a two-version
  `parseStoredDigest`; the column CHECK already accepts it.
