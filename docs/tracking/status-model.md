# Shipment status model

## What it is

Eighteen statuses, in the lifecycle order §6 gives them, plus the rules about
which one may follow which, who may assert each change, and what must already
be true before a change is allowed. The whole model lives in
`src/lib/shipments/transitions.ts` and is mirrored — not re-implemented — by
migration 0019's `apply_shipment_transition()`.

## The eighteen

```
quote_requested → quote_sent → quote_accepted → carrier_search
→ carrier_assigned → dispatched → en_route_to_pickup → arrived_at_pickup
→ loading → picked_up → in_transit → arrived_at_delivery → unloading
→ delivered → pod_uploaded → completed
```

plus two that are states rather than stages, reachable from most of the
journey and not part of its order:

- `delayed` — the shipment is late and somebody has said why.
- `cancelled` — terminal, and requires a reason. There is no way to cancel
  without one; the RPC raises `PL422`.

`completed` and `cancelled` are the two terminal statuses. Nothing follows
them.

## Legal edges

`SHIPMENT_TRANSITIONS` is a total function from status to the set of statuses
that may follow it. Three properties are asserted by the unit lane and are
worth knowing:

- **Every status has an explicit list**, possibly empty. A status added to the
  enum without a list fails the exhaustiveness test rather than defaulting to
  "anything goes".
- **Undeclared edges are refused**, and the test walks the whole 18×18 matrix
  rather than sampling. The refusal code is `illegal_edge`.
- **Same-status "changes" are refused** with `same_status`. Re-asserting a
  status writes nothing, because a timeline that records non-events is a
  timeline nobody reads.

`IMPOSSIBLE_TRANSITIONS` and `OUT_OF_GRAPH_PROHIBITIONS` name the specific
sequences §20 calls out — delivering freight that was never picked up,
completing without a POD, moving a cancelled shipment — so the reason a
particular edge is missing is documented rather than inferred from its
absence.

## Preconditions

An edge being legal is necessary and not sufficient. `STATUS_PRECONDITIONS`
attaches facts that must already be true:

| Target | Precondition |
|---|---|
| `carrier_assigned` | an open `shipment_assignments` row exists |
| `picked_up` | a pickup timestamp is supplied |
| `delivered` | pickup was confirmed, and a delivery timestamp is supplied |
| `pod_uploaded` | an **approved** POD document exists on the shipment |
| `completed` | delivered, POD approved, and a human closeout assertion |
| `cancelled` | a cancellation reason |

The facts come from `shipment_transition_facts()`, one query, so the engine
and the database read the same row at the same moment. `pod_uploaded` is the
one worth dwelling on: an uploaded POD is not enough, a *rejected* POD is not
enough, and an approved BOL is not a POD. Un-approving a POD makes the status
unreachable again, because the fact tracks the current decision rather than a
historical one.

## Who may assert what

`ACTOR_PERMITTED_TARGETS` maps each actor — `dispatcher`, `admin`, `carrier`,
`driver`, `system`, `provider` — to the statuses it may assert. A carrier may
move freight along the road; it may not `complete` a shipment or `cancel` one,
because both are commercial decisions rather than operational ones. A driver's
list is narrower still. The refusal code is `actor_not_permitted`, and it is
checked **before** preconditions, so a carrier attempting to complete a
shipment is told it is not their decision rather than being told which
paperwork is missing.

Corrections are separate. `actorMayCorrect` permits only `admin`, and a
correction is an **additional** event carrying `from`, `to` and a mandatory
reason — never an edit of the original, which the append-only trigger refuses
for every role including the table owner.

## Idempotency and replay

`apply_shipment_transition()` takes an optional `p_idempotency_key`. A replay
with the same key performs no write at all: the status is not re-applied, no
second event is appended, and the caller receives the original event id with
`replayed: true`. Provider-sourced events dedupe on `external_event_id` for
the same reason. This is what makes a retried webhook or a double-clicked
button safe.

## Concurrency

Every transition is a compare-and-swap: the caller passes the status it
believes the shipment is in, and a mismatch raises `PL409`. Two dispatchers
acting on the same shipment therefore produce one write and one honest
conflict, rather than two writes in an order neither of them chose.

## Where the tests are

- `tests/unit/shipment-transitions.test.ts` — the graph, exhaustively.
- `tests/unit/shipment-apply-transition.test.ts` — the applier's contract.
- `tests/integration/shipment-lifecycle.test.ts` — the engine's decisions
  checked against the real RPC, on real rows.
- `tests/integration/dispatcher-operations.test.ts` — §27's dispatcher flow,
  create through complete.
- `tests/integration/tracking-flows.test.ts` — the composed flows, and the
  unauthorized-transition refusal.

## Extension points

Adding a status means four edits and no more: the enum in `types.ts`, a
transition list, a precondition list, and a migration adding the enum value.
Everything downstream — the board columns, the notification rules, the DTO
serializers — is driven from those, and the exhaustiveness tests will name any
that were missed.
