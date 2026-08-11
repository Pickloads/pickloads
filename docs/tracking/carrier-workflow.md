# Carrier update workflow

## What it is

Two surfaces, one permission model. A carrier with an account uses
`/portal/carrier/shipments`; a driver with no account uses a link,
`/driver/update/[token]`. Both can only move freight they are actually
assigned to, and neither can do anything commercial.

## The actions

`CARRIER_UPDATE_ACTIONS` in `src/lib/shipments/carrier-updates.ts` is the
complete list §13 names, each tagged with the actor(s) permitted to invoke it
and the kind of write it performs (`transition`, `eta`, `exception`):

confirm dispatch · en route to pickup · arrived at pickup · loading ·
picked up · in transit · arrived at delivery · unloading · delivered ·
upload BOL · upload POD · report a delay · report an exception · update ETA

`confirm_dispatch` is offered to a **carrier** and to no driver — accepting a
load is a company decision. Conversely, several road actions are offered to
both.

Two things a carrier explicitly **cannot** do: `completed` and `cancelled`.
Closing a shipment and cancelling one are the broker's decisions, and the
refusal is `actor_not_permitted` — the actor check runs before the
precondition check, so a carrier is told it is not their call rather than
which paperwork is missing.

`CARRIER_FORBIDDEN_FIELDS` names what a carrier may never write regardless of
action: anything financial, the tracking number, the shipper's identity, the
public access hash.

## Refusals are a vocabulary, not a boolean

`refuseCarrierAction` returns a typed reason, and
`FACT_INDEPENDENT_REFUSALS` marks the ones that do not depend on the current
row (an action that does not exist, an actor that may never invoke it). That
distinction matters for the UI: a fact-independent refusal is never shown as
an available-but-disabled button, because offering an action that can never
work trains people to ignore the interface. `CARRIER_STALE_PAGE_MESSAGE`
covers the other case — the page was right when it rendered and the shipment
has moved since.

## The driver link

§13 asks for a link that is shipment-scoped, short-lived, revocable,
rate-limited, audit-logged, non-enumerable and consent-aware. All seven are
properties of `shipment_driver_tokens` (migration 0023) rather than
conventions:

- **Shipment-scoped.** `shipment_id` is `NOT NULL` and an immutability trigger
  refuses to move it. One link opens one shipment, forever.
- **Carrier-scoped.** `carrier_id` is recorded at issue and compared against
  the shipment's *current* carrier on every redemption, so reassigning or
  releasing the carrier silently invalidates the old driver's link.
- **Short-lived.** `expires_at` is `NOT NULL` with `expires_at > issued_at`.
  There is no way to issue a link that never expires, and the RPC refuses to
  issue one that is already expired.
- **Revocable.** `revoked_at` is set only by `revoke_shipment_driver_token()`,
  and revocation is one-way. Revoked outranks expired in the state machine, so
  a revoked link never reports itself as merely stale.
- **Rate-limited.** Per IP, over a window, counting both failures and
  successes. An old burst does not lock anybody out and one network's abuse
  does not punish another's.
- **Audit-logged.** One `shipment_driver_token_access` row per presentation,
  granted or not, append-only for the table owner. Issue and revocation also
  land on the shipment timeline.
- **Non-enumerable.** The table stores an HMAC (`v1:<64 hex>`) under
  `DRIVER_TOKEN_SECRET` and **no** form of the plaintext — not truncated, not
  a prefix, not "the last four". The RLS suite asserts the exact column list,
  so adding such a column is a test failure. Expired, revoked, unknown,
  malformed and released links all produce an identical refusal page.

A defect worth remembering: an early version of `redeemDriverToken` hashed the
empty string when a token was malformed, which produced a *different* decoy
result and skipped both the ledger write and the rate limit. It was found by
adversarial probing in M-83 and fixed; the test that catches it compares the
five refusal classes byte for byte.

## Consent

`consent_status` defaults to `pending` and never to `granted`. A driver
actively chooses on the page, the choice is reversible, and it is journalled
as a `carrier`-band timeline event. Vehicle speed is withheld unless consent
is granted — §9's *"if permitted"* — even at the `exact` location visibility
level.

Recording consent against an expired or revoked link is refused, and an
unknown token is refused without saying so differently.

## Documents

A carrier uploads BOLs and PODs through `carrierUploadDocumentAction`; a
driver through `driverUploadDocumentAction`. Both land at `pending` status,
which reaches nobody until a staff member reviews it, and both are confined to
the shipment's own storage prefix. The upload is idempotent: a retried upload
does not produce a second row.

## No financial data, structurally

The redeem payload names no financial column, on a shipment that has them —
asserted in the integration lane rather than assumed. The carrier portal shows
the carrier's own `carrier_pay` and nothing else financial, and it gets it
through `shipment_restricted_fields()` rather than from the row, because the
column privilege was revoked.

## Environment

| Variable | Effect if unset |
|---|---|
| `DRIVER_TOKEN_SECRET` | links cannot be minted or verified; the page says updates are unavailable and gives the dispatch number |
| `SUPABASE_SERVICE_ROLE_KEY` | same |

## Where the tests are

- `tests/unit/carrier-driver-updates.test.ts`, `carrier-shipment-actions.
  test.ts`, `shipment-driver-token.test.ts`
- `tests/integration/carrier-driver-updates.test.ts` — the §27 carrier flow,
  token lifecycle, rate limit, ledger and consent
- `tests/integration/tracking-security.test.ts` — adversarial token probing
- `tests/e2e/carrier-driver-updates.spec.ts`, `tracking-flows.spec.ts`

## Extension points

Adding a carrier action means one entry in `CARRIER_UPDATE_ACTIONS` and,
if it is a transition, an edge in the graph. The offered-actions test walks
every status × actor combination, so an action that can never be reached shows
up immediately.
