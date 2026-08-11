/**
 * M-70 — shipment domain types. The single source of truth for the tracking
 * system's vocabulary (`docs/DIRECTIVE-tracking.md` §§5–10, 16, 18, 21).
 *
 * WHY THIS FILE EXISTS FIRST. `docs/FINAL-IMPLEMENTATION-PLAN.md` §1 settles
 * the architecture: brokerage shipments get a NEW `shipments` table rather
 * than an extension of `loads` (whose `carrier_id` is NOT NULL and whose
 * F-03 fee trigger three modules depend on cannot survive a shipper-centric
 * lifecycle that begins with no carrier at all). `loads` is untouched and
 * remains the dispatch system of record.
 *
 * M-71 writes the DDL. It writes it to match THIS FILE — every enum below is
 * the exact value list its Postgres enum must carry, and every `*Row` type is
 * the exact column list its table must expose. Nothing here reads or writes a
 * database; nothing here is a state machine (M-72 owns transitions).
 *
 * Plain module by design (no `server-only`): the public `/track` form in
 * M-73 needs the same status vocabulary the server uses, and a second copy
 * of it in client code is exactly the drift this module exists to prevent.
 *
 * i18n: nothing customer-facing is spelled in English anywhere in this
 * module. Enum members are stable machine identifiers; the human strings are
 * message KEYS (`statusKey()` and friends) whose catalogue entries land with
 * the UI in M-73, across all five locales (§24).
 */

/**
 * The ONE import in this file, and it is type-only: M-77's
 * `ShipmentDocumentRow.status` reuses the `doc_status` enum shipped in
 * migration 0001 rather than minting a second three-value review vocabulary.
 * `database.types.ts` imports the shipment rows back from here; a type-only
 * cycle is erased at compile time and carries no runtime edge.
 */
import type { DocStatus } from "@/lib/supabase/database.types";

export type { DocStatus };

/* ------------------------------------------------------------------ *
 * §6 — shipment status
 * ------------------------------------------------------------------ */

/**
 * The 18 statuses of §6, named exactly as the directive names them.
 *
 * Not every shipment uses every status (§6). The first four
 * (`quote_requested` … `carrier_search`) have no carrier at all, which is
 * the structural reason this lifecycle cannot live on `loads`.
 */
export type ShipmentStatus =
  | "quote_requested"
  | "quote_sent"
  | "quote_accepted"
  | "carrier_search"
  | "carrier_assigned"
  | "dispatched"
  | "en_route_to_pickup"
  | "arrived_at_pickup"
  | "loading"
  | "picked_up"
  | "in_transit"
  | "delayed"
  | "arrived_at_delivery"
  | "unloading"
  | "delivered"
  | "pod_uploaded"
  | "completed"
  | "cancelled";

/**
 * §6 lifecycle order — the directive's own numbering, 1…18.
 *
 * This is a DECLARATION order (used for stable sorting, enum creation and
 * timeline rendering), NOT a transition graph. Which status may follow which,
 * and under what preconditions, is M-72's status-transition engine (§20).
 * Reading progress out of an index would be wrong for `delayed` and
 * `cancelled`, which are lifecycle states rather than milestones.
 */
export const SHIPMENT_STATUSES = [
  "quote_requested",
  "quote_sent",
  "quote_accepted",
  "carrier_search",
  "carrier_assigned",
  "dispatched",
  "en_route_to_pickup",
  "arrived_at_pickup",
  "loading",
  "picked_up",
  "in_transit",
  "delayed",
  "arrived_at_delivery",
  "unloading",
  "delivered",
  "pod_uploaded",
  "completed",
  "cancelled",
] as const satisfies readonly ShipmentStatus[];

/* ------------------------------------------------------------------ *
 * §7 — timeline events
 * ------------------------------------------------------------------ */

/**
 * `shipment_events.event_type`. §6 is explicit that statuses must not be free
 * text; the same discipline applies to the event kinds around them, so every
 * dispatcher action §14 names has an identifier here rather than a string
 * typed into a form.
 */
export type ShipmentEventType =
  | "shipment_created"
  | "status_change"
  | "location_update"
  | "eta_update"
  | "appointment_set"
  | "appointment_rescheduled"
  | "assignment_created"
  | "assignment_released"
  | "document_uploaded"
  | "document_approved"
  | "pod_requested"
  | "exception_opened"
  | "exception_resolved"
  | "public_update"
  | "internal_note"
  | "call_logged"
  | "email_logged"
  | "notification_sent"
  | "correction"
  | "cancellation";

export const SHIPMENT_EVENT_TYPES = [
  "shipment_created",
  "status_change",
  "location_update",
  "eta_update",
  "appointment_set",
  "appointment_rescheduled",
  "assignment_created",
  "assignment_released",
  "document_uploaded",
  "document_approved",
  "pod_requested",
  "exception_opened",
  "exception_resolved",
  "public_update",
  "internal_note",
  "call_logged",
  "email_logged",
  "notification_sent",
  "correction",
  "cancellation",
] as const satisfies readonly ShipmentEventType[];

/** §7 event sources, in the directive's order. */
export type ShipmentEventSource =
  | "dispatcher"
  | "carrier"
  | "driver"
  | "eld"
  | "gps"
  | "system"
  | "admin"
  | "shipper";

export const SHIPMENT_EVENT_SOURCES = [
  "dispatcher",
  "carrier",
  "driver",
  "eld",
  "gps",
  "system",
  "admin",
  "shipper",
] as const satisfies readonly ShipmentEventSource[];

/**
 * §7 visibility levels — plus `broker`.
 *
 * §7 lists four (public / shipper / carrier / staff_only). `broker` is a
 * DELIBERATE ADDITION, and it is the same lesson `FINAL-IMPLEMENTATION-PLAN`
 * §4 records against `doc_visibility`: §12 requires broker partners to see an
 * approved subset ("BOL, when authorized") while never seeing internal margin
 * or unrelated commentary, and an enum with no broker value leaves only two
 * bad options — show brokers the `shipper` band (which carries the shipper's
 * commercial correspondence) or show them nothing (which makes §12
 * unimplementable). A distinct band is the only way to write the rule down.
 *
 * `staff_only` is absolute: §7 says a staff-only note must never appear in a
 * customer timeline, and `src/lib/shipments/dto.ts` is where that is enforced
 * by construction rather than by convention.
 */
export type ShipmentEventVisibility =
  "public" | "shipper" | "carrier" | "broker" | "staff_only";

export const SHIPMENT_EVENT_VISIBILITIES = [
  "public",
  "shipper",
  "carrier",
  "broker",
  "staff_only",
] as const satisfies readonly ShipmentEventVisibility[];

/* ------------------------------------------------------------------ *
 * §9 — tracking mode, location privacy, providers
 * ------------------------------------------------------------------ */

/**
 * §9 tracking modes. `manual` (Mode A) is the only one required for launch
 * and must work with no GPS integration at all; `link` (Mode B) and `eld`
 * (Mode C) are modelled now so M-80 can add providers without a migration
 * that rewrites shipments.
 */
export type ShipmentTrackingMode = "manual" | "link" | "eld";

export const SHIPMENT_TRACKING_MODES = [
  "manual",
  "link",
  "eld",
] as const satisfies readonly ShipmentTrackingMode[];

/**
 * §9 privacy rules — the four configurable location-visibility levels,
 * ordered most to least revealing.
 *
 * `exact` never means "exact for everyone": §9 forbids permanently exposing a
 * live truck position to every public visitor, so the public audience is
 * capped at city/state even at this level (see `dto.ts`).
 */
export type ShipmentLocationVisibility =
  "exact" | "approximate" | "milestone_only" | "hidden";

export const SHIPMENT_LOCATION_VISIBILITIES = [
  "exact",
  "approximate",
  "milestone_only",
  "hidden",
] as const satisfies readonly ShipmentLocationVisibility[];

/** §9 Mode C telematics providers. No connection is implemented in M-70. */
export type TrackingProvider =
  "motive" | "samsara" | "geotab" | "verizon_connect" | "other";

export const TRACKING_PROVIDERS = [
  "motive",
  "samsara",
  "geotab",
  "verizon_connect",
  "other",
] as const satisfies readonly TrackingProvider[];

/** §9/§13 — driver consent state for location sharing. */
export type TrackingConsentStatus =
  "not_required" | "pending" | "granted" | "denied" | "revoked" | "expired";

export const TRACKING_CONSENT_STATUSES = [
  "not_required",
  "pending",
  "granted",
  "denied",
  "revoked",
  "expired",
] as const satisfies readonly TrackingConsentStatus[];

/* ------------------------------------------------------------------ *
 * §10 — ETA
 * ------------------------------------------------------------------ */

/**
 * §10 ETA provenance. This enum is the mechanism behind §30's honest-label
 * rule: an ETA the dispatcher typed must be labelled as such and must never
 * be presented as live or predictive.
 */
export type EtaSource =
  "manual" | "calculated" | "provider" | "dispatcher_adjusted";

export const ETA_SOURCES = [
  "manual",
  "calculated",
  "provider",
  "dispatcher_adjusted",
] as const satisfies readonly EtaSource[];

/**
 * The strict subset a DISPATCHER FORM may set.
 *
 * §30's honest-label rule, expressed as a type. M-75 shipped this with TWO
 * members and wrote down why: *"`calculated` and `provider` describe machinery
 * that does not exist yet … a dropdown offering them would let an operator
 * label a typed guess as a computed prediction."*
 *
 * **M-78 widened it by exactly ONE**, and only because the machinery now
 * exists. `calculated` is `src/lib/shipments/eta-estimate.ts` — a stated
 * arithmetic method over `shipments.distance_miles` (FMCSA §395.3 hours,
 * a 50 mph planning speed, fixed dock dwell), which the SERVER computes and
 * the operator cannot type. Picking `calculated` on the form does not label a
 * typed value; it discards whatever was typed and asks the server for its own
 * number, and the write is REFUSED when the shipment has no distance to
 * compute from. That is the difference between a capability and a claim.
 *
 * `provider` is still absent and still unreachable. Nothing in this codebase
 * receives an ETA from Motive, Samsara, Geotab or Verizon Connect; M-80 owns
 * those adapters. Offering it today would be the fake capability §30 forbids.
 *
 * It lives HERE, beside the full list, rather than in the server module that
 * writes ETAs, because the dispatcher form is a client component and
 * vocabulary is not a secret (the same reason this whole module carries no
 * `server-only`).
 */
export const DISPATCHER_ETA_SOURCES = [
  "manual",
  "dispatcher_adjusted",
  "calculated",
] as const satisfies readonly EtaSource[];

export type DispatcherEtaSource = (typeof DISPATCHER_ETA_SOURCES)[number];

/**
 * ETA sources NO code path can produce, stated as data rather than as prose.
 *
 * `tests/unit/shipment-eta-estimate.test.ts` asserts that this list and
 * `DISPATCHER_ETA_SOURCES` partition `ETA_SOURCES` exactly, so "which sources
 * are real?" has one answer that a future module cannot let drift: adding a
 * provider adapter means moving `provider` from here to there, in the same
 * commit that makes it true.
 */
export const UNREACHABLE_ETA_SOURCES = [
  "provider",
] as const satisfies readonly EtaSource[];

/**
 * §10 `eta_confidence`. The directive names the field but not its domain;
 * three bands is the smallest honest set — anything finer would imply a
 * precision manual ETAs do not have (§30).
 */
export type EtaConfidence = "high" | "medium" | "low";

export const ETA_CONFIDENCES = [
  "high",
  "medium",
  "low",
] as const satisfies readonly EtaConfidence[];

/** Which appointment an ETA row refers to (§10 keeps both). */
export type EtaKind = "pickup" | "delivery";

export const ETA_KINDS = [
  "pickup",
  "delivery",
] as const satisfies readonly EtaKind[];

/* ------------------------------------------------------------------ *
 * §16 — documents
 * ------------------------------------------------------------------ */

/** §16 document types, in the directive's order. */
export type ShipmentDocumentType =
  | "quote"
  | "shipper_confirmation"
  | "rate_confirmation"
  | "bol"
  | "lumper_receipt"
  | "detention_documentation"
  | "delivery_receipt"
  | "pod"
  | "invoice"
  | "claim"
  | "other";

export const SHIPMENT_DOCUMENT_TYPES = [
  "quote",
  "shipper_confirmation",
  "rate_confirmation",
  "bol",
  "lumper_receipt",
  "detention_documentation",
  "delivery_receipt",
  "pod",
  "invoice",
  "claim",
  "other",
] as const satisfies readonly ShipmentDocumentType[];

/**
 * §16 document visibility — carrying the same `broker` value as the event
 * enum above, and for the same reason: `FINAL-IMPLEMENTATION-PLAN` §4 records
 * that a `doc_visibility` without a broker band makes §12's "BOL, when
 * authorized" unimplementable.
 *
 * M-77 owns the document-type → audience MATRIX. M-70 owns only the
 * vocabulary it is written in.
 */
export type ShipmentDocumentVisibility =
  "public" | "shipper" | "carrier" | "broker" | "staff_only";

export const SHIPMENT_DOCUMENT_VISIBILITIES = [
  "public",
  "shipper",
  "carrier",
  "broker",
  "staff_only",
] as const satisfies readonly ShipmentDocumentVisibility[];

/* ------------------------------------------------------------------ *
 * §21 — exceptions
 * ------------------------------------------------------------------ */

/** The 13 exception types of §21, in the directive's order. */
export type ShipmentExceptionType =
  | "pickup_delay"
  | "delivery_delay"
  | "mechanical_issue"
  | "weather"
  | "traffic"
  | "facility_delay"
  | "rejected_freight"
  | "damaged_freight"
  | "missing_appointment"
  | "driver_unavailable"
  | "carrier_cancellation"
  | "documentation_issue"
  | "other";

export const SHIPMENT_EXCEPTION_TYPES = [
  "pickup_delay",
  "delivery_delay",
  "mechanical_issue",
  "weather",
  "traffic",
  "facility_delay",
  "rejected_freight",
  "damaged_freight",
  "missing_appointment",
  "driver_unavailable",
  "carrier_cancellation",
  "documentation_issue",
  "other",
] as const satisfies readonly ShipmentExceptionType[];

/**
 * §21 severity. Ordered low → critical; the carrier-management playbook's
 * escalation triggers (insurance lapse, unreachable driver in transit) map
 * onto `critical` when M-79 wires notification timing.
 */
export type ShipmentExceptionSeverity = "low" | "medium" | "high" | "critical";

export const SHIPMENT_EXCEPTION_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const satisfies readonly ShipmentExceptionSeverity[];

/* ------------------------------------------------------------------ *
 * §18 — parties and assignments
 * ------------------------------------------------------------------ */

/** Roles a party may hold on a shipment (§8 contact block, §18 parties). */
export type ShipmentPartyRole =
  | "shipper"
  | "consignee"
  | "broker_partner"
  | "carrier"
  | "billing"
  | "third_party";

export const SHIPMENT_PARTY_ROLES = [
  "shipper",
  "consignee",
  "broker_partner",
  "carrier",
  "billing",
  "third_party",
] as const satisfies readonly ShipmentPartyRole[];

/** Outcome of a public tracking attempt (§19 access logging). */
export type TrackingAccessOutcome =
  | "granted"
  | "not_found"
  | "bad_secondary"
  | "rate_limited"
  | "tracking_disabled";

export const TRACKING_ACCESS_OUTCOMES = [
  "granted",
  "not_found",
  "bad_secondary",
  "rate_limited",
  "tracking_disabled",
] as const satisfies readonly TrackingAccessOutcome[];

/**
 * M-76/§13 — outcome of a DRIVER-LINK presentation.
 *
 * Distinct from `TrackingAccessOutcome` because the failure modes are
 * genuinely different: a tracking lookup can fail on a wrong secondary value
 * and can be refused because an admin suspended public tracking, neither of
 * which a bearer token has; a driver link can expire, be revoked, or outlive
 * the carrier assignment it was scoped to, none of which a tracking number
 * can. One enum covering both would have five values nobody could ever
 * produce on one of the two paths.
 *
 * The DRIVER PAGE renders one identical refusal for `not_found`, `expired`,
 * `revoked` and `carrier_released` (§30's "Tracking link expired"); the
 * distinction is staff-only telemetry, exactly as on the public path.
 */
export type DriverTokenOutcome =
  | "granted"
  | "not_found"
  | "expired"
  | "revoked"
  /** The carrier was released or replaced after the link was issued (§13). */
  | "carrier_released"
  | "rate_limited"
  /** A redeemed link whose UPDATE was refused (§26's unauthorized-attempt). */
  | "update_rejected";

export const DRIVER_TOKEN_OUTCOMES = [
  "granted",
  "not_found",
  "expired",
  "revoked",
  "carrier_released",
  "rate_limited",
  "update_rejected",
] as const satisfies readonly DriverTokenOutcome[];

/** Who issued a driver link. §13 permits a dispatcher OR the carrier. */
export type DriverTokenIssuerRole = "admin" | "dispatcher" | "carrier";

export const DRIVER_TOKEN_ISSUER_ROLES = [
  "admin",
  "dispatcher",
  "carrier",
] as const satisfies readonly DriverTokenIssuerRole[];

/* ------------------------------------------------------------------ *
 * i18n keys (§24, §30)
 * ------------------------------------------------------------------ */

/**
 * next-intl namespace for the tracking system.
 *
 * The catalogues today carry exactly one namespace (`v4`, generated from the
 * prototype by `scripts/extract-i18n.mjs`). M-73 introduces `shipment` and
 * authors its entries in all five locales alongside the UI that renders them
 * — this module deliberately adds NO catalogue entries, because a key with no
 * translation is worse than a key that does not exist yet.
 */
export const SHIPMENT_I18N_NAMESPACE = "shipment";

/** Message key for a status label, e.g. `shipment.status.in_transit`. */
export function statusKey(status: ShipmentStatus): string {
  return `${SHIPMENT_I18N_NAMESPACE}.status.${status}`;
}

/** Message key for a timeline event label. */
export function eventTypeKey(eventType: ShipmentEventType): string {
  return `${SHIPMENT_I18N_NAMESPACE}.event.${eventType}`;
}

/** Message key for an exception label. */
export function exceptionTypeKey(type: ShipmentExceptionType): string {
  return `${SHIPMENT_I18N_NAMESPACE}.exception.${type}`;
}

/** Message key for an exception severity label. */
export function exceptionSeverityKey(
  severity: ShipmentExceptionSeverity,
): string {
  return `${SHIPMENT_I18N_NAMESPACE}.severity.${severity}`;
}

/**
 * Message key for a party role, e.g. `shipment.party.consignee`.
 *
 * M-74. §11's shipment-detail page shows "shipment contacts", which means
 * rendering `shipment_parties.party_role` to a customer in five languages —
 * the first surface that needs these labels, which is why M-70 did not author
 * them (a key with no translation renders as the key). The builder lives here
 * beside its four siblings so there is one place a `shipment.*` key is
 * constructed, and `tests/unit/shipment-types.test.ts` walks all six roles
 * against all five catalogues.
 */
export function partyRoleKey(role: ShipmentPartyRole): string {
  return `${SHIPMENT_I18N_NAMESPACE}.party.${role}`;
}

/* ------------------------------------------------------------------ *
 * Row types — the shape M-71's DDL must produce
 * ------------------------------------------------------------------ *
 *
 * Conventions copied from `src/lib/supabase/database.types.ts`, which these
 * types join when M-71 registers the tables on `Database["public"]`:
 *   * timestamps are ISO strings (PostgREST renders `timestamptz` as text);
 *   * `jsonb` is `unknown` (as `webhook_events.payload` and
 *     `audit_events.detail` already are) — never `any`;
 *   * money is `number` (numeric), matching `loads.gross_amount`.
 */

/**
 * `shipments` — §18's recommended field list, expanded where the directive
 * wrote a category rather than a column ("origin fields", "destination
 * fields", "current ETA", "reference numbers").
 *
 * Two additions beyond §18's list, both mandated elsewhere in the directive
 * and both needed by M-71's DDL:
 *   * `location_visibility` — §9's four privacy levels are per-shipment
 *     configuration and have nowhere else to live;
 *   * `cancellation_reason` — §20 requires `cancelled` to record one, which
 *     M-72 cannot enforce against a column that does not exist.
 *
 * `load_id` is the plan §1 bridge: nullable, set when a brokered shipment is
 * covered by a dispatched truck. It never makes `loads` a dependency.
 */
export interface ShipmentRow {
  id: string;
  /** `PL-YYYY-######`. Server-generated, unique, immutable — see
   * `src/lib/shipments/tracking-number.ts`. */
  tracking_number: string;
  shipper_id: string;
  /** Null through the first four statuses — no carrier exists yet (§6). */
  carrier_id: string | null;
  dispatcher_id: string | null;
  quote_id: string | null;
  broker_partner_id: string | null;
  /** Plan §1 — set when this brokerage shipment is covered by a dispatch load. */
  load_id: string | null;
  status: ShipmentStatus;

  origin_company: string | null;
  origin_address: string | null;
  origin_city: string;
  origin_state: string;
  origin_zip: string | null;

  destination_company: string | null;
  destination_address: string | null;
  destination_city: string;
  destination_state: string;
  destination_zip: string | null;

  pickup_appointment_at: string | null;
  delivery_appointment_at: string | null;

  equipment: string;
  commodity_category: string | null;
  weight_lbs: number | null;
  pallets: number | null;
  distance_miles: number | null;

  /**
   * @staffOnly §18 — gross amount billed to the shipper. Never leaves a staff
   * surface: excluded from every customer DTO in `dto.ts` and pinned by
   * `tests/unit/shipment-dto.test.ts`.
   */
  gross_shipper_amount: number | null;
  /**
   * @staffOnly §18 — what the carrier is paid. Visible to the carrier it
   * belongs to (§16 makes their own rate confirmation carrier-visible) and to
   * staff; never to public, shipper or broker audiences, since gross minus
   * carrier pay is the margin §4 and §12 forbid disclosing.
   */
  carrier_pay: number | null;
  /**
   * @staffOnly §18 — PickLoads margin / dispatch fee. The single most
   * dangerous column in the schema; §4 lists it first among the things a
   * public tracking page must never show.
   */
  margin: number | null;

  shipper_reference: string | null;
  po_number: string | null;

  public_tracking_enabled: boolean;
  tracking_mode: ShipmentTrackingMode;
  location_visibility: ShipmentLocationVisibility;
  /**
   * Hash of the §4 secondary verification value (access code / recipient
   * ZIP). It is a CREDENTIAL, not data: no DTO in this module serializes it
   * at any audience, including staff. M-73 verifies against it server-side.
   */
  public_access_hash: string | null;

  current_latitude: number | null;
  current_longitude: number | null;
  current_city: string | null;
  current_state: string | null;
  last_location_at: string | null;

  estimated_pickup_at: string | null;
  estimated_delivery_at: string | null;
  eta_source: EtaSource | null;
  eta_confidence: EtaConfidence | null;
  eta_updated_at: string | null;
  delay_minutes: number | null;
  /** Customer-safe delay wording (§21: calm, no blame, no legal conclusions). */
  delay_reason_public: string | null;
  /**
   * @staffOnly §10/§21 — the operational truth behind a delay. Never crosses
   * into a customer DTO; swept by name in `tests/unit/shipment-dto.test.ts`.
   */
  delay_reason_internal: string | null;

  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  /** §20 — `cancelled` must record a reason. */
  cancellation_reason: string | null;
}

/**
 * `shipment_events` — all 18 fields §7 names, no more and no fewer.
 *
 * `idempotency_key` and `external_event_id` exist from the first migration
 * rather than being retrofitted: §9's Mode C explicitly requires preventing
 * duplicate provider events, and a dedupe key added later cannot deduplicate
 * the history already stored.
 */
export interface ShipmentEventRow {
  id: string;
  shipment_id: string;
  event_type: ShipmentEventType;
  /** The status this event asserts, when it asserts one. */
  status: ShipmentStatus | null;
  /** When it happened in the world. */
  event_time: string;
  /** When PickLoads learned of it — §7 keeps both. */
  recorded_at: string;
  source: ShipmentEventSource;
  created_by: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  public_message: string | null;
  internal_message: string | null;
  visibility: ShipmentEventVisibility;
  /** Raw provider payload (§9) — `jsonb`. Staff surfaces only. */
  metadata: unknown;
  external_event_id: string | null;
  idempotency_key: string | null;
}

/**
 * `shipment_exceptions` — §21's 10 fields plus keys (migration 0025, M-78).
 *
 * M-78 added TWO fields to M-70's original interface, each argued in 0025's
 * section 2:
 *
 *   * `source_event_id` — the `exception_opened` event this row was opened by,
 *     or BACKFILLED FROM. Unique in SQL, which is what makes M-75/M-76's
 *     event-only exceptions migrate idempotently and what lets §7's
 *     append-only ledger and this lifecycle table be reconciled by a join.
 *   * `resolution_event_id` — the `exception_resolved` event that closed it.
 *     Chosen over a `resolved_by` + resolution-timestamp pair: the event
 *     already records the actor, the time and the wording under §7's
 *     append-only guarantee, and a pointer to it cannot disagree with it the
 *     way a copy can.
 *
 * Neither is customer-facing. `CustomerExceptionDto` names neither, and 0025's
 * `my_shipment_exceptions()` return type does not carry them.
 */
export interface ShipmentExceptionRow {
  id: string;
  shipment_id: string;
  exception_type: ShipmentExceptionType;
  severity: ShipmentExceptionSeverity;
  /** Calm, blame-free wording. Null means "nothing honest to tell the
   * customer yet" — such an exception is omitted from customer DTOs entirely
   * rather than rendered as a blank alarm. */
  public_description: string | null;
  /**
   * @staffOnly §21 — the operational truth, including blame and legal
   * exposure. Never crosses a customer DTO; swept by name in
   * `tests/unit/shipment-dto.test.ts`.
   */
  internal_description: string | null;
  opened_at: string;
  resolved_at: string | null;
  opened_by: string | null;
  assigned_to: string | null;
  customer_notified_at: string | null;
  /** @staffOnly §21 — what closed it, in operational words. */
  resolution: string | null;
  source_event_id: string | null;
  resolution_event_id: string | null;
}

/** `shipment_eta_history` — §10's "preserve previous ETA values in history". */
export interface ShipmentEtaHistoryRow {
  id: string;
  shipment_id: string;
  eta_kind: EtaKind;
  previous_eta_at: string | null;
  new_eta_at: string | null;
  eta_source: EtaSource;
  eta_confidence: EtaConfidence | null;
  delay_minutes: number | null;
  reason_public: string | null;
  reason_internal: string | null;
  /** The §10 "create a shipment event" companion, when one was written. */
  event_id: string | null;
  changed_by: string | null;
  changed_at: string;
}

/**
 * `shipment_locations` — §9 position history.
 *
 * `retention_expires_at` is a stored column rather than a computed policy so
 * the M-84b purger has something to select on: a retention rule with no
 * executor is the exact gap `FINAL-IMPLEMENTATION-PLAN` §4 flagged.
 */
export interface ShipmentLocationRow {
  id: string;
  shipment_id: string;
  recorded_at: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  /** §9 Mode C "vehicle speed, if permitted". */
  speed_mph: number | null;
  heading_degrees: number | null;
  source: ShipmentEventSource;
  provider: TrackingProvider | null;
  external_event_id: string | null;
  /** Raw provider metadata, stored securely (§9) — `jsonb`, staff only. */
  raw_metadata: unknown;
  retention_expires_at: string | null;
}

/**
 * §16 review state. This is the SHIPPED `doc_status` enum from migration
 * 0001 (`pending | approved | rejected | expired`), not a new type: carrier
 * compliance documents have been reviewed against it since M-21, staff know
 * the vocabulary, and M-58's review queue already renders it. A second
 * three-value enum meaning the same thing is the duplication the executive
 * directive forbids.
 *
 * Re-exported from `@/lib/supabase/database.types` (see the import at the top
 * of this file) rather than redeclared, so the two can never drift.
 */

/**
 * `shipment_documents` — §16. Private bucket + signed URLs (M-77).
 *
 * M-77 added FOUR fields to M-70's original interface, each because §16 or
 * §20 cannot be implemented without them:
 *
 *   * `status` — §20's *"`pod_uploaded` requires an APPROVED POD document"*
 *     needs a rejected state distinct from a not-yet-reviewed one.
 *     `approved_at is null` cannot tell those apart, so a rejected POD would
 *     sit forever looking like a pending one.
 *   * `review_note` — M-58's carrier review queue has carried the reviewer's
 *     reason since M-21; a POD rejected with no reason is a carrier phone call.
 *   * `reviewed_by` / `reviewed_at` — who last decided, for the §15
 *     document-access history, including on a REJECTION (`approved_by` /
 *     `approved_at` are, by the migration's CHECK, only ever set on approval).
 */
export interface ShipmentDocumentRow {
  id: string;
  shipment_id: string;
  doc_type: ShipmentDocumentType;
  /**
   * The row-level RESTRICTION, not the audience list. The audience list is
   * the §16 matrix in `src/lib/shipments/documents.ts`, keyed by `doc_type`;
   * this column can only ever NARROW it to `staff_only`. Migration 0024's
   * CHECK refuses any value the matrix does not license for the type, so a
   * rate confirmation filed as `public` is a constraint violation and not a
   * code review.
   */
  visibility: ShipmentDocumentVisibility;
  /** Path inside the PRIVATE bucket. Never a public URL. */
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  /** §16 review state. Customers see only `approved` rows. */
  status: DocStatus;
  review_note: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

/** `shipment_parties` — §18. Contact channels per §8, permission-scoped. */
export interface ShipmentPartyRow {
  id: string;
  shipment_id: string;
  party_role: ShipmentPartyRole;
  /** FK into the organization table matching `party_role` (shipper/carrier). */
  organization_id: string | null;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  /**
   * Whether this contact may appear on the PUBLIC tracking page. Defaults
   * false in M-71's DDL: §8 forbids exposing a driver's personal number by
   * default, and §4 forbids private carrier contact outright.
   */
  public_contact: boolean;
  created_at: string;
}

/** `shipment_assignments` — §18. Reassignment is a new row, never an edit. */
export interface ShipmentAssignmentRow {
  id: string;
  shipment_id: string;
  carrier_id: string;
  driver_id: string | null;
  truck_id: string | null;
  dispatcher_id: string | null;
  assigned_by: string | null;
  assigned_at: string;
  released_at: string | null;
  release_reason: string | null;
}

/**
 * `shipment_tracking_access` — §19's "logs access" and "prevents
 * enumeration" requirements.
 *
 * The attempted tracking number is stored (it is the thing being guessed);
 * the attempted secondary value never is, in any form — logging a hash of a
 * recipient ZIP would build a rainbow-friendly ledger of exactly the
 * credential §4 relies on.
 */
export interface ShipmentTrackingAccessRow {
  id: string;
  /** Null when the lookup matched nothing — the enumeration case. */
  shipment_id: string | null;
  tracking_number_attempted: string;
  outcome: TrackingAccessOutcome;
  ip: string | null;
  user_agent: string | null;
  /** Set when an authenticated portal user performed the lookup. */
  profile_id: string | null;
  accessed_at: string;
}

/**
 * `tracking_provider_connections` — §9 Modes B and C.
 *
 * Credentials are NOT here: §15 requires integration credentials to live in
 * environment variables, never database plaintext. This row holds the
 * per-shipment link and its lifecycle only.
 */
export interface TrackingProviderConnectionRow {
  id: string;
  shipment_id: string;
  provider: TrackingProvider;
  external_tracking_id: string | null;
  /** Mode B per-shipment driver-location link. */
  tracking_url: string | null;
  expires_at: string | null;
  consent_status: TrackingConsentStatus;
  active: boolean;
  connected_by: string | null;
  connected_at: string;
  last_polled_at: string | null;
  last_error: string | null;
}

/**
 * `shipment_driver_tokens` — §13's driver update link (M-76, migration 0023).
 *
 * WHAT M-70 ALREADY MODELLED, AND WHAT IT DID NOT.
 * `TrackingProviderConnectionRow` above is the closest thing in this file and
 * was checked first: it is per-shipment, it expires, and it carries a
 * `consent_status` — three of the four properties §13 asks for. It is still
 * the wrong table, for a reason worth writing down rather than discovering
 * later: it models a link a PROVIDER gives US (`tracking_url` points outward
 * at Motive/Samsara, `external_tracking_id` is their identifier, and
 * `last_polled_at`/`last_error` describe a poller), whereas this models a
 * credential WE give a driver. Overloading one row type would leave every
 * driver link carrying four provider columns that must stay null and a
 * `tracking_url` column that is the one thing §13 forbids storing.
 *
 * What IS reused is `TrackingConsentStatus` — §9's enum, created in SQL by
 * 0017 and declared above. M-76 adds no consent vocabulary of its own.
 *
 * NOTE WHAT IS ABSENT: the token. `token_hash` is an HMAC under an env-held
 * key; there is no field here, and no column in 0023, able to carry the
 * plaintext. `token_hash` is additionally REVOKED at column level from
 * `authenticated` and `anon`, so no browser-reachable role can select it.
 */
export interface ShipmentDriverTokenRow {
  id: string;
  /** §13 "only assigned shipment" — immutable, enforced by 0023's trigger. */
  shipment_id: string;
  /** §13 "no access to other carrier records" — immutable, checked on redeem. */
  carrier_id: string;
  /** `v1:<64 hex>` HMAC-SHA-256. Never the token. */
  token_hash: string;
  driver_id: string | null;
  driver_name: string | null;
  issued_by: string | null;
  issued_by_role: DriverTokenIssuerRole;
  issued_at: string;
  /** §13 "short-lived" — NOT NULL, so a permanent link cannot be issued. */
  expires_at: string;
  /** §13 "revocable". One-way: 0023's trigger refuses un-revocation. */
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  /** §9/§13 — defaults to `pending`; the driver grants it on the page. */
  consent_status: TrackingConsentStatus;
  consent_at: string | null;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
}

/**
 * The projection every browser-reachable surface reads — `ShipmentDriverTokenRow`
 * without the credential column.
 *
 * Declared as an `Omit` rather than re-typed, so a new column on the row lands
 * here automatically and a new SECRET column has to be excluded deliberately.
 */
export type DriverTokenView = Omit<ShipmentDriverTokenRow, "token_hash">;

/**
 * `shipment_driver_token_access` — §13's "audit logged" and §26's
 * repeated-invalid-token signal, in one append-only ledger.
 *
 * It is also the rate limiter's memory (0023's `redeem_shipment_driver_token`
 * counts it), so "rate limited" and "audit logged" are one write and cannot
 * disagree with each other.
 *
 * NOTE WHAT IS ABSENT, as in `ShipmentTrackingAccessRow`: any field able to
 * carry the presented token, hashed or otherwise. A ledger of hashes of
 * presented tokens is an oracle for whoever can read it.
 */
export interface ShipmentDriverTokenAccessRow {
  id: string;
  /** Null when the presented token matched nothing — the enumeration case. */
  token_id: string | null;
  shipment_id: string | null;
  outcome: DriverTokenOutcome;
  /** Operational context (attempted status, refusal code). Never a credential. */
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  accessed_at: string;
}
