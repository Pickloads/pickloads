# Shipment architecture

## What it is

A shipment is one piece of freight moving from a shipper's dock to a
consignee's, tracked from the moment somebody asks for a quote until the file
is closed. The `shipments` table is the spine; everything else in the tracking
system either describes a shipment (`shipment_events`, `shipment_locations`,
`shipment_documents`, `shipment_exceptions`, `shipment_eta_history`), grants
access to one (`shipment_assignments`, `shipment_driver_tokens`,
`broker_shipment_grants`), or records that somebody looked at one
(`shipment_tracking_access`, `audit_events`).

## Why `shipments` is a separate table from `loads`

This was the first architectural question and the plan settles it in §1. The
short answer: `loads` models the dispatch business, `shipments` models the
brokerage business, and they disagree about facts a single table cannot hold
both ways.

`loads.carrier_id` is `NOT NULL` — a dispatch load exists because a carrier
took it. A brokerage shipment exists before any carrier is involved: the first
four statuses in §6's lifecycle (`quote_requested`, `quote_sent`,
`quote_accepted`, `carrier_search`) all describe a shipment with no carrier.
Making `loads.carrier_id` nullable would have loosened a constraint three
shipped modules depend on, and the dispatch fee trigger that fires on
`loads` insert would have had to learn about a second kind of row.

`loads` also carries a six-value status enum built around a dispatcher's day.
§6 specifies eighteen statuses built around a shipper's visibility into a
journey. These are not the same vocabulary at different resolutions; they
answer different questions.

The tables are therefore siblings. `shipments.load_id` is a nullable reference
for the case where dispatch freight is later brokered, and nothing in the
`loads` modules was changed to make room for tracking — a property the
regression tests assert.

## The tables

| Table | Migration | What it holds |
|---|---|---|
| `shipments` | 0018 | The freight: parties, addresses, appointments, equipment, status, ETA, tracking configuration, and the three staff-only financial columns |
| `shipment_parties` | 0018 | Named contacts per shipment, each with a visibility band |
| `shipment_assignments` | 0018 | Carrier/driver/truck history. Released, never deleted |
| `shipment_events` | 0019 | The append-only timeline. Every status change, note, call, email, exception and document decision |
| `shipment_tracking_access` | 0020 | Every public lookup attempt and its true outcome |
| `shipment_documents` | 0024 | Document rows. Files live in a private Storage bucket |
| `shipment_driver_tokens` | 0023 | Shipment-scoped, expiring, revocable driver links |
| `shipment_exceptions` | 0025 | Delays, damage, refusals — opened, triaged, resolved |
| `shipment_eta_history` | 0025 | Every ETA value that was ever true, with its predecessor |
| `shipment_notifications` | 0026 | The outbound queue, its attempts and its suppressions |
| `shipment_locations` | 0027 | Position readings, with a retention stamp on each |
| `tracking_provider_connections` | 0027 | Mode B/C links to an external tracking source |
| `broker_partners`, `broker_shipment_grants` | 0028 | §12's partner access, per organization and per shipment |

## The write path

There is one shape and it does not vary. A browser never writes to a shipment
table directly: every policy grants `select` only, and the write functions are
`security definer` with `execute` revoked from `public` and granted to
`service_role` alone. A write therefore looks like this:

1. A server action or route handler validates the input with Zod.
2. It resolves the actor from the session — never from the request body.
   Roles are never accepted as input.
3. It calls the engine in `src/lib/shipments/` to decide whether the action is
   legal (`evaluateTransition`, `refuseCarrierAction`, the document matrix).
4. It calls the corresponding RPC with the service-role client. The RPC
   re-checks the parts a database can check — preconditions, uniqueness,
   ordering, the brokerage gate — and writes the row **and** its timeline
   event in one statement.
5. The engine's decision and the RPC's decision are tested against each other
   in the integration lane, so a divergence is a test failure rather than a
   production surprise.

This is why an event never goes missing when a status changes: they are the
same `insert`.

## The read path

Reads are the mirror image and take the caller's own cookie-bound client, so
RLS decides what exists. Above RLS sit two more layers:

- **Column privileges.** Migration 0030 revokes `select` on `shipments` from
  `authenticated` and `anon`, then grants it back on 49 named columns. The
  financial four are not among them. A `select *` from a browser session fails
  with `42501` rather than returning a row with the money in it.
- **DTO serializers.** `src/lib/shipments/dto.ts` builds five payloads —
  public, shipper, carrier, broker, staff — from explicit allow-lists. There
  is no spread operator in the file, and a test asserts that (`grep -c
  '\.\.\.row'` is zero, and a key-set test would fail if a serializer widened).

Staff who legitimately need a financial figure get it through
`shipment_restricted_fields()`, a `security definer` accessor that returns no
row at all when the caller is out of audience. Returning a row of nulls would
have been an existence oracle.

## Where the code lives

```
src/lib/shipments/
  types.ts              the vocabulary: 18 statuses, 17 enums, 10 row types
  transitions.ts        §20's graph, preconditions and actor table
  apply-transition.ts   the server-side applier
  dto.ts                five audience serializers, allow-listed
  public-lookup.ts      the two-factor public lookup and its ledger
  shipper-{list,detail,tiles}.ts   §11's portal queries
  staff-{access,detail}.ts, board.ts, search.ts   §14's desk
  carrier-{access,updates,shipments}.ts, driver-{access,token}.ts  §13
  document{s,-store}.ts §16's matrix and the signed-URL minting
  eta.ts, eta-estimate.ts, exceptions.ts   §10, §21
  notification-{rules,queue,worker}.ts     §17
  locations.ts, location-visibility.ts, map-state.ts, providers/  §9
  broker-{access,permissions}.ts           §12
  observability.ts      §26's signal vocabulary
```

## Extension points

- **A new status.** Add it to `SHIPMENT_STATUSES` in `types.ts`, give it a
  transition list and a precondition list in `transitions.ts`, and add the
  enum value in a migration. The exhaustiveness tests will name anything you
  forget.
- **A new document type.** Add it to the type enum and give it a row in
  `shipment_document_audiences`. The matrix test compares SQL and TypeScript
  cell for cell, so a type with no audience decision fails immediately.
- **A new tracking mode.** Implement the adapter interface in
  `src/lib/shipments/providers/` (see `provider-adapters.md`). Do not add a
  code path that fabricates a position when the provider is unreachable.
- **A new audience.** This is the expensive one: a new audience needs a
  visibility band, a DTO serializer, a document-matrix column, RLS policies,
  and an entry in every key-set test. §12's broker band is the worked example.
