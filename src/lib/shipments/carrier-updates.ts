import {
  availableTransitions,
  isLegalEdge,
  NO_TRANSITION_FACTS,
  actorMayAssert,
  type TransitionActor,
  type TransitionFacts,
} from "@/lib/shipments/transitions";
import {
  SHIPMENT_I18N_NAMESPACE,
  type ShipmentStatus,
} from "@/lib/shipments/types";

/**
 * M-76 — §13's allowed carrier actions, as data.
 *
 * `docs/DIRECTIVE-tracking.md` §13 lists them by name: *confirm dispatch · en
 * route to pickup · arrived at pickup · loaded · departed pickup · in transit
 * · delayed · arrived at delivery · delivered · upload BOL · upload POD ·
 * update ETA · submit exception.* This module is that list, in one place, for
 * both surfaces that render it (the carrier portal and the driver link) and
 * for the server actions that execute it.
 *
 * PLAIN MODULE by design (no `server-only`), for the reason `transitions.ts`
 * is one: the carrier detail view and the driver page are client components
 * and need the same vocabulary the server enforces. A second copy in JSX is
 * the drift this file exists to prevent.
 *
 * ── §13's WORDS ARE NOT §6's STATUSES, AND THE MAPPING MATTERS ────────────
 *
 * Four of §13's phrases are not status names at all, and guessing at them
 * would have produced a surface that offers illegal edges:
 *
 *   | §13 says            | §6 status            | why |
 *   |---------------------|----------------------|-----|
 *   | "confirm dispatch"  | `dispatched`         | the carrier accepting the run |
 *   | "loaded"            | `loading`            | the truck is under the freight; `picked_up` is when it leaves |
 *   | "departed pickup"   | `picked_up`          | §6's `picked_up` IS the departure milestone |
 *   | "delivered"         | `delivered`          | reachable only via `unloading` — see below |
 *
 * `unloading` is a TWELFTH action §13 does not name, and it has to exist:
 * §6's graph routes `arrived_at_delivery → unloading → delivered`, so a
 * surface offering §13's "arrived at delivery" and §13's "delivered" with
 * nothing between them would offer an edge M-72 refuses. §13 says its list
 * "may include", so adding the step the graph requires is completing the
 * list, not widening it.
 *
 * ── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────
 *
 * **upload BOL** and **upload POD** are §13 actions and are not in this list
 * — not because they are missing, but because they are not TRANSITIONS. M-77
 * built them as their own forms (`DocumentUploadForm` on the carrier surface,
 * the `DriverForm` block on the driver link), driven by
 * `CARRIER_UPLOADABLE_DOC_TYPES` / `DRIVER_UPLOADABLE_DOC_TYPES` in
 * `src/lib/shipments/documents.ts`. Folding a file upload into a list whose
 * every other member is a status move would have made `carrierAction()` return
 * something with no `status` and no `kind` the engine understands.
 *
 * `pod_uploaded` is likewise absent from `ACTOR_PERMITTED_TARGETS.carrier` and
 * stays that way after M-77: §20 requires an APPROVED POD, approval is a staff
 * act, and a carrier who could make the transition would be approving their
 * own proof of delivery.
 *
 * ── WHY A CARRIER'S ACTION LIST IS NOT `availableTransitions` ALONE ───────
 *
 * Two of §13's actions are not transitions: "update ETA" writes M-71's ETA
 * columns through 0022's function, and "submit exception" appends an
 * `exception_opened` event. Rendering only the transition graph would silently
 * drop both. So the list is actions, each of which knows what kind of write
 * it is, and the TRANSITION ones are filtered through
 * `availableTransitions(status, actor, facts)` — M-72's own instruction —
 * so a button the engine would refuse is never drawn. The refusal still
 * exists on the server, because a hidden button is not a control.
 */

/* ------------------------------------------------------------------ *
 * The action vocabulary
 * ------------------------------------------------------------------ */

export type CarrierActionId =
  | "confirm_dispatch"
  | "en_route_to_pickup"
  | "arrived_at_pickup"
  | "loaded"
  | "departed_pickup"
  | "in_transit"
  | "delayed"
  | "arrived_at_delivery"
  | "unloading"
  | "delivered"
  | "update_eta"
  | "submit_exception";

export type CarrierActionKind = "transition" | "eta" | "exception";

/** The two actors §13's surfaces run as. Both are M-72 `TransitionActor`s. */
export type CarrierUpdateActor = Extract<TransitionActor, "carrier" | "driver">;

export const CARRIER_UPDATE_ACTORS = [
  "carrier",
  "driver",
] as const satisfies readonly CarrierUpdateActor[];

export interface CarrierUpdateAction {
  id: CarrierActionId;
  kind: CarrierActionKind;
  /** Present exactly when `kind === "transition"`. */
  status: ShipmentStatus | null;
  /** i18n key — nothing customer-facing is spelled in English in this module. */
  labelKey: string;
  /**
   * Which actors may invoke it. `carrier` alone means the driver link cannot,
   * which is true of exactly one action — see `confirm_dispatch`.
   */
  actors: readonly CarrierUpdateActor[];
}

const BOTH: readonly CarrierUpdateActor[] = ["carrier", "driver"];
const CARRIER_ONLY: readonly CarrierUpdateActor[] = ["carrier"];

function actionKey(id: CarrierActionId): string {
  return `${SHIPMENT_I18N_NAMESPACE}.action.${id}`;
}

/**
 * §13's list, in §13's order, with `unloading` inserted where the graph puts
 * it. Order is load-bearing: both surfaces render it as-is, so it reads as
 * the sequence of a real trip rather than as an alphabetised menu.
 */
export const CARRIER_UPDATE_ACTIONS: readonly CarrierUpdateAction[] = [
  {
    // CARRIER ONLY. Confirming dispatch commits a company to a load; the
    // driver token is a bearer credential in a truck (see M-76's threat
    // model) and must not be able to accept freight on its employer's behalf.
    // M-72's `ACTOR_PERMITTED_TARGETS` enforces the same split independently.
    id: "confirm_dispatch",
    kind: "transition",
    status: "dispatched",
    labelKey: actionKey("confirm_dispatch"),
    actors: CARRIER_ONLY,
  },
  {
    id: "en_route_to_pickup",
    kind: "transition",
    status: "en_route_to_pickup",
    labelKey: actionKey("en_route_to_pickup"),
    actors: BOTH,
  },
  {
    id: "arrived_at_pickup",
    kind: "transition",
    status: "arrived_at_pickup",
    labelKey: actionKey("arrived_at_pickup"),
    actors: BOTH,
  },
  {
    id: "loaded",
    kind: "transition",
    status: "loading",
    labelKey: actionKey("loaded"),
    actors: BOTH,
  },
  {
    id: "departed_pickup",
    kind: "transition",
    status: "picked_up",
    labelKey: actionKey("departed_pickup"),
    actors: BOTH,
  },
  {
    id: "in_transit",
    kind: "transition",
    status: "in_transit",
    labelKey: actionKey("in_transit"),
    actors: BOTH,
  },
  {
    id: "delayed",
    kind: "transition",
    status: "delayed",
    labelKey: actionKey("delayed"),
    actors: BOTH,
  },
  {
    id: "arrived_at_delivery",
    kind: "transition",
    status: "arrived_at_delivery",
    labelKey: actionKey("arrived_at_delivery"),
    actors: BOTH,
  },
  {
    id: "unloading",
    kind: "transition",
    status: "unloading",
    labelKey: actionKey("unloading"),
    actors: BOTH,
  },
  {
    id: "delivered",
    kind: "transition",
    status: "delivered",
    labelKey: actionKey("delivered"),
    actors: BOTH,
  },
  {
    id: "update_eta",
    kind: "eta",
    status: null,
    labelKey: actionKey("update_eta"),
    actors: BOTH,
  },
  {
    id: "submit_exception",
    kind: "exception",
    status: null,
    labelKey: actionKey("submit_exception"),
    actors: BOTH,
  },
];

/** Lookup by id. Returns null for anything not in the list — never throws. */
export function carrierAction(id: unknown): CarrierUpdateAction | null {
  if (typeof id !== "string") return null;
  return CARRIER_UPDATE_ACTIONS.find((action) => action.id === id) ?? null;
}

/** Every action id, for Zod enums and for the exhaustiveness tests. */
export const CARRIER_ACTION_IDS = CARRIER_UPDATE_ACTIONS.map(
  (a) => a.id,
) as readonly CarrierActionId[];

/* ------------------------------------------------------------------ *
 * The matrix
 * ------------------------------------------------------------------ */

/** Is this action in this actor's list at all? Ignores the shipment. */
export function actorMayInvoke(
  actor: CarrierUpdateActor,
  action: CarrierUpdateAction,
): boolean {
  return action.actors.includes(actor);
}

/**
 * The actions a surface may OFFER right now.
 *
 * Three filters, in order, and the order is the argument:
 *
 *   1. the actor's own list (§13 gives a driver less than a carrier);
 *   2. for transitions, `availableTransitions` — M-72's graph, actor gate and
 *      preconditions, evaluated against the facts the caller resolved;
 *   3. nothing else. A non-transition action is offered whenever the shipment
 *      is not terminal, because an ETA update or an exception on a completed
 *      shipment is noise, not information.
 *
 * The server re-evaluates all of it. This function decides what to DRAW.
 */
export function offeredCarrierActions(
  actor: CarrierUpdateActor,
  status: ShipmentStatus,
  facts: TransitionFacts = NO_TRANSITION_FACTS,
): readonly CarrierUpdateAction[] {
  const reachable = new Set<ShipmentStatus>(
    availableTransitions(status, actor, facts),
  );
  const terminal = status === "completed" || status === "cancelled";
  return CARRIER_UPDATE_ACTIONS.filter((action) => {
    if (!actorMayInvoke(actor, action)) return false;
    if (action.kind !== "transition") return !terminal;
    return action.status !== null && reachable.has(action.status);
  });
}

/**
 * Why an action is unavailable, as a machine code, for the server's refusal
 * message. Never thrown, never a boolean — the same contract M-72 set.
 *
 * `unknown_action` first, because an id that is not in the vocabulary is a
 * different problem from an id that is not permitted, and telling a caller
 * "not permitted" for a typo sends them down the wrong path.
 */
export type CarrierActionRefusal =
  | "unknown_action"
  | "actor_not_permitted"
  | "not_available_now"
  | "terminal_status";

/**
 * The subset of refusals that do NOT depend on §20 facts.
 *
 * Callers check these FIRST, with no `facts` argument, so an action the actor
 * may never invoke costs zero database reads — §25's "no N+1" applied to the
 * refusal path, and the reason an enumeration attempt through a driver link is
 * cheap for us and expensive for them.
 */
export const FACT_INDEPENDENT_REFUSALS: readonly CarrierActionRefusal[] = [
  "unknown_action",
  "actor_not_permitted",
  "terminal_status",
];

export function isFactIndependent(
  refusal: CarrierActionRefusal | null,
): refusal is CarrierActionRefusal {
  return refusal !== null && FACT_INDEPENDENT_REFUSALS.includes(refusal);
}

export function refuseCarrierAction(
  actor: CarrierUpdateActor,
  actionId: unknown,
  status: ShipmentStatus,
  facts: TransitionFacts = NO_TRANSITION_FACTS,
): CarrierActionRefusal | null {
  const action = carrierAction(actionId);
  if (action === null) return "unknown_action";
  if (!actorMayInvoke(actor, action)) return "actor_not_permitted";
  if (status === "completed" || status === "cancelled") return "terminal_status";
  if (action.kind !== "transition") return null;
  if (action.status === null) return "unknown_action";
  // Split so the message can distinguish "you may never do this" from "not
  // from where this shipment is right now" — the first is a permissions
  // answer, the second is an operational one, and a carrier reading them
  // needs different next steps.
  if (!actorMayAssert(actor, action.status)) return "actor_not_permitted";
  if (!isLegalEdge(status, action.status)) return "not_available_now";
  const reachable = availableTransitions(status, actor, facts);
  return reachable.includes(action.status) ? null : "not_available_now";
}

/**
 * §19's other half, stated as a constant so a test can assert it.
 *
 * *"Carrier updates must be limited to approved fields and transitions."* The
 * transitions half is above. The FIELDS half is structural and this list
 * names what "structural" means here: no server action in M-76 accepts any of
 * these as a parameter, and 0018 gives carriers no UPDATE policy on
 * `shipments`, so there is no path from a carrier session to any of them.
 *
 * `tests/unit/carrier-shipment-actions.test.ts` walks every exported action's
 * FormData keys and asserts none of these names appears.
 */
export const CARRIER_FORBIDDEN_FIELDS = [
  "gross_shipper_amount",
  "carrier_pay",
  "margin",
  "shipper_id",
  "dispatcher_id",
  "broker_partner_id",
  "tracking_number",
  "public_access_hash",
  "delay_reason_internal",
] as const;

/* ------------------------------------------------------------------ *
 * Refusal vocabulary
 *
 * Declared HERE rather than beside the actions that return them, for the same
 * reason M-73 declared its rate-limit policy in `public-lookup.ts`: a
 * `"use server"` module may only export async functions, and these are values
 * the tests, the components and the docs need to read by name.
 * ------------------------------------------------------------------ */

/**
 * §13's refusals, in the words a CARRIER can act on.
 *
 * Split from the engine's own messages deliberately: M-72's sentences are
 * written for an operator who knows what a precondition is ("pickup has not
 * been confirmed — record arrival at or loading at the pickup facility
 * first"). A carrier reading that is fine; a carrier reading "actor not
 * permitted" is not, so that one is rewritten.
 *
 * ENGLISH, because the carrier portal is English throughout (M-23's scope
 * decision, unchanged since). The DRIVER page is the surface §24 makes
 * five-locale, and its refusals are message KEYS — see below.
 */
export const CARRIER_REFUSAL_MESSAGES: Record<CarrierActionRefusal, string> = {
  unknown_action: "That update isn't one we can record. Refresh and try again.",
  actor_not_permitted:
    "Carriers can't make that change — call dispatch on (908) 404-5373 and we'll do it.",
  not_available_now:
    "That update doesn't fit where this shipment is right now. Refresh the page and check the current status.",
  terminal_status:
    "This shipment is closed. Call dispatch on (908) 404-5373 if something needs correcting.",
};

export const CARRIER_STALE_PAGE_MESSAGE =
  "Someone else updated this shipment while this page was open. Refresh and check the status before trying again.";

/**
 * The DRIVER page's refusals, as i18n KEYS rather than sentences.
 *
 * §24 makes the driver surface five-locale and the plan calls drivers
 * "exactly the population the 5-locale requirement exists for". A server
 * action returning an English string would make every refusal English
 * whatever the page's language — so the actions return these keys and the
 * component resolves them, which is M-73's rule for `/track` applied where it
 * matters most.
 *
 * `DRIVER_LINK_EXPIRED_KEY` is the ONE key for four causes (unknown, expired,
 * revoked, carrier released). §13 requires non-enumerability; the page also
 * renders §30's authored `label.tracking_link_expired` as the heading above it.
 */
export const DRIVER_LINK_EXPIRED_KEY = "shipment.driver.expired_body";
export const DRIVER_RATE_LIMITED_KEY = "shipment.driver.rate_limited";
export const DRIVER_UNAVAILABLE_KEY = "shipment.driver.unavailable";
export const DRIVER_STALE_KEY = "shipment.driver.stale";
export const DRIVER_CONSENT_REQUIRED_KEY = "shipment.driver.consent_required";
export const DRIVER_NOT_ALLOWED_KEY = "shipment.driver.not_allowed";
export const DRIVER_NOT_NOW_KEY = "shipment.driver.not_now";
export const DRIVER_INVALID_KEY = "shipment.driver.invalid";
export const DRIVER_SAVED_KEY = "shipment.driver.saved";
export const DRIVER_REPORTED_KEY = "shipment.driver.reported";
export const DRIVER_CONSENT_ON_KEY = "shipment.driver.consent_on";
export const DRIVER_CONSENT_OFF_KEY = "shipment.driver.consent_off";
