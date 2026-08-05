/**
 * M-72 — shipment status-transition engine (`docs/DIRECTIVE-tracking.md` §20,
 * with §6's lifecycle, §7's event model and §19's authorization boundary).
 *
 * §20 opens with *"Create server-side status-transition validation"* and then
 * names three separate things: a graph of legal edges, a set of preconditions
 * that gate particular targets, and a list of transitions that must be
 * impossible. This module is all three, and nothing else — it does not read a
 * database, does not write an event, and does not know what a Supabase client
 * is. `src/lib/shipments/apply-transition.ts` is the server layer that feeds
 * it facts and turns its verdict into a durable write.
 *
 * WHY IT LIVES HERE AND NOT IN SQL. `src/lib/loads.ts` established the idiom:
 * `LOAD_TRANSITIONS` is a `Record<LoadStatus, readonly LoadStatus[]>` in a
 * plain module that server actions, RSC pages and client components all read.
 * The reasons carry over intact and get stronger with 18 statuses instead of
 * six: the dispatcher board (M-75) needs to know which buttons to render, the
 * carrier surface (M-76) needs to know which subset it may offer, and M-73's
 * public page needs the vocabulary. A copy of the graph in PL/pgSQL would be a
 * second specification, and the first divergence would be silent. What the
 * database DOES own is in migration 0019: atomicity, compare-and-swap,
 * idempotency and the append-only ledger — the guarantees TypeScript cannot
 * make.
 *
 * PLAIN MODULE by design (no `server-only`), for the same reason `types.ts` is
 * one. Nothing here is a secret; every value is a product rule.
 *
 * EXHAUSTIVENESS. `SHIPMENT_TRANSITIONS`, `STATUS_PRECONDITIONS` and
 * `ACTOR_PERMITTED_TARGETS` are declared as full `Record<…>` types over their
 * key unions. Adding a 19th status to `ShipmentStatus` without giving it a
 * transition list is a COMPILE ERROR, not a runtime surprise —
 * `tests/unit/shipment-transitions.test.ts` also proves it at runtime, because
 * a compile-time guarantee that nobody has written a test for tends to be
 * disabled by the first `as` somebody reaches for.
 *
 * EVERY REJECTION IS TYPED AND EXPLAINABLE. `evaluateTransition` never throws
 * and never returns a bare `false`: a refusal carries a machine code, the
 * offending edge, the actor and an operator-readable sentence. A silent no-op
 * on a dispatcher board is how freight ends up in a status nobody chose.
 */

import {
  SHIPMENT_STATUSES,
  type ShipmentStatus,
} from "@/lib/shipments/types";

/* ------------------------------------------------------------------ *
 * The graph (§6 lifecycle → §20 legal edges)
 * ------------------------------------------------------------------ */

/**
 * Which statuses may follow which.
 *
 * This is NOT `SHIPMENT_STATUSES` with arrows drawn between neighbours, and
 * M-70's own documentation says why: *"`SHIPMENT_STATUSES` is declaration
 * order, not a transition graph — `delayed` and `cancelled` are lifecycle
 * states, not milestones."* Two consequences shape the whole table:
 *
 *   * `delayed` is a DETOUR, not a step. It is reachable from every
 *     operational status from `dispatched` onward, and it returns to any of
 *     them — a truck delayed on the way to pickup resumes `en_route_to_pickup`;
 *     one delayed at the receiver resumes `unloading`. Treating it as position
 *     12 of 18 would mean a delayed shipment had "progressed past" `in_transit`,
 *     which is the opposite of what happened.
 *   * `cancelled` is reachable from everything that has not yet delivered, and
 *     from nothing after. It is terminal.
 *
 * Three edges are deliberate and worth defending:
 *
 *   * `carrier_assigned → carrier_search` and `dispatched → carrier_search`.
 *     §6 requires "carrier reassignment" to be supported. A carrier that falls
 *     through before pickup sends the shipment back to the search desk; the
 *     assignment row is released (M-71's partial unique index makes that a new
 *     row, never an edit) and the history keeps both.
 *   * `delivered → completed` WITHOUT `pod_uploaded`. §6 says "not every
 *     shipment must use every status" and lists "missing POD" among the
 *     scenarios the system must support. The edge exists; the `completed`
 *     precondition is what stops it being used carelessly.
 *   * `delivered` has NO edge to `cancelled`. Freight that has been delivered
 *     cannot be un-shipped. A delivery that turns out to have been recorded in
 *     error is a CORRECTION (§20, `applyShipmentCorrection`), not a transition.
 */
export const SHIPMENT_TRANSITIONS: Record<
  ShipmentStatus,
  readonly ShipmentStatus[]
> = {
  quote_requested: ["quote_sent", "cancelled"],
  quote_sent: ["quote_accepted", "cancelled"],
  // §20 verbatim: "`quote_accepted` may move to `carrier_search`".
  quote_accepted: ["carrier_search", "cancelled"],
  carrier_search: ["carrier_assigned", "cancelled"],
  carrier_assigned: ["dispatched", "carrier_search", "cancelled"],
  dispatched: ["en_route_to_pickup", "carrier_search", "delayed", "cancelled"],
  en_route_to_pickup: ["arrived_at_pickup", "delayed", "cancelled"],
  arrived_at_pickup: ["loading", "delayed", "cancelled"],
  loading: ["picked_up", "delayed", "cancelled"],
  picked_up: ["in_transit", "delayed", "cancelled"],
  in_transit: ["arrived_at_delivery", "delayed", "cancelled"],
  // The detour returns to whichever operational status the shipment was in.
  delayed: [
    "en_route_to_pickup",
    "arrived_at_pickup",
    "loading",
    "picked_up",
    "in_transit",
    "arrived_at_delivery",
    "unloading",
    "cancelled",
  ],
  arrived_at_delivery: ["unloading", "delayed", "cancelled"],
  unloading: ["delivered", "delayed", "cancelled"],
  delivered: ["pod_uploaded", "completed"],
  pod_uploaded: ["completed"],
  completed: [],
  cancelled: [],
};

/** Statuses with no outbound edge at all. */
export const TERMINAL_SHIPMENT_STATUSES = [
  "completed",
  "cancelled",
] as const satisfies readonly ShipmentStatus[];

export function isTerminalStatus(status: ShipmentStatus): boolean {
  return (TERMINAL_SHIPMENT_STATUSES as readonly ShipmentStatus[]).includes(
    status,
  );
}

/** Legal next statuses from `from`, ignoring preconditions and actor. */
export function nextStatuses(from: ShipmentStatus): readonly ShipmentStatus[] {
  return SHIPMENT_TRANSITIONS[from];
}

/** Is the EDGE legal? Says nothing about preconditions or who is asking. */
export function isLegalEdge(
  from: ShipmentStatus,
  to: ShipmentStatus,
): boolean {
  return SHIPMENT_TRANSITIONS[from].includes(to);
}

/* ------------------------------------------------------------------ *
 * §20's impossible-transition list
 * ------------------------------------------------------------------ */

/**
 * Transitions that must never be possible, enumerated because §20 asks for
 * them by name and because "it is absent from the graph" is a claim worth
 * testing rather than assuming.
 *
 * The first entry is §20's own example. The rest are the same failure mode in
 * the shapes it actually takes: rewinding a delivered shipment, skipping the
 * carrier entirely, walking a terminal status back into the lifecycle.
 *
 * `tests/unit/shipment-transitions.test.ts` asserts every pair here is refused
 * by `evaluateTransition` with `illegal_transition` (or `terminal_status`),
 * so the list cannot rot into documentation.
 */
export const IMPOSSIBLE_TRANSITIONS: readonly (readonly [
  ShipmentStatus,
  ShipmentStatus,
])[] = [
  // §20 verbatim.
  ["delivered", "carrier_search"],
  // Rewinding delivery by any other route.
  ["delivered", "in_transit"],
  ["delivered", "quote_requested"],
  ["pod_uploaded", "delivered"],
  ["completed", "in_transit"],
  ["completed", "cancelled"],
  ["cancelled", "carrier_search"],
  ["cancelled", "quote_requested"],
  // Skipping the parts of the lifecycle that create the obligation.
  ["quote_requested", "in_transit"],
  ["quote_requested", "delivered"],
  ["quote_accepted", "picked_up"],
  ["carrier_search", "picked_up"],
  ["carrier_search", "in_transit"],
  ["in_transit", "carrier_search"],
  ["in_transit", "completed"],
  ["loading", "delivered"],
  // Freight that has arrived cannot be un-shipped (see the graph note).
  ["delivered", "cancelled"],
];

/**
 * §20's list also names three things that are NOT edges in this graph, and
 * this constant exists so nobody looks for them here and concludes they were
 * missed. Each is enforced somewhere else, structurally:
 *
 *   * *"public user marking a shipment paid"* — there is no `paid` status on a
 *     shipment at all (`paid` belongs to `loads`, a different table and a
 *     different legal activity per plan §1), and 0018/0019 give anon no policy
 *     and no EXECUTE grant, so a public user cannot write any status.
 *   * *"carrier changing shipper financial data"* — the engine writes exactly
 *     two things, a status and an event. `gross_shipper_amount`, `carrier_pay`
 *     and `margin` are not parameters of any function in migration 0019, and
 *     0018 gives carriers no UPDATE policy on `shipments`.
 *   * *"driver marking another carrier's shipment delivered"* — the actor gate
 *     below limits what a `driver` may assert, and M-76's token is scoped to
 *     one shipment; the RLS suite proves the cross-carrier write touches zero
 *     rows.
 */
export const OUT_OF_GRAPH_PROHIBITIONS = [
  "public_user_marks_paid",
  "carrier_edits_shipper_financials",
  "driver_updates_another_carriers_shipment",
] as const;

/* ------------------------------------------------------------------ *
 * §20 preconditions
 * ------------------------------------------------------------------ */

/**
 * The named preconditions of §20, one code per sentence the directive writes.
 *
 * Codes are stable machine identifiers; the human sentence lives in
 * `PRECONDITION_MESSAGES` and, when M-73 renders one to a customer, in the
 * five locale catalogues. Nothing customer-facing is spelled in English here.
 */
export type PreconditionCode =
  | "carrier_assignment_required"
  | "pickup_confirmation_required"
  | "delivery_timestamp_required"
  | "approved_pod_required"
  | "delivery_required"
  | "closeout_required"
  | "cancellation_reason_required";

/**
 * The facts a transition is judged against.
 *
 * Every field is resolved by `shipment_transition_facts()` (migration 0019) in
 * ONE query — §25 forbids N+1 — except the two the plan explicitly assigns to
 * later modules, which the caller supplies:
 *
 *   * `approvedPodDocumentId` — M-77 owns `shipment_documents`. Today the SQL
 *     returns null, so `pod_uploaded` is REFUSED. A precondition that cannot
 *     be evaluated must fail, never pass: the alternative is a status that
 *     claims an approved POD exists when no document table does. M-77
 *     completes it by pointing the fact at the real row (the exact expression
 *     is written out in 0019's comment) — no change to this file.
 *   * `closeoutCompletedAt` — operational closeout is a human assertion
 *     (paperwork in, detention settled, invoice raised), not a derivable fact.
 *     M-75's dispatcher surface asserts it explicitly; absent means not done.
 */
export interface TransitionFacts {
  /** An unreleased `shipment_assignments` row, if one exists. */
  activeAssignmentId: string | null;
  /** The most recent recorded arrival/loading event at the pickup facility. */
  pickupConfirmedAt: string | null;
  /** The delivery timestamp the CURRENT transition is asserting. */
  deliveryTimestamp: string | null;
  /** The delivery timestamp already recorded in the timeline. */
  deliveredAt: string | null;
  /** M-77. Null until documents exist — see above. */
  approvedPodDocumentId: string | null;
  /** M-75 asserts it. Null means "not closed out". */
  closeoutCompletedAt: string | null;
  /** §20: `cancelled` must record one. Blank counts as absent. */
  cancellationReason: string | null;
}

/** Facts with nothing established — the safe base a caller merges onto. */
export const NO_TRANSITION_FACTS: TransitionFacts = {
  activeAssignmentId: null,
  pickupConfirmedAt: null,
  deliveryTimestamp: null,
  deliveredAt: null,
  approvedPodDocumentId: null,
  closeoutCompletedAt: null,
  cancellationReason: null,
};

/**
 * Which preconditions gate which TARGET status. §20's five sentences, plus
 * `completed`'s conjunction split into its two halves so a refusal can say
 * which one failed.
 *
 * Full `Record` over `ShipmentStatus`: a new status must state, explicitly,
 * that it has no preconditions.
 */
export const STATUS_PRECONDITIONS: Record<
  ShipmentStatus,
  readonly PreconditionCode[]
> = {
  quote_requested: [],
  quote_sent: [],
  quote_accepted: [],
  carrier_search: [],
  // §20: "`carrier_assigned` requires a carrier assignment."
  carrier_assigned: ["carrier_assignment_required"],
  dispatched: [],
  en_route_to_pickup: [],
  arrived_at_pickup: [],
  loading: [],
  // §20: "`picked_up` should require pickup confirmation."
  picked_up: ["pickup_confirmation_required"],
  in_transit: [],
  delayed: [],
  arrived_at_delivery: [],
  unloading: [],
  // §20: "`delivered` may require delivery timestamp."
  delivered: ["delivery_timestamp_required"],
  // §20: "`pod_uploaded` requires an approved POD document."
  pod_uploaded: ["approved_pod_required"],
  // §20: "`completed` should require delivery and the required operational
  // closeout." Two codes, so the operator is told which half is missing.
  completed: ["delivery_required", "closeout_required"],
  // §20: "`cancelled` must record a cancellation reason."
  cancelled: ["cancellation_reason_required"],
};

const PRECONDITION_MESSAGES: Record<PreconditionCode, string> = {
  carrier_assignment_required:
    "no open carrier assignment exists on this shipment",
  pickup_confirmation_required:
    "pickup has not been confirmed — record arrival at or loading at the pickup facility first",
  delivery_timestamp_required:
    "a delivery timestamp is required to mark this shipment delivered",
  approved_pod_required:
    "no approved POD document exists on this shipment (document approval is M-77)",
  delivery_required: "this shipment has no recorded delivery event",
  closeout_required: "operational closeout has not been confirmed",
  cancellation_reason_required: "a cancellation reason is required",
};

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

/** Does `facts` satisfy `code`? Pure, and the only place the rule is written. */
function satisfies(code: PreconditionCode, facts: TransitionFacts): boolean {
  switch (code) {
    case "carrier_assignment_required":
      return !isBlank(facts.activeAssignmentId);
    case "pickup_confirmation_required":
      return !isBlank(facts.pickupConfirmedAt);
    case "delivery_timestamp_required":
      return !isBlank(facts.deliveryTimestamp);
    case "approved_pod_required":
      return !isBlank(facts.approvedPodDocumentId);
    case "delivery_required":
      return !isBlank(facts.deliveredAt);
    case "closeout_required":
      return !isBlank(facts.closeoutCompletedAt);
    case "cancellation_reason_required":
      return !isBlank(facts.cancellationReason);
  }
}

/**
 * Every precondition of `to` that `facts` does NOT satisfy, in declaration
 * order. Empty means the target is reachable as far as preconditions go.
 */
export function unmetPreconditions(
  to: ShipmentStatus,
  facts: TransitionFacts,
): readonly PreconditionCode[] {
  return STATUS_PRECONDITIONS[to].filter((code) => !satisfies(code, facts));
}

/* ------------------------------------------------------------------ *
 * §19 actor gate
 * ------------------------------------------------------------------ */

/**
 * Who is asserting the transition.
 *
 * Deliberately NOT `UserRole` (0001's enum) and NOT `ShipmentEventSource`
 * (§7's list). It is the intersection that matters for authorization: a
 * `driver` is not a `profiles.role` at all (M-76 reaches them through a
 * scoped token), and `eld`/`gps` are provider sources that never assert a
 * status through this engine — M-80's location events carry no status.
 */
export type TransitionActor =
  | "admin"
  | "dispatcher"
  | "carrier"
  | "driver"
  | "shipper"
  | "system";

export const TRANSITION_ACTORS = [
  "admin",
  "dispatcher",
  "carrier",
  "driver",
  "shipper",
  "system",
] as const satisfies readonly TransitionActor[];

/** Sentinel meaning "every status the graph allows". */
const ALL_TARGETS = "*" as const;

/**
 * §19: *"Carrier updates must be limited to approved fields and transitions."*
 * §20's impossible list names two actor failures directly (a public user
 * marking a shipment paid, a driver acting on another carrier's shipment).
 *
 * This table is the "approved transitions" half. The "approved fields" half is
 * structural: the engine writes a status and an event, and nothing else.
 *
 * Narrow on purpose. A carrier and a driver may report what is happening to
 * the truck; they may not accept quotes, assign themselves, complete a
 * shipment (closeout is a brokerage act) or cancel one (that is a commercial
 * decision, and a carrier walking away is a `dispatched → carrier_search`
 * reassignment a dispatcher records). A shipper may accept their own quote and
 * nothing else. `system` may raise a delay, which is what M-79's late-delivery
 * sweep needs; M-77 and M-79 widen it EXPLICITLY when they land, by editing
 * this table in a reviewed diff.
 */
export const ACTOR_PERMITTED_TARGETS: Record<
  TransitionActor,
  readonly ShipmentStatus[] | typeof ALL_TARGETS
> = {
  admin: ALL_TARGETS,
  dispatcher: ALL_TARGETS,
  carrier: [
    "en_route_to_pickup",
    "arrived_at_pickup",
    "loading",
    "picked_up",
    "in_transit",
    "delayed",
    "arrived_at_delivery",
    "unloading",
    "delivered",
  ],
  driver: [
    "en_route_to_pickup",
    "arrived_at_pickup",
    "loading",
    "picked_up",
    "in_transit",
    "delayed",
    "arrived_at_delivery",
    "unloading",
    "delivered",
  ],
  shipper: ["quote_accepted"],
  system: ["delayed"],
};

export function actorMayAssert(
  actor: TransitionActor,
  to: ShipmentStatus,
): boolean {
  const allowed = ACTOR_PERMITTED_TARGETS[actor];
  return allowed === ALL_TARGETS || allowed.includes(to);
}

/** Only `admin` may run §20's controlled correction flow. */
export function actorMayCorrect(actor: TransitionActor): boolean {
  return actor === "admin";
}

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

export type TransitionRejectionCode =
  /** `from === to` — nothing to record, and an event would claim otherwise. */
  | "same_status"
  /** `from` is `completed` or `cancelled`; nothing follows it. */
  | "terminal_status"
  /** The edge is not in the graph. */
  | "illegal_transition"
  /** The edge is legal but this actor may not assert it (§19). */
  | "actor_not_permitted"
  /** The edge and the actor are fine; a §20 precondition is not met. */
  | "precondition_failed";

export interface TransitionAccepted {
  ok: true;
  from: ShipmentStatus;
  to: ShipmentStatus;
  actor: TransitionActor;
}

export interface TransitionRejected {
  ok: false;
  code: TransitionRejectionCode;
  from: ShipmentStatus;
  to: ShipmentStatus;
  actor: TransitionActor;
  /** Present exactly when `code === "precondition_failed"`. */
  preconditions?: readonly PreconditionCode[];
  /** Operator-readable, never customer-facing (§24 owns customer strings). */
  message: string;
}

export type TransitionDecision = TransitionAccepted | TransitionRejected;

export interface TransitionRequest {
  from: ShipmentStatus;
  to: ShipmentStatus;
  actor: TransitionActor;
  facts?: TransitionFacts;
}

/**
 * The single entry point. Never throws, never returns a bare boolean.
 *
 * Order matters and is chosen so the message names the FIRST thing wrong
 * rather than the most technical: a dispatcher who tries `completed` from
 * `in_transit` is told the edge does not exist, not that closeout is missing —
 * the closeout is irrelevant to a transition that could never happen.
 */
export function evaluateTransition(
  request: TransitionRequest,
): TransitionDecision {
  const { from, to, actor } = request;
  const facts = request.facts ?? NO_TRANSITION_FACTS;

  if (from === to) {
    return {
      ok: false,
      code: "same_status",
      from,
      to,
      actor,
      message: `shipment is already ${from}; a status change to itself would record an event for something that did not happen`,
    };
  }

  if (isTerminalStatus(from)) {
    return {
      ok: false,
      code: "terminal_status",
      from,
      to,
      actor,
      message: `${from} is terminal; a shipment cannot leave it except through the §20 admin correction flow`,
    };
  }

  if (!isLegalEdge(from, to)) {
    return {
      ok: false,
      code: "illegal_transition",
      from,
      to,
      actor,
      message: `${from} → ${to} is not a legal transition (allowed: ${
        SHIPMENT_TRANSITIONS[from].join(", ") || "none"
      })`,
    };
  }

  if (!actorMayAssert(actor, to)) {
    return {
      ok: false,
      code: "actor_not_permitted",
      from,
      to,
      actor,
      message: `a ${actor} may not set a shipment to ${to} (DIRECTIVE-tracking §19)`,
    };
  }

  const unmet = unmetPreconditions(to, facts);
  if (unmet.length > 0) {
    return {
      ok: false,
      code: "precondition_failed",
      from,
      to,
      actor,
      preconditions: unmet,
      message: `${to} requires: ${unmet
        .map((code) => PRECONDITION_MESSAGES[code])
        .join("; ")}`,
    };
  }

  return { ok: true, from, to, actor };
}

/**
 * Convenience for UI: which targets can this actor offer right now, given the
 * facts? M-75's board and M-76's carrier surface render exactly this list, so
 * a button that would be refused is never drawn in the first place — while the
 * refusal still exists on the server, because a hidden button is not a control.
 */
export function availableTransitions(
  from: ShipmentStatus,
  actor: TransitionActor,
  facts: TransitionFacts = NO_TRANSITION_FACTS,
): readonly ShipmentStatus[] {
  return SHIPMENT_TRANSITIONS[from].filter(
    (to) => evaluateTransition({ from, to, actor, facts }).ok,
  );
}

/**
 * Runtime companion to the compile-time exhaustiveness of the `Record` types.
 * Returns the statuses that are missing a transition list or that appear as a
 * target without being a declared status. Used by the unit suite; exported so
 * a future module can assert the same invariant after extending the enum.
 */
export function graphIntegrityProblems(): readonly string[] {
  const problems: string[] = [];
  const known = new Set<string>(SHIPMENT_STATUSES);
  for (const status of SHIPMENT_STATUSES) {
    if (!(status in SHIPMENT_TRANSITIONS)) {
      problems.push(`no transition list for ${status}`);
      continue;
    }
    for (const target of SHIPMENT_TRANSITIONS[status]) {
      if (!known.has(target)) {
        problems.push(`${status} → ${target} is not a declared status`);
      }
    }
    if (!(status in STATUS_PRECONDITIONS)) {
      problems.push(`no precondition list for ${status}`);
    }
  }
  for (const key of Object.keys(SHIPMENT_TRANSITIONS)) {
    if (!known.has(key)) problems.push(`${key} is not a declared status`);
  }
  return problems;
}
