# RLS policies

## What it is

Row-level security is the layer that decides *which rows exist* for a given
session. In this system it is not the only layer, and knowing what it does and
does not cover is the point of this document.

## Four layers, in order

1. **Route/session gate.** A `/portal/**` route bounces an anonymous request
   to `/login` before any query runs.
2. **RLS.** The row either exists for this session or it does not. This is
   what makes tenant isolation survive a mistake in a query builder.
3. **Column privileges.** `select` on `shipments` is revoked from
   `authenticated` and `anon` and granted back on 49 named columns (migration
   0030). RLS is row-level; it could not keep `margin` out of a row the
   customer is entitled to read.
4. **DTO serializers.** Explicit allow-lists, no spread, key-set tested.

A leak needs all four to fail. The tests for each are proved capable of
failing.

## Policy inventory

| Migration | Policies | Covers |
|---|---|---|
| 0018 | 15 | `shipments`, `shipment_parties`, `shipment_assignments` |
| 0019 | 4 | `shipment_events` |
| 0020 | 1 | `shipment_tracking_access` (staff read only) |
| 0021 | 2 | `invoices`, shipment-linked |
| 0023 | 3 | `shipment_driver_tokens` and its access ledger |
| 0024 | 6 | `shipment_documents` |
| 0025 | 2 | `shipment_exceptions`, `shipment_eta_history` |
| 0026 | 5 | the five notification tables |
| 0027 | 2 | `shipment_locations`, `tracking_provider_connections` |
| 0029 | 9 | `broker_partners`, memberships, grants, invites |
| 0030 | 14 **restrictive** | dispatcher scoping, across every shipment table |

Every table listed has RLS **enabled**, and none of them grants an `insert`,
`update` or `delete` policy to a browser role. Writes go through
`security definer` functions with `execute` revoked from `public`.

## Permissive vs restrictive

Postgres ORs permissive policies together and ANDs restrictive ones on top.
That property is why M-83 could add dispatcher scoping without editing a
single shipped policy: fourteen `as restrictive` policies narrow staff reach
and short-circuit for customer roles, so a shipper's read is unchanged and a
dispatcher's is bounded by `dispatcher_may_see()`.

It is also a trap worth recording. A permissive-policy OR bit M-61: the
`posts` table had two permissive policies, and an unpublished row caused
Postgres to evaluate `is_staff()` — a function granted only to
`authenticated` — which made the anonymous blog and sitemap silently empty.
Migration 0013 fixed it. When adding a policy, ask what happens when the
*other* policy's predicate is evaluated for a role that cannot call the
functions in it.

## The helper functions

| Function | Answers |
|---|---|
| `my_shipper_ids()` | which shipper organizations this session belongs to |
| `my_carrier_ids()` | the same for carriers |
| `my_broker_partner_ids()` | verified **and** active partners only (§12) |
| `is_staff()` | dispatcher or admin |
| `is_dispatcher()` | dispatcher specifically |
| `dispatcher_may_see(uuid)` | scope: assigned carriers plus own shipments |
| `shipment_in_staff_scope(uuid)` | the shipment-level form |
| `broker_can_read_shipment(uuid)` | live grant, live agreement, verified partner |
| `shipment_restricted_fields(uuid)` | the financial accessor — **no row** out of audience |

`shipment_restricted_fields` deserves its own note. It returns no row at all
when the caller is out of audience. Returning a row of nulls would have been
an existence oracle: the caller would learn the shipment exists.

## §19's seven proofs

The directive names seven isolation properties. All seven are proved at the
database, and each has a non-vacuity control — a session that *should* see the
row, seeing it.

1. Shipper A cannot read shipper B.
2. Carrier A cannot read carrier B.
3. An anonymous session reads nothing on any shipment table.
4. Public tracking cannot expose private fields — proved at route level with
   a key-set test **and** a value sweep.
5. Carrier users cannot edit financial fields — `42501` for every browser
   role on `update`, `insert` and `delete`, and on a direct `select` of any
   financial column. `create_shipment` is left as the only function that
   writes them.
6. Dispatcher permissions are limited — through `src/`, not only in SQL.
7. Broker A cannot read broker B, and a revoked or expired grant closes
   immediately.

## Testing RLS

Two lanes, deliberately different:

- `supabase/tests/*.sql` (`npm run test:rls`) — pure SQL, no TypeScript. It
  proves a **session** cannot cross a boundary, and it asserts structural
  facts like the exact column list of `shipment_driver_tokens`.
- `tests/integration/*.test.ts` (`npm run test:integration`) — the real
  exported functions from `src/` running as a real `authenticated` session
  with `request.jwt.claim.sub` set. It proves the **query builders** produce
  SQL the schema accepts and the policies scope.

The injection controls matter more than the assertions. Several tests re-issue
a query with the application-level tenant predicate **removed** and assert the
database still refuses. That separates "the app filtered it" from "the policy
refused it", which are the same green and very different guarantees.

## Extension points

Adding a table to the tracking system means, at minimum: `enable row level
security`, a `select` policy per audience, **no** write policy, a
`security definer` writer granted to `service_role` alone, and a row in the
RLS suite's structural assertions. A table with RLS enabled and no policy is
readable by nobody, which is the correct failure direction — but say so in the
migration, or the next person will think it is a bug.
