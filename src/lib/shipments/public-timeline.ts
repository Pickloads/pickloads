/**
 * M-73 — the §8 public progress timeline, as data.
 *
 * §8 names NINE milestones by their display wording — Quote Accepted, Carrier
 * Assigned, Dispatched, Arrived at Pickup, Picked Up, In Transit, Arrived at
 * Delivery, Delivered, POD Available — and four presentation states:
 * completed (with date and time), current (clearly highlighted), future
 * (visible but inactive) and exception (accessible warning style, honest
 * explanation, no private internal detail).
 *
 * This module turns a `PublicTrackingDto` into exactly that, and nothing else.
 * It renders no markup, holds no English string and touches no database — the
 * component in `src/components/tracking/` decides how a step LOOKS, and the
 * `shipment` catalogue decides what it SAYS in five languages.
 *
 * ── WHY MILESTONES ARE NOT STATUSES ───────────────────────────────────────
 *
 * §6 has EIGHTEEN statuses; §8 shows NINE steps. They are different lists on
 * purpose, and M-70 says so explicitly: `SHIPMENT_STATUSES` is declaration
 * order, not progress — `delayed` and `cancelled` are lifecycle states, and
 * reading an index off them would draw a truck that has gone backwards.
 *
 * So the mapping is written out per status, as a total `Record`, with a
 * `satisfies` guard. Adding a nineteenth status to §6 is then a COMPILE error
 * here rather than a shipment that silently renders as "not started".
 *
 * ── WHY `POD Available` IS A MILESTONE AND `completed` IS NOT ─────────────
 *
 * §8's ninth step is a fact the customer can act on (paperwork exists).
 * `completed` is an internal closeout state — invoice raised, detention
 * settled — that means nothing to a consignee and is not in §8's list. It maps
 * to "everything done" without adding a tenth step.
 */

import type {
  CustomerEventDto,
  PublicTrackingDto,
} from "@/lib/shipments/dto";
import {
  SHIPMENT_I18N_NAMESPACE,
  type ShipmentStatus,
} from "@/lib/shipments/types";

/** §8's nine milestones, in the directive's order. */
export const PUBLIC_MILESTONES = [
  "quote_accepted",
  "carrier_assigned",
  "dispatched",
  "arrived_at_pickup",
  "picked_up",
  "in_transit",
  "arrived_at_delivery",
  "delivered",
  "pod_uploaded",
] as const satisfies readonly ShipmentStatus[];

export type PublicMilestone = (typeof PUBLIC_MILESTONES)[number];

/**
 * Message key for a milestone LABEL — deliberately a different namespace
 * branch from `statusKey()`.
 *
 * §8's wording is not §6's wording: the milestone is "POD Available" (a fact
 * about the customer's paperwork) while the status is "POD uploaded" (a fact
 * about an operator's action), and "Arrived at Pickup" reads differently as a
 * step on a progress bar than as a status badge. One key serving both would
 * force one of the two to be wrong in five languages.
 */
export function milestoneKey(milestone: PublicMilestone): string {
  return `${SHIPMENT_I18N_NAMESPACE}.milestone.${milestone}`;
}

/**
 * How far a shipment in each status has PROGRESSED along §8's nine steps.
 *
 * The value is the index of the last milestone that is complete:
 *   -1  nothing on the public timeline has happened yet
 *    n  milestones 0…n are complete, n is the current step
 *
 * Two statuses carry sentinels because progress cannot be read off them at
 * all — see `MILESTONE_FROM_EVENTS`.
 */
const DERIVE_FROM_EVENTS = -2;
const CANCELLED = -3;

const MILESTONE_PROGRESS = {
  // Before any public milestone: a quote is not a shipment yet.
  quote_requested: -1,
  quote_sent: -1,

  quote_accepted: 0,
  // §6: still hunting a truck. The customer's last true milestone is the
  // accepted quote — showing "Carrier Assigned" as current would be a fake.
  carrier_search: 0,

  carrier_assigned: 1,
  dispatched: 2,
  // Between "dispatched" and "arrived": the truck is moving toward pickup, and
  // §8 has no separate step for it.
  en_route_to_pickup: 2,

  arrived_at_pickup: 3,
  loading: 3,

  picked_up: 4,
  in_transit: 5,

  // `delayed` is a lifecycle state, not a position. Where the truck actually
  // IS comes from the timeline (see below); rendering it as step 0 because the
  // enum happens to place it twelfth would be worse than useless.
  delayed: DERIVE_FROM_EVENTS,

  arrived_at_delivery: 6,
  unloading: 6,

  delivered: 7,
  pod_uploaded: 8,
  // Internal closeout — not a tenth step, just "everything the customer can
  // see is done".
  completed: 8,

  cancelled: CANCELLED,
} as const satisfies Record<ShipmentStatus, number>;

/** Milestone index of a status, for reading progress out of event history. */
const MILESTONE_INDEX: Partial<Record<ShipmentStatus, number>> =
  Object.fromEntries(PUBLIC_MILESTONES.map((m, i) => [m, i]));

export type MilestoneState =
  /** Reached, with a timestamp when the timeline recorded one. */
  | "complete"
  /** Where the shipment is now. §8: "clearly highlighted". */
  | "current"
  /** Where it is now, but something is wrong. §8's accessible warning state. */
  | "exception"
  /** §8: "visible but inactive". */
  | "upcoming";

export interface MilestoneStep {
  milestone: PublicMilestone;
  /** `shipment.milestone.<id>` — never an English string. */
  label_key: string;
  state: MilestoneState;
  /** ISO timestamp from the public timeline, or null if none was recorded. */
  at: string | null;
  /** 1-based position, for `aria-posinset` and the text equivalent. */
  position: number;
}

export interface PublicTimeline {
  steps: MilestoneStep[];
  /** Index of the current step, or -1 when nothing has happened yet. */
  currentIndex: number;
  /** How many steps are complete — the numerator of the text equivalent. */
  completedCount: number;
  total: number;
  /** True when the shipment is `cancelled`: no step is "current". */
  cancelled: boolean;
  /** True when the shipment is `delayed` or carries an unresolved exception. */
  exception: boolean;
}

/**
 * Earliest public event asserting each milestone status.
 *
 * EARLIEST, not latest: a shipment that goes `in_transit` → `delayed` →
 * `in_transit` has two events asserting `in_transit`, and "when did this
 * shipment start moving?" is answered by the first one. A `correction` event
 * (§20) that re-asserts a status appends rather than replaces, so taking the
 * latest would silently redate history every time an operator fixed a typo.
 */
function milestoneTimestamps(
  events: readonly CustomerEventDto[],
): Partial<Record<PublicMilestone, string>> {
  const at: Partial<Record<PublicMilestone, string>> = {};
  for (const event of events) {
    const status = event.status;
    if (status === null) continue;
    if (!(status in MILESTONE_INDEX)) continue;
    const milestone = status as PublicMilestone;
    const existing = at[milestone];
    if (existing === undefined || event.event_time < existing) {
      at[milestone] = event.event_time;
    }
  }
  return at;
}

/**
 * Highest milestone the TIMELINE proves was reached.
 *
 * Used for the two sentinel statuses. A delayed truck that has already been
 * picked up must not lose its "Picked Up" tick because dispatch flagged the
 * delay, and a cancelled shipment should still show how far it got — §7
 * forbids deleting history, and silently un-drawing it is the same lie in CSS.
 */
function reachedFromEvents(events: readonly CustomerEventDto[]): number {
  let highest = -1;
  for (const event of events) {
    const status = event.status;
    if (status === null) continue;
    const index = MILESTONE_INDEX[status];
    if (index !== undefined && index > highest) highest = index;
  }
  return highest;
}

/**
 * Build §8's progress timeline from a public DTO.
 *
 * Pure: same input, same output, no clock read. That matters for the tests —
 * "which step is current" must not depend on when the suite runs.
 */
export function buildPublicTimeline(dto: PublicTrackingDto): PublicTimeline {
  const events = dto.events;
  const timestamps = milestoneTimestamps(events);

  const mapped: number = MILESTONE_PROGRESS[dto.status];
  const cancelled = mapped === CANCELLED;
  const reached =
    mapped === DERIVE_FROM_EVENTS || cancelled
      ? reachedFromEvents(events)
      : mapped;

  const openException = dto.exceptions.some((e) => e.resolved_at === null);
  const exception = dto.status === "delayed" || openException;

  const steps: MilestoneStep[] = PUBLIC_MILESTONES.map((milestone, index) => {
    let state: MilestoneState;
    if (index < reached) {
      state = "complete";
    } else if (index === reached) {
      // A cancelled shipment has NO current step: the journey stopped, and
      // highlighting a step as "happening now" would contradict the banner
      // directly above it.
      state = cancelled ? "complete" : exception ? "exception" : "current";
    } else {
      state = "upcoming";
    }
    return {
      milestone,
      label_key: milestoneKey(milestone),
      state,
      at: timestamps[milestone] ?? null,
      position: index + 1,
    };
  });

  return {
    steps,
    currentIndex: cancelled ? -1 : reached,
    completedCount: steps.filter((s) => s.state === "complete").length,
    total: PUBLIC_MILESTONES.length,
    cancelled,
    exception,
  };
}

/**
 * The §23 TEXT EQUIVALENT, as values rather than prose.
 *
 * §23: "the visual tracking timeline must have a text equivalent for
 * assistive technologies." A sentence assembled here would be an English
 * sentence assembled in a module that has no business holding English — so
 * this returns the numbers and the key, and the component renders
 * `t('a11y.timeline_summary', …)` from the five-locale catalogue.
 *
 * `currentKey` is null for a cancelled shipment and for one that has not
 * started: both are stated by their own message, not by a step name.
 */
export interface TimelineTextEquivalent {
  completed: number;
  total: number;
  currentKey: string | null;
  currentAt: string | null;
  cancelled: boolean;
  exception: boolean;
}

export function timelineTextEquivalent(
  timeline: PublicTimeline,
): TimelineTextEquivalent {
  const current = timeline.steps.find(
    (s) => s.state === "current" || s.state === "exception",
  );
  return {
    completed: timeline.completedCount,
    total: timeline.total,
    currentKey: current ? current.label_key : null,
    currentAt: current ? current.at : null,
    cancelled: timeline.cancelled,
    exception: timeline.exception,
  };
}
