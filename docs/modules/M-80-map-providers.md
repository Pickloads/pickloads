# M-80 — Tracking Map and Provider-Adapter Architecture

**Status:** ✅ Complete · **Phase:** C (tracking completion) · **Date:** 2026-08-06

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase C module table, row M-80 —
*"Map + provider adapter interface (Motive/Samsara/Geotab/Verizon shapes, no
fake connection), `tracking_provider_connections`, 4 privacy visibility levels,
per-shipment tracking links, lazy-loaded map, accessible alternative"* — plus
the three §9 items plan §4 restores: Mode B's **`tracking_url`**, Mode C's
**vehicle speed + raw provider metadata**, and the **location-history retention
EXECUTOR**, recorded there as *"a policy with no purger"*.

Authority: `docs/DIRECTIVE-tracking.md` §9 (the spec), §10, §15, §19, §23, §25,
§26, §30.

Migration **0027**. 0001–0004 frozen and untouched; 0005–0026 untouched
entirely.

---

## NO PROVIDER IS CONNECTED

Stated first because everything else in this module is shaped by it.

**PickLoads holds no telematics contract, no Motive/Samsara/Geotab/Verizon
Connect API credentials, and no ELD consent from any carrier. Nothing in this
module opens a socket to any provider. `tracking_provider_connections` holds
zero rows in every environment. No shipment has a disclosed coordinate, so the
map component never mounts, and every customer-facing surface renders §30's
"Milestone tracking".**

§9 says *"do not implement a fake connection"* and §30 says *"do not display
fake GPS positions"*. What ships instead is the **interface** those sentences
ask for, built so that adding a real provider later is one file rather than a
rewrite — and an honest refusal from every named adapter, typed so an operator
can tell "nobody configured anything" from "credentials exist but no transport
is implemented".

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0027_shipment_locations_providers.sql` | 2 tables, 6 indexes (2 partial-unique), 4 triggers, 6 `security definer` functions, 1 `company_settings` key. |
| `src/lib/shipments/providers/types.ts` | The §9 Mode C adapter interface — 7 named responsibilities, a closed `ProviderErrorCode` union, `NormalizedReading`, `EtaInputs`. |
| `src/lib/shipments/providers/normalize.ts` | Total, defensive normalisation primitives (coordinates, speed, heading, km/h→mph, state codes, three timestamp encodings) bounded to 0027's own CHECKs. |
| `src/lib/shipments/providers/base.ts` | `createAdapter` — `isConfigured()` over env vars, the shared typed refusal, `dedupeKey` namespaced by provider. |
| `…/motive.ts` · `…/samsara.ts` · `…/geotab.ts` · `…/verizon-connect.ts` · `…/other.ts` | One file per §9 vendor. `normalize()` implemented for real against each vendor's documented payload shape. |
| `src/lib/shipments/providers/index.ts` | `PROVIDER_ADAPTERS` as a full `Record<TrackingProvider, …>`, `providerStatuses()`, `anyProviderConfigured()`. |
| `src/lib/shipments/retention.ts` | §9's window arithmetic — `resolveRetentionDays`, `retentionExpiresAt`, `isRetentionExpired`. Pure. |
| `src/lib/shipments/location-visibility.ts` | The WRITE side of §9's four levels: rank, direction rule, refusal messages, operator copy. Pure. |
| `src/lib/shipments/map-state.ts` | §30's three labels and `mapMayMount`. Pure. |
| `src/lib/shipments/locations.ts` | Reads per audience, the four service-role writes, the retention purge caller, the poll orchestrator. |
| `src/components/tracking/ShipmentMap.tsx` | The map. Inline SVG, zero network requests, `role="img"` with a real name and description. |
| `src/components/tracking/LocationPanel.tsx` | §11's slot: §30's label, the current place, the lazy map, and §23's **visible text equivalent**. |
| `src/components/portal/ShipmentOpsForms.tsx` | +3 dispatcher forms (visibility, attach link, revoke link). |
| `src/app/actions/dispatcher-shipments.ts` | +3 server actions, each through the same `resolveShipmentAccess` gate as the eighteen before them. |
| `src/lib/shipments/dto.ts` | `CustomerLocationDto` / `StaffLocationDto` + `locations` on all five serializers. |
| `src/app/api/cron/daily/route.ts` | Task 3 — the retention purge. |

Tests: `tests/unit/shipment-providers.test.ts` (54) ·
`tests/unit/shipment-retention.test.ts` (23) ·
`tests/unit/shipment-location-visibility.test.ts` (28) ·
`tests/unit/shipment-map-a11y.test.tsx` (30) ·
`tests/integration/shipment-locations.test.ts` (32) ·
`tests/e2e/shipment-map.spec.ts` (6) · +83 RLS assertions.

---

## Why

### Why a second location table when `shipment_events` already has city/state

Because §9 requires location-history retention to be **configurable**, and
0019's `trg_shipment_events_append_only` refuses DELETE for every role
*including the table owner*. A retention window over a ledger nobody can delete
from is not a retention window; it is a sentence in a document. That is exactly
the defect plan §4 named.

So the position series gets its own table — deletable by the purger and by
nothing else — and the ledger keeps what a ledger is for.

Two consequences, both deliberate:

- **`shipment_events` now REFUSES coordinates** (`trg_shipment_events_no_coordinates`,
  PL422). 0019 created `latitude`/`longitude` columns that no code path in
  `src/` has ever written (verified by grep before this migration was
  authored), so refusing them now breaks nothing and closes the hole
  permanently. City and state are untouched: a place is not a position, and
  §9 Mode A is built on them.
- **`trg_shipment_events_location_mirror`** writes a `shipment_locations` row
  whenever an event carries a city or a state. Mode A — the only mode required
  for launch — therefore produces real location history with **no call-site
  change anywhere in `src/`**. That is 0026's harvest doctrine applied to
  locations: a producer cannot forget to call a helper that nobody calls.

### Why the adapter interface is the deliverable, and what in it is real

§9 names seven responsibilities. Five are transport and are honestly
unimplemented. **`normalize` is not**, and it is the one that decides whether
adding a provider later is a wiring job or a rewrite: the shipment system
consumes `NormalizedReading` and knows nothing about anybody's JSON.

The per-vendor normalisers are written against each vendor's documented shape,
and the differences between them are the argument for one file per provider
rather than a generic adapter with a shape argument:

- **Geotab reports `speed` in KILOMETRES PER HOUR.** A generic "read `speed`"
  adapter puts a truck at 105 mph on a 105 km/h motorway — a wrong number
  presented as a real one, which is the §30 failure mode.
- **Verizon Connect's `updateUtc` carries no zone designator.** `Date.parse`
  reads it as server-local, so a naive adapter puts the truck four hours out
  depending on where the container runs.
- **Samsara's only city is `reverseGeo.formattedLocation`** — `"Richmond, VA"`
  — which stored whole renders as `"Richmond, VA, VA"`.

Each of those is one test in `tests/unit/shipment-providers.test.ts`.

### Why the refusal is typed, and why `not_implemented` exists

`not_configured` (no env vars) and `not_implemented` (env vars present, no
transport) are different operational facts. The second one closes a real trap:
an operator sets `MOTIVE_API_KEY` in Vercel, expects tracking to start working,
and it does not. A system that returned `null` there would look like an outage;
this one says in words that the integration is half-built.

### Why `other` can never be configured

`requiredEnvVars` is empty, so `isConfigured()` is permanently false. `other`
is the value the mirror trigger writes when an `eld`/`gps` event arrives whose
vendor the ledger did not record — a **provenance label, not a vendor**. Giving
it credentials would let an unnamed provider be switched on from the
environment, which is the opposite of §15's "approved providers".

---

## The adapter contract table

| Provider | Env vars a real integration needs (§15) | Credentials today | Connection today | `normalize()` | Units |
|---|---|---|---|---|---|
| **Motive** | `MOTIVE_API_KEY` | Not configured | **Not connected** | ✅ real | imperial (`speed` = mph) |
| **Samsara** | `SAMSARA_API_TOKEN` | Not configured | **Not connected** | ✅ real | `speedMilesPerHour` |
| **Geotab** | `GEOTAB_DATABASE`, `GEOTAB_USERNAME`, `GEOTAB_PASSWORD` | Not configured | **Not connected** | ✅ real | **km/h → mph** |
| **Verizon Connect** | `VERIZON_CONNECT_APP_ID`, `VERIZON_CONNECT_USERNAME`, `VERIZON_CONNECT_PASSWORD` | Not configured | **Not connected** | ✅ real | mph; **zone-less UTC** |
| **Other approved** | *(none — deliberately unconfigurable)* | n/a | **Not connected** | ✅ real | flat, explicit shape |

| Interface member | §9 responsibility | State |
|---|---|---|
| `fetchCurrentLocation` | fetch current vehicle location | refuses (`not_configured` / `not_implemented`) |
| `fetchLastUpdateAt` | fetch last update time | refuses |
| `fetchVehicleSpeed` | fetch vehicle speed, if permitted | refuses |
| `fetchEtaInputs` | fetch ETA inputs | refuses — and returns **inputs**, never a provider ETA claim |
| `normalize` | normalize provider data | **implemented, per vendor** |
| `NormalizedReading.raw` → `shipment_locations.raw_metadata` | store raw provider event metadata securely | **implemented** — staff-only at the table, in **no DTO at any audience** |
| `dedupeKey` → `(shipment_id, provider, external_event_id)` unique index | prevent duplicate events | **implemented**, enforced by the database |

The dispatcher shipment page renders the first table live, from
`providerStatuses()`, so an operator sees the same statement the doc makes.

---

## The four privacy levels, end to end

M-70 shipped the **read** side and closed its doc with *"M-80 decides per-event
coordinate disclosure."* Both halves are now done.

### Read (M-70's resolver, extended to the series)

| Level | public | shipper / carrier / broker | staff |
|---|---|---|---|
| `exact` | city/state only | coordinates + speed | everything |
| `approximate` | city/state | city/state | everything |
| `milestone_only` | nothing | nothing | everything |
| `hidden` | nothing | nothing | everything |

The public cap at `exact` is §9 verbatim: *"do not permanently expose exact
real-time truck position to every public visitor."* A public visitor holds a
tracking number and a ZIP, not an account.

`hidden` and `milestone_only` are **rendered identically** to "no readings
yet". A panel that said "the shipper hid this" would turn the privacy setting
into a signal, which is the same reason M-70's DTO nulls values rather than
removing keys.

**Vehicle speed is a separate permission.** §9 says *"fetch vehicle speed, **if
permitted**"*, so speed requires `exact` **and** a provider connection whose
`consent_status = 'granted'`. Revoking consent withholds the speed while the
position stays — asserted from both directions in the RLS and integration
lanes.

### Write (new)

**Narrowing is a dispatcher action; widening is an admin action.** Ranked
`hidden` 0 → `milestone_only` 1 → `approximate` 2 → `exact` 3.

§15 puts *"control public tracking visibility"* on the admin list and §14's
dispatcher list does not mention it at all. Read literally that would leave a
dispatcher unable to turn a map **off** when a shipper phones and asks — making
the privacy-*increasing* action the slow one, which is backwards. So the rule
is directional rather than role-flat.

Three layers, and they are not redundant: Zod (is it one of the four?) →
`mayChangeLocationVisibility` (the direction rule, for the **message**) →
0027's `set_shipment_location_visibility()` (the same rank comparison, and the
**authority** — PL403). The unit suite reads the rank map out of the SQL and
asserts it equals the TypeScript one, so the two cannot drift.

The default is `approximate` (0017's column default, chosen by M-71 for the
same privacy-first reason), so the untouched state of every shipment is
city/state and never coordinates.

Every change writes a `staff_only` `shipment_events` row **and** an
`audit_events` row through the M-69 single writer: §15's *"audit who changed
each status"*, extended to who changed how much of the truck a customer can
see.

### The coordinate-disclosure decision M-70 deferred

**Customer event DTOs still carry no latitude or longitude.** Positions reach
customers through the separate location series instead. Three reasons, in order
of weight:

1. **Retention.** §9 requires configurable retention; 0019's ledger cannot be
   deleted from. Coordinates in the timeline would make the retention window a
   claim about one table while the same position sat permanently in another.
   0027 goes further and refuses coordinates on `shipment_events` outright, so
   the two cannot drift back together by accident.
2. **Orthogonal controls.** An event's `visibility` band classifies its
   *content*; §9's level classifies *precision*, per shipment. Multiplying them
   inside one DTO forces every future event type to re-decide privacy; keeping
   them apart means a new event type inherits the band rules and nothing else.
3. **§9's public sentence**, above.

`raw_metadata` goes further still: **no serializer emits it, staff included** —
the same treatment M-70 gives `public_access_hash`. §9 says to store raw
provider metadata *securely*, and the securest handling of a third party's
payload is that it never enters a page request. It is readable by a staff
session directly against the table when somebody is debugging an integration,
which is the only time anybody needs it.

---

## The retention executor (the restored requirement)

Plan §4: §9's retention *"was a policy with no purger"*.

`purge_expired_shipment_locations(p_retention_days, p_limit)` — `security
definer`, EXECUTE to `service_role` alone, called nightly by
`/api/cron/daily` (task 3).

**Two predicates**, and the second is the important one:

- `retention_expires_at <= now()` — the stamp the row was written with;
- `recorded_at < now() - window` — the **current** window, applied to
  everything including rows stamped under a longer one.

So **shortening the window takes effect immediately**, which is the direction
that matters for a privacy control, while lengthening it does not resurrect
what the first predicate already expired.

**Fails safe, not open.** A missing key, an unparseable value, a negative or an
absurd one all resolve to 90 days — never to "keep forever". A retention
executor that quietly stops deleting because somebody typed `"ninety"` into a
settings box has become the policy-with-no-purger again, and it would look
healthy while doing it. The ladder exists twice (`location_retention_days()` in
SQL, `resolveRetentionDays` in TypeScript) and the unit suite pins them against
each other.

**Bounded per call** (`for update skip locked`, default 50 000), so one nightly
run cannot lock the table on a backlog; `more_remaining` in the response says
when a backlog is draining.

The window is a `company_settings` key — `location_retention_days`, seeded at
90 — not an environment variable, because §15 puts *"manage retention
settings"* under admin management and the M-24 settings editor is where an
admin already changes company-wide policy without a deploy.

**Proved by deletion**, not by inspection: the RLS suite and the integration
lane each write an aged row, run the purge, assert the row is **gone** and
assert a fresh row **is not** — because "deleted everything" and "deleted
nothing" are equally wrong.

---

## `tracking_provider_connections`, and where the line is on secrets

§15: *"manage integration credentials through environment variables, never
database plaintext."* §9 Mode B: store *"provider; external tracking ID;
tracking URL; expiration; consent status."*

Those look contradictory and are not:

- an **integration credential** authenticates PickLoads to a provider's API for
  every shipment — an API key, a client secret, a refresh token. Those live in
  environment variables. **No column here can hold one**, and a CHECK refuses
  the shapes they take (`client_secret`, `api_key`, `access_token`,
  `refresh_token`, `private_key`, `Bearer `, `authorization=`, `-----BEGIN`,
  `sk_`, `whsec_`).
- a **Mode B tracking URL** is the resource itself: one expiring per-shipment
  locator a provider mints for one driver. §9 names it as a field to store. An
  opaque path or query token is *what a share link is*, so refusing it would
  refuse Mode B — the CHECK targets named credential parameters only.

The URL is **staff-only at every layer**: no customer policy exists on the
table, no DTO serializes it, and the dispatcher page opens it with
`rel="noopener noreferrer"` so the provider is not handed the staff page's URL.
Whether a shipper should ever see a Mode B link is a decision with its own
consent gate and belongs to whoever connects a real provider.

Other guarantees: **HTTPS only** (a live position must not travel in clear, and
`javascript:`/`data:` must not become a script source on a staff page); one
**active** connection per shipment (partial unique index); shipment/provider/
external-id/`connected_at` immutable; **revocation is one-way** — re-connecting
is a new row.

Attaching a link switches `tracking_mode` to `link`; revoking the last one
returns it to `manual`, so §30's labels stay honest without anybody
remembering to update them.

---

## The map (§25, §23, §30)

**It makes no network request.** No Google Maps script, no Mapbox GL, no
Leaflet, no tile server. One inline `<svg>` rendered from coordinates the
server already disclosed under §9's levels.

**The CSP is therefore unchanged — updated for exactly what was needed, which
was nothing.** Same-origin markup loads under `default-src 'self'`. Two further
consequences: no third party learns which shipments are being watched (a tile
request carries the viewport, which is the truck's position, to somebody who is
not a party to the freight), and there is no basemap — so it is labelled a
**route diagram**, not a street map, because calling it a map of roads it does
not draw would be the same species of claim §30 forbids. When a basemap
provider is eventually chosen, the runbook records the exact single `img-src`
entry to add.

**Lazy-loaded (§25).** `ShipmentMap` is reached only through
`next/dynamic(..., { ssr: false })` in `LocationPanel`, so it compiles to its
own chunk. The e2e lane reads the built `.next/static/chunks` and asserts the
map's fingerprint appears in **no route chunk and no shared chunk**, and that
no public page request fetches it — with a non-vacuity check that the panel
(which *is* eager) does appear in route chunks. `ssr: false` is not decoration:
the projection reads coordinates that must not appear in server-rendered HTML a
cache or a crawler could keep.

**The accessible alternative (§23) is not alt text.** It is a visible, ordered
list of every reading, with machine-readable `<time datetime>`, coordinates and
speed when disclosed, present **whether the map mounts or not**, keyboard
reachable and readable with the stylesheet deleted. The map's `<desc>` and the
list's `role="status"` summary are **the same string**, so a screen-reader user
and a sighted user cannot be told different things about the same picture.

**Reduced motion (§23):** the only animation in the block (the newest-reading
marker) lives inside `@media(prefers-reduced-motion: no-preference)` — so
"reduce" is the default and the animation is the opt-in, which is the only
arrangement that cannot be forgotten. Asserted by a CSS scan.

**Honest labels (§30):** "Live location available" requires a live source
**and** a real coordinate; "Milestone tracking" is a place with no live source
— **the state of every PickLoads shipment today**; "Location temporarily
unavailable" is nothing to show. The map may mount **only** in the live state
with at least one plotted point, so a marker is never placed at a city centroid
a dispatcher typed.

The panel fills the slot M-74 labelled `data-testid="shipment-map-slot"` on the
shipper detail page, adds the same section to `/track`, and renders at the
staff audience (coordinates unredacted) on the dispatcher page.

---

## `eta_source = 'provider'` — the decision

**It stays UNREACHABLE, and M-78's partition assertion stays truthful.**

M-78 shipped `DISPATCHER_ETA_SOURCES ∪ UNREACHABLE_ETA_SOURCES = ETA_SOURCES`
as a partition and instructed M-80 to move `provider` across *in the same
commit that makes it reachable*. It is not reachable: no adapter has a
transport, so no provider ETA exists to label, and moving it would make §30's
honest-label rule a lie in the other direction. `fetchEtaInputs` returns
**inputs** (remaining miles, drive minutes, HOS minutes) and never a provider
ETA claim, so nothing in this module is even in a position to set the column —
asserted by a source scan over the four M-80 modules, none of which contains
the string `eta_source`.

---

## §26 — location-provider failures

`location_provider_failure` was already one of §26's nine named signals
(M-72 shipped the vocabulary). M-80 is the module that produces it, and it is
emitted on **six** paths: the customer read, the staff read, the public read,
the location write, the connection attach, and the retention purge — plus the
provider poll.

**The URL is never logged.** The attach-failure signal names the provider and
nothing else; `observability.ts` would drop a bearer-shaped string whole, but
it must not be handed over in the first place. Asserted by a source scan and by
a redaction test.

---

## DB changes

### Migration 0027 — `0027_shipment_locations_providers.sql`

| Object | Notes |
|---|---|
| `company_settings` row `location_retention_days` | `90`. Idempotent upsert; also seeded. |
| `location_retention_days()` | Resolves the window. Fails safe to 90 on missing / unparseable / out-of-range. `service_role`. |
| `shipment_locations` | M-70's `ShipmentLocationRow`, all 15 fields. 3 CHECKs (coordinate pair · says-something · provider↔source) + 2 more (external id needs a provider; speed 0–200). |
| `idx_shipment_locations_external_event` | **partial UNIQUE** `(shipment_id, provider, external_event_id)` — §9's dedupe as a database fact. |
| `idx_shipment_locations_shipment` | `(shipment_id, recorded_at desc)` — the only customer read shape (§25). |
| `idx_shipment_locations_retention` | partial on `retention_expires_at` — the purger's scan. |
| `trg_shipment_locations_no_update` | UPDATE refused for every role incl. the owner (PL409). DELETE deliberately NOT refused — this is the one shipment table §9 requires to be deletable. |
| `tracking_provider_connections` | M-70's `TrackingProviderConnectionRow`. 4 CHECKs incl. https-only and the §15 credential refusal. |
| `idx_tracking_provider_connections_active` | **partial UNIQUE** `(shipment_id) where active`. |
| `idx_tracking_provider_connections_external` | partial UNIQUE `(shipment_id, provider, external_tracking_id)`. |
| `idx_tracking_provider_connections_due` | `(last_polled_at) where active` — the future poller's read shape. |
| `trg_tracking_provider_connections_immutable` | identity frozen; revocation one-way (PL409). |
| `trg_shipment_events_no_coordinates` | BEFORE INSERT on `shipment_events` — a non-null lat/long raises PL422 naming `record_shipment_location()`. |
| `trg_shipment_events_location_mirror` | AFTER INSERT — an event with a city/state produces a purgeable location row. |
| RLS | Enabled on both. `revoke all … from authenticated, anon` then **SELECT only** to `authenticated`. **One staff policy each. No customer policy, no anon policy, no write policy for any role.** |
| `my_shipment_locations(uuid, integer)` | **`authenticated`** — the customer projection. Seven OUT columns; no `raw_metadata`, no `provider`, no `external_event_id`. Audience from the caller's memberships; §9's four levels applied in SQL. |
| `record_shipment_location(...)` | `service_role`. Dedupe-insert + newest-wins update to `shipments.current_*`. |
| `set_shipment_location_visibility(...)` | `service_role`. Rank rule (PL403 on a dispatcher widening) + a `staff_only` event. |
| `attach_tracking_provider_connection(...)` | `service_role`. Revokes any active connection in the same statement; sets `tracking_mode = 'link'`. |
| `revoke_tracking_provider_connection(...)` | `service_role`. Returns the shipment to `manual` when the last link goes. |
| `purge_expired_shipment_locations(...)` | `service_role`. **The retention executor.** |

**Nothing shipped is altered.** No column dropped, no default changed, no
existing policy or grant touched. The two triggers on `shipment_events` are
additive: no code path in `src/` has ever written an event coordinate.

---

## Endpoints

**No new route.** The retention purge is **task 3 of the existing
`/api/cron/daily`** rather than a new cron entry — the work is a single bounded
statement, that route is already in `vercel.json`, already `CRON_SECRET`-guarded
(bearer, constant-time, 503 unset / 401 wrong) and already the place an operator
looks when a daily job did not run. Its JSON response gains a
`locationRetention` block (`ok`, `retentionDays`, `deleted`, `moreRemaining`).

Three new server actions on the dispatcher surface —
`setLocationVisibilityAction`, `attachProviderLinkAction`,
`revokeProviderLinkAction` — each through `resolveShipmentAccess` first, Zod
second, a `security definer` function third. The revoke action re-scopes the
posted connection id to the shipment (same reasoning as M-76's driver-token
revoke: without it a dispatcher could revoke any connection in the system by
posting its id).

## Env vars

**None required, and none added to any environment.** The five documented
provider variables (see the contract table) are read by `isConfigured()` and
are absent everywhere; setting one changes the refusal code from
`not_configured` to `not_implemented` and nothing else.

---

## Deployment

1. Apply **0027** (after 0026).
2. Re-run the seed, or upsert the key by hand:
   `insert into company_settings (key, value, description) values ('location_retention_days','90','…') on conflict (key) do nothing;`
3. Deploy. `vercel.json` is unchanged — `/api/cron/daily` already runs at
   11:00 UTC and now purges as its third task.
4. Smoke test (see the runbook): `select location_retention_days();` → `90`;
   `select purge_expired_shipment_locations();` → a JSON envelope naming the
   window; open a shipment on `/portal/admin/shipments/[id]` and confirm the
   **Tracking providers** table shows *Not configured / Not connected* for all
   five.

### ROLLBACK

Remove the retention task from `/api/cron/daily` (or unset `CRON_SECRET`)
**first**, so nothing calls the purger mid-teardown. Then:

```sql
drop trigger if exists trg_shipment_events_location_mirror on shipment_events;
drop trigger if exists trg_shipment_events_no_coordinates on shipment_events;
drop function if exists public.mirror_shipment_event_location();
drop function if exists public.guard_shipment_event_coordinates();
drop function if exists public.purge_expired_shipment_locations(integer, integer);
drop function if exists public.record_shipment_location(uuid, timestamptz, numeric, numeric, text, text, numeric, integer, shipment_event_source, tracking_provider, text, jsonb);
drop function if exists public.set_shipment_location_visibility(uuid, shipment_location_visibility, uuid, text);
drop function if exists public.attach_tracking_provider_connection(uuid, tracking_provider, text, text, timestamptz, tracking_consent_status, uuid);
drop function if exists public.revoke_tracking_provider_connection(uuid, uuid, text);
drop function if exists public.my_shipment_locations(uuid, integer);
drop function if exists public.location_retention_days();
drop trigger if exists trg_tracking_provider_connections_immutable on tracking_provider_connections;
drop function if exists public.guard_tracking_provider_connection_immutable();
drop policy if exists "staff manage tracking provider connections" on tracking_provider_connections;
drop policy if exists "staff manage shipment locations" on shipment_locations;
drop trigger if exists trg_shipment_locations_no_update on shipment_locations;
drop function if exists public.guard_shipment_locations_no_update();
drop table if exists tracking_provider_connections cascade;
drop table if exists shipment_locations cascade;
delete from company_settings where key = 'location_retention_days';
```

**Destructive** for the position series and for every provider link ever
attached — `pg_dump -t shipment_locations -t tracking_provider_connections`
first. **Not destructive for the timeline**: every city/state a dispatcher or
driver ever reported survives as the `shipment_events` row it was mirrored
from, which is why the mirror is a copy and not a move.

Roll back `src/lib/supabase/database.types.ts`, delete
`src/lib/shipments/{locations,retention,location-visibility,map-state}.ts`,
`src/lib/shipments/providers/`, the two `src/components/tracking/`
components, and revert the three action blocks, the three forms, the four
surface edits, the `dto.ts` `locations` additions and the cron task in the same
deploy.

**It fails CLOSED either way**: with the tables gone the accessors are gone,
the DTOs receive an empty location list, the map never mounts and the panels
render §30's "Location temporarily unavailable" — the same honest state they
show today with no provider connected.

0017–0026 are untouched throughout.

---

## Tests

| Suite | Count | New in M-80 |
|---|---|---|
| `npm test` (vitest) | **1399** (was 1238) | +161 |
| `npm run test:rls` | **671** (was 588) | +83 assertions |
| `npm run test:integration` | **295** (was 263) | +32 |
| `npx playwright test` | **270** (was 264) | +6 |
| `npm run build` | **373 pages** (unchanged) | — |

**Unit.** Adapter-interface conformance for all five providers (every method
present; every fetch refused; env-var gating incl. Geotab's three-key
requirement and a blank-string case); per-vendor normalisation against real
payload shapes incl. the km/h trap, the zone-less timestamp and the
`"Richmond, VA"` split; the normalisation primitives against everything
`Number()` would silently coerce; dedupe keys (namespaced, stable, `null`
rather than fabricated, bounded to 200 chars); the four visibility levels ×
five audiences on the series; the write-side direction rule over all ten
ordered pairs; retention window arithmetic incl. fourteen unusable inputs, both
out-of-range directions and the floor; SQL↔TypeScript parity for the retention
ladder and the visibility rank map, read out of the migration; §30's three
labels and `mapMayMount`; the panel axe-scanned in all four levels plus the
empty, failed and map-mounted states; the text equivalent's list semantics,
`<time datetime>` values and live-region summary; the lazy-import boundary; the
CSS reduced-motion arrangement; the projection's bounds and north/south
orientation.

**Integration** (PG16, real migration chain): write → newest-wins current
position; dedupe on replay and non-vacuity on a different id; the same id on a
different shipment; out-of-order readings stored without moving the truck
backwards; the Mode A mirror; the ledger's coordinate refusal; retention
stamping; the four levels through `my_shipment_locations()` under real shipper /
carrier / broker / stranger sessions; the consent gate on speed in both
directions; the DTOs built from real rows; the visibility write rule (PL403 /
admin / PL422); Mode B attach → supersede → revoke → back to `manual`; the §15
credential refusals with a non-vacuity acceptance; **and the purge deleting an
expired row while keeping a fresh one**, idempotently, honouring a shortened
window, failing safe on garbage, and batching with `more_remaining`.

**RLS** (+83): catalog facts (RLS on, exactly one policy each, no anon
privilege, the two partial unique indexes); the OUT-column allow-list read out
of `pg_proc`; five sessions reading nothing from both tables; the accessor per
audience across all four levels; the consent gate; sentinel sweeps for the raw
payload and the tracking URL with staff-side non-vacuity; the write path
`service_role`-only including an admin refusal; every CHECK and trigger as the
table owner; the ledger's coordinate refusal and the mirror; and the retention
executor **deleting**, twice (idempotence) and under a shortened window.

**E2E** (+6): the map is its own chunk and appears in no route or shared chunk
(with a non-vacuity check on the panel); no public page requests a map script,
a tile or a map host, nor the lazy chunk; the shipped CSP names no map vendor;
both portal surfaces are session-gated; `/track` is axe-clean and
overflow-free at 320 / 768 / 1280; `/track` makes none of six forbidden claims.

### Non-vacuity by injection — eight defects, each failed loudly

| Injected defect | Failed |
|---|---|
| §9's public coordinate cap removed (`precise = level === "exact"`) | unit — *"the PUBLIC audience is capped at city/state even at `exact`"* |
| An adapter returning `{ok:true}` instead of refusing | unit — 6 conformance tests |
| `DEFAULT_RETENTION_DAYS` raised to 3650 ("keep forever") | unit — the retention default |
| The admin-only widening check deleted from 0027 | integration — *"a DISPATCHER may NOT widen — PL403"* |
| The purger's predicates replaced with `where false` | RLS — *"the purge reports deleting at least one row"* |
| `ShipmentMap` statically imported | unit — the dynamic-boundary scan **and** the `<desc>`/summary test |
| `raw_metadata` added to `my_shipment_locations()`'s OUT list | RLS — the `pg_proc` allow-list |
| An anon SELECT policy added to `shipment_locations` | RLS — *"exactly ONE policy"* |

### Honest limitations

The location panel renders on three surfaces, all of which need a shipment in a
database or a Supabase session. The e2e lane runs `next start` on placeholder
credentials by design (M-41), so a browser there can only reach the login bounce
or the `/track` form. Seeding a shipment carrying a fabricated GPS fix so a
browser could screenshot the map is exactly what §30 forbids. The panel's states
are therefore scanned in jsdom with the same axe-core engine, and the data
behind them is proved against a real PostgreSQL 16 — with the split written
down in each file's header rather than left implicit.

jsdom applies no stylesheet, so axe reports colour-contrast as "incomplete"
there. The `.shipmap-*` rules introduce **no new colours** (every value is an
existing `@theme` token or a shade already present in `v4.css`), and the palette
they draw from is scanned in a real browser on sixteen routes by the Playwright
suite.

### One incidental fix, named rather than smuggled

The 320px axe scan this module added found a **pre-existing** WCAG 2.5.8
failure: `.langsel` (the sitewide language selector) met the 24px target-size
rule only inside `@media(pointer:coarse)`, so it failed for a mouse user on a
narrow window. Fixed with `min-height:24px` on the base rule — no colour, font
or spacing token changed, and the 38px topbar already absorbs it. It is not
M-80 scope; it is a real defect M-80's test found, and hiding it by narrowing
the test would have been the wrong trade.

---

## Files

**New:** `supabase/migrations/0027_shipment_locations_providers.sql` ·
`src/lib/shipments/providers/{types,normalize,base,motive,samsara,geotab,verizon-connect,other,index}.ts` ·
`src/lib/shipments/{retention,location-visibility,map-state,locations}.ts` ·
`src/components/tracking/{ShipmentMap,LocationPanel}.tsx` ·
`tests/unit/{shipment-providers,shipment-retention,shipment-location-visibility}.test.ts` ·
`tests/unit/shipment-map-a11y.test.tsx` ·
`tests/integration/shipment-locations.test.ts` ·
`tests/e2e/shipment-map.spec.ts` · this doc.

**Changed:** `src/lib/shipments/{dto,public-lookup,staff-access}.ts` ·
`src/lib/supabase/database.types.ts` ·
`src/lib/validation/dispatcher-shipments.ts` ·
`src/app/actions/dispatcher-shipments.ts` · `src/app/api/cron/daily/route.ts` ·
`src/app/[locale]/portal/{shipper,admin}/shipments/[shipmentId]/page.tsx` ·
`src/components/tracking/TrackingResult.tsx` ·
`src/components/portal/{ShipmentDetailView,ShipmentOpsForms,ShipmentStaffDetailView}.tsx` ·
`src/app/{v4,portal}.css` · `messages/{en,es,fr,ru,ht}.json` (+12 keys ×5) ·
`supabase/seed.sql` · `supabase/tests/{10_fixtures,20_rls_isolation}.sql` ·
five existing test files · `docs/modules/INDEX.md` · `docs/LAUNCH-RUNBOOK.md`.

---

## Extension points

- **A real provider** is one file: implement the four `fetch*` methods in
  `providers/<vendor>.ts` against that vendor's API. `normalize`, `dedupeKey`,
  the consent gate, the raw-metadata handling, the dedupe index and the write
  path already exist and are already tested. Add the credentials to the
  environment (§15), and `pollProviderLocation` starts producing readings with
  no change above it. A **sixth** `TrackingProvider` enum value is a compile
  error until an adapter exists for it, because the registry is a full `Record`.
- **When a provider is connected**, `eta_source = 'provider'` becomes
  reachable: move it from `UNREACHABLE_ETA_SOURCES` to
  `DISPATCHER_ETA_SOURCES` in the same commit, add the seventh honest label,
  and M-78's partition test will tell you if you did only half.
- **A basemap**, if one is ever wanted, needs exactly one `img-src` entry in
  `next.config.ts` and a tile layer in `ShipmentMap`. The e2e chunk and CSP
  assertions will fail until both are done deliberately.
- **A poller** (Mode C) reads `idx_tracking_provider_connections_due` and calls
  `pollProviderLocation` per connection. It does not exist because there is
  nothing to poll.
- **M-81** owns the broker-partner surface; the location accessor already
  serves the broker audience through `my_broker_partner_ids()`.
- **M-82** owns the 12 breakpoints; the panel is one column below 640px and the
  reading list stacks.
- **M-84b** replaces the body of `logShipmentSignal` with a Sentry capture and
  no call site changes — including M-80's six `location_provider_failure`
  emissions.
