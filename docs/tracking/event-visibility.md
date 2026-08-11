# Event visibility model

## What it is

Every fact about a shipment is written to `shipment_events` exactly once, with
a **band** saying who may read it. There is no second copy of the timeline for
customers and no filter applied at render time only. The band is a column, RLS
consults it, and the DTO serializers consult it again.

## The five bands

| Band | Read by |
|---|---|
| `public` | anybody who passes the two-factor `/track` lookup, and everyone above |
| `shipper` | the shipment's shipper organization, and staff |
| `carrier` | the assigned carrier and its drivers, and staff |
| `broker` | a verified broker partner with a live grant, and staff |
| `staff_only` | dispatchers in scope, and admins |

§7 of the directive names four; the `broker` band is the fifth, added by M-71
because §12 describes a partner who sees more than the public and less than
the shipper, and squeezing that into an existing band would have leaked one
way or the other.

The bands are **not** a ladder in the sense that `carrier` implies `shipper`.
A shipper does not read the carrier band and a carrier does not read the
shipper band — they are counterparties. `AUDIENCE_EVENT_VISIBILITY` in
`src/lib/shipments/types.ts` states each audience's set explicitly:

```
public   → [public]
shipper  → [public, shipper]
carrier  → [public, carrier]
broker   → [public, broker]
staff    → all five
```

## Public message vs internal message

Every event row carries two text columns:

- `public_message` — written for the customer, in English, by a dispatcher.
- `internal_message` — written for the desk.

The DTO serializers never emit `internal_message` to a customer audience, and
the sentinel sweep in `tests/unit/shipment-dto.test.ts` proves it against a
row where every staff-only field is populated with a recognisable value. The
same test proves the non-vacuous half: a staff read of the same row **does**
carry the sentinels, so the customer's zero is redaction and not an empty row.

The same split applies to delays: `delay_reason_public` reaches the customer,
`delay_reason_internal` does not.

## Translated operator text (§24, decision D-6)

`/track` renders in five locales and dispatchers type in English. Machine
translating a customer-facing operational note is forbidden by §24, so the
system does not do it. Instead:

- **Common situations use a curated phrase catalogue** (`src/lib/shipments/
  phrases.ts`), authored once and translated into all five locales. A
  dispatcher picks "delayed — traffic" and the customer reads it in their own
  language. The catalogue's keys never leak: an early defect mailed raw
  `phrase:delay.traffic` tokens to customers, and M-79 closed it by resolving
  every notification through the catalogue.
- **Genuinely novel situations fall back to free text**, shown untranslated
  and labelled as written by dispatch in English. That is honest; a silent
  machine translation of "the driver is at the wrong gate" is not.

## Redaction shape

Customer payloads redact **by nulling values, never by dropping keys**. A key
set that varied with the data would itself be a signal — the absence of
`current_latitude` would tell a public visitor that the shipment has a
position they are not allowed to see. The key-set tests assert this directly:
the public DTO has the same keys for a fully populated shipment and an empty
one.

Coordinates never appear on any customer timeline event, at any location
visibility level. That rule is in the DTO and also enforced by migration
0027's `guard_shipment_event_coordinates` trigger, because a coordinate that
reached the events table would outlive any serializer change.

## Corrections and deletions

There are none. `shipment_events` is append-only for every role including the
table owner, enforced by `guard_shipment_events_append_only`. A mistake is
corrected by appending a correction event that names the original, the new
value and a mandatory reason. §7's "do not delete history silently" is
therefore a structural property rather than a convention.

Appointments follow the same rule: a rescheduled appointment is a new event
carrying the previous time, not an `update` of a column.

## Where the tests are

- `tests/unit/shipment-dto.test.ts` — the band matrix, the sentinel sweeps and
  the anti-vacuity control that catches a naive spread-based serializer.
- `tests/unit/shipment-types.test.ts` — the enums and the audience map.
- `tests/integration/shipper-shipments.test.ts` — the shipper's two bands
  against real rows under a real session.
- `tests/integration/broker-partner-access.test.ts` — the broker band, and
  that it reaches neither counterparty band.

## Extension points

A new event type needs a value in the `shipment_event_type` enum and a default
band. A new **band** is a much larger change — see the last section of
`architecture.md`.
