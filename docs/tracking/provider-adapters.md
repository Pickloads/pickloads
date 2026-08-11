# Tracking-provider adapter interface

## What it is

§9 describes three ways a shipment's position can be known, and an interface
that lets a fourth be added without touching anything else.

| Mode | Source | State today |
|---|---|---|
| **A — manual** | a dispatcher types an update | live, and the default |
| **B — tracking link** | a per-shipment URL from an external provider | modelled, attachable, no contract |
| **C — ELD/GPS** | a telematics integration | modelled, every adapter refuses |

`shipments.tracking_mode` says which one a shipment is on. `milestone` is the
honest default: the system knows where the freight was at the last update, not
where it is now.

## The interface

`src/lib/shipments/providers/` holds one module per named provider plus a
registry. An adapter implements a small contract: identify itself, validate a
connection's configuration, and fetch positions.

The rule that matters more than the shape: **an adapter that cannot reach its
provider returns a failure, never a position.** Every adapter in the repo
currently refuses every fetch, because there is no telematics contract. That
is not a stub waiting to be filled with plausible test data — §30 forbids fake
GPS, and the integration lane asserts that `shipment_locations` contains no
provider-sourced row that nobody recorded by hand.

Credentials live in environment variables. Migration 0027 refuses at the
**database** a tracking URL that carries an integration credential in its
query string (§15), so a well-meaning paste cannot put a key in a table.

## Connections

`tracking_provider_connections` links a shipment to an external source.

- Attaching a link switches the shipment to `link` mode and journals it.
- Attaching a **second** link revokes the first, in one statement — there is
  no state where two links are live.
- Revoking the last link returns the shipment to `milestone` tracking, which
  is §30 again: with no source, the honest label is "milestone tracking", not
  a stale position presented as current.
- Connection rows are immutable in what they identify.

## Recording a position

`record_shipment_location()` writes the reading and advances the shipment's
current position, in one call.

- **Dedupe** is by provider event id, per shipment. Replaying the same event
  adds no row and says so; the same id on a *different* shipment is not a
  duplicate.
- **Out-of-order readings are stored but do not move the truck backwards.**
  Late-arriving telemetry is history, not a correction.
- **Mode A events are mirrored** into the same purgeable history with no
  call-site change, so a manually-updated shipment and a provider-fed one have
  the same shape of record.
- The ledger refuses an `update` to a coordinate — corrections are new rows.

## Visibility (§9's four levels)

`location_visibility` is a per-shipment setting with four values:

| Level | What a customer sees |
|---|---|
| `hidden` | nothing |
| `milestone_only` | nothing positional — status changes only |
| `approximate` | city and state; **never** a coordinate, never a speed |
| `exact` | coordinates and speed, for account audiences |

Two rules cut across it:

- **The public audience is capped at city/state even at `exact`.** A visitor
  who passed a two-factor lookup is not the shipper.
- **Speed is withheld without driver consent**, at any level.

The key set never varies with the level — the setting is not itself a signal —
and the raw provider payload never reaches any customer read, at any level.
Staff are unaffected: dispatch cannot operate what it cannot see.

A dispatcher may **narrow** the level and the change is journalled; a
dispatcher may not widen it (`PL403`); an admin may. The refusal is about the
role, not the value.

## Retention

Every reading is stamped with `retention_expires_at`, computed from
`company_settings.location_retention_days` (default 90, bounds 1–3650). Stored
rather than recomputed on read, deliberately: shortening the window still
expires old rows, while lengthening it does not retroactively resurrect a row
that was already promised a shorter life.

`purge_expired_shipment_locations()` runs nightly from `/api/cron/daily`. It
is bounded per call and reports whether more remain, so a backlog drains over
several nights rather than locking the table once. An unparseable setting
resolves to 90 — never to "keep forever", which is the failure direction that
matters.

## Where the tests are

- `tests/unit/shipment-providers.test.ts`, `shipment-location-visibility.
  test.ts`, `shipment-retention.test.ts`
- `tests/integration/shipment-locations.test.ts` — recording, dedupe,
  ordering, the four levels under real sessions, consent, Mode B connections,
  the retention executor and the adapters against the real registry
- `tests/e2e/shipment-map.spec.ts`

## Environment

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_MAP_PROVIDER` | which map renderer the client mounts |
| `NEXT_PUBLIC_MAP_TILE_URL` / `MAP_API_KEY` | tile source, when one is configured |
| provider-specific keys | one per telematics vendor, when a contract exists |

With no map configuration the surface renders its **text-equivalent** —
the same facts as a list — rather than an empty box.

## Extension points

To add a provider: implement the adapter, register it, add its credential
variable, and add a value to the provider enum. Do **not** add a fallback that
returns a last-known position as if it were current; the map's honest labels
(*"Location temporarily unavailable"*) exist precisely so an adapter can fail
without the product lying.
