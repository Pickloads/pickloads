/**
 * M-70 — shipment DTO serializers (`docs/DIRECTIVE-tracking.md` §4, §7, §9,
 * §12, §18, §19).
 *
 * This is the security core of the shipment domain. §18 is explicit —
 * "sensitive financial data must never be included in public shipment
 * queries … use database views or server-side serializers to control exposed
 * fields" — and §19 requires the public tracking route to return "a strict
 * public DTO". These functions are that control point, for every audience.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────────
 *
 * Every DTO is built by EXPLICIT ALLOW-LIST CONSTRUCTION: each returned field
 * is named in the object literal that produces it. No spread of a row, no
 * `delete`, no `omit()`, no key filtering.
 *
 * The difference is what happens when M-71 (or M-78, or M-88) adds a column.
 * A deny-list leaks it to every audience until somebody remembers to deny it;
 * an allow-list makes it invisible until somebody decides otherwise. New
 * columns are exactly where margins, internal notes and carrier compliance
 * data will arrive, so invisible-by-default is the only safe default. The
 * key-set tests in `tests/unit/shipment-dto.test.ts` fail on any widening,
 * including an accidental one.
 *
 * ── §4's forbidden list is absolute for the public audience ───────────────
 *
 * broker margins · rate confirmations · private carrier contact · internal
 * notes · dispatch fee · insurance documents · shipper billing · private
 * operational comments.
 *
 * Structurally, none of these can reach a customer DTO: the three
 * `@staffOnly` financial columns are named in exactly one serializer
 * (`toStaffDto`, plus `carrier_pay` in `toCarrierDto` — see below), documents
 * and insurance records are not inputs to this module at all, and internal
 * commentary lives in fields (`internal_message`, `delay_reason_internal`,
 * `internal_description`, `metadata`) that only the staff serializers name.
 *
 * `public_access_hash` is serialized by NO audience, staff included. It is
 * the §4 secondary-verification credential, not data about the shipment;
 * M-73 compares against it server-side and it has no business in a payload.
 *
 * ── Inputs are rows, not query results ───────────────────────────────────
 *
 * These functions take `ShipmentRow` (+ optional events and exceptions) and
 * nothing else — no joins, no counts, no organization names. Keeping them
 * pure is what lets the whole audience matrix be proved by unit tests with no
 * database, and it keeps M-74/M-75 free to shape their own queries above it.
 */

import {
  eventTypeKey,
  exceptionSeverityKey,
  exceptionTypeKey,
  statusKey,
  type EtaConfidence,
  type EtaSource,
  type ShipmentEventRow,
  type ShipmentEventSource,
  type ShipmentEventType,
  type ShipmentEventVisibility,
  type ShipmentExceptionRow,
  type ShipmentExceptionSeverity,
  type ShipmentExceptionType,
  type ShipmentLocationVisibility,
  type ShipmentRow,
  type ShipmentStatus,
  type ShipmentTrackingMode,
} from "@/lib/shipments/types";

/* ------------------------------------------------------------------ *
 * Audiences and event visibility (§7, §12, §19)
 * ------------------------------------------------------------------ */

/** Who is being served. Maps 1:1 to the five serializers below. */
export type ShipmentAudience =
  "public" | "shipper" | "carrier" | "broker" | "staff";

export const SHIPMENT_AUDIENCES = [
  "public",
  "shipper",
  "carrier",
  "broker",
  "staff",
] as const satisfies readonly ShipmentAudience[];

/**
 * Which event visibility bands each audience may read.
 *
 * `public` is the least restrictive band, so every audience receives it. The
 * customer bands do NOT nest: a shipper never reads `carrier` or `broker`
 * events (they carry the counterparty's operational correspondence) and no
 * customer audience ever reads `staff_only` — §7's hard rule, and the one
 * this table exists to make unbreakable.
 */
export const AUDIENCE_EVENT_VISIBILITY = {
  public: ["public"],
  shipper: ["public", "shipper"],
  carrier: ["public", "carrier"],
  broker: ["public", "broker"],
  staff: ["public", "shipper", "carrier", "broker", "staff_only"],
} as const satisfies Record<
  ShipmentAudience,
  readonly ShipmentEventVisibility[]
>;

/** Does `audience` get to see an event carrying `visibility`? */
export function isEventVisibleTo(
  audience: ShipmentAudience,
  visibility: ShipmentEventVisibility,
): boolean {
  const allowed: readonly ShipmentEventVisibility[] =
    AUDIENCE_EVENT_VISIBILITY[audience];
  return allowed.includes(visibility);
}

/** Drop every event `audience` may not read. Order is preserved. */
export function filterEventsFor(
  audience: ShipmentAudience,
  events: readonly ShipmentEventRow[],
): ShipmentEventRow[] {
  return events.filter((event) => isEventVisibleTo(audience, event.visibility));
}

/* ------------------------------------------------------------------ *
 * Location privacy (§9)
 * ------------------------------------------------------------------ */

/**
 * The current-position block, identical in shape for every audience so the
 * key set never varies with the data. Redaction sets values to `null`; it
 * never removes keys, which would let a consumer distinguish "hidden" from
 * "not yet reported" and turn the privacy setting into a signal of its own.
 */
export interface ShipmentLocationView {
  current_city: string | null;
  current_state: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_at: string | null;
}

const EMPTY_LOCATION: ShipmentLocationView = {
  current_city: null,
  current_state: null,
  current_latitude: null,
  current_longitude: null,
  last_location_at: null,
};

/**
 * Apply §9's four privacy levels.
 *
 *   hidden          → nothing, to anybody but staff.
 *   milestone_only  → nothing; progress is told through timeline events only.
 *   approximate     → city/state and the update time; never coordinates.
 *   exact           → coordinates too — but NEVER to the public audience.
 *
 * That last clause is §9 verbatim: "do not permanently expose exact real-time
 * truck position to every public visitor". A public visitor holds a tracking
 * number and a ZIP, not an account, so `exact` is capped at city/state there
 * while the shipper portal receives the precise position it is entitled to.
 *
 * Staff are unaffected by the setting: it is a customer-facing privacy
 * control, and dispatch cannot operate a shipment it is not allowed to see.
 */
function locationFor(
  audience: ShipmentAudience,
  shipment: ShipmentRow,
): ShipmentLocationView {
  const full: ShipmentLocationView = {
    current_city: shipment.current_city,
    current_state: shipment.current_state,
    current_latitude: shipment.current_latitude,
    current_longitude: shipment.current_longitude,
    last_location_at: shipment.last_location_at,
  };
  if (audience === "staff") return full;

  const coarse: ShipmentLocationView = {
    current_city: shipment.current_city,
    current_state: shipment.current_state,
    current_latitude: null,
    current_longitude: null,
    last_location_at: shipment.last_location_at,
  };

  const level: ShipmentLocationVisibility = shipment.location_visibility;
  switch (level) {
    case "hidden":
    case "milestone_only":
      return EMPTY_LOCATION;
    case "approximate":
      return coarse;
    case "exact":
      return audience === "public" ? coarse : full;
  }
}

/* ------------------------------------------------------------------ *
 * Customer-facing sub-DTOs
 * ------------------------------------------------------------------ */

/**
 * A timeline entry as any non-staff audience sees it.
 *
 * `internal_message`, `metadata`, `created_by` and the event coordinates are
 * absent by construction — not nulled, absent. Coordinates in particular are
 * staff-only in M-70: per-event position disclosure is governed by §9's
 * privacy levels plus provider consent, which M-80 implements; until then the
 * honest answer for a customer timeline is the city/state the operator typed.
 */
export interface CustomerEventDto {
  event_type: ShipmentEventType;
  event_type_key: string;
  status: ShipmentStatus | null;
  status_key: string | null;
  event_time: string;
  source: ShipmentEventSource;
  city: string | null;
  state: string | null;
  message: string | null;
}

function toCustomerEventDto(event: ShipmentEventRow): CustomerEventDto {
  return {
    event_type: event.event_type,
    event_type_key: eventTypeKey(event.event_type),
    status: event.status,
    status_key: event.status === null ? null : statusKey(event.status),
    event_time: event.event_time,
    source: event.source,
    city: event.city,
    state: event.state,
    message: event.public_message,
  };
}

/** A timeline entry as staff see it: everything §7 records. */
export interface StaffEventDto {
  id: string;
  shipment_id: string;
  event_type: ShipmentEventType;
  event_type_key: string;
  status: ShipmentStatus | null;
  status_key: string | null;
  event_time: string;
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
  metadata: unknown;
  external_event_id: string | null;
  idempotency_key: string | null;
}

function toStaffEventDto(event: ShipmentEventRow): StaffEventDto {
  return {
    id: event.id,
    shipment_id: event.shipment_id,
    event_type: event.event_type,
    event_type_key: eventTypeKey(event.event_type),
    status: event.status,
    status_key: event.status === null ? null : statusKey(event.status),
    event_time: event.event_time,
    recorded_at: event.recorded_at,
    source: event.source,
    created_by: event.created_by,
    city: event.city,
    state: event.state,
    latitude: event.latitude,
    longitude: event.longitude,
    public_message: event.public_message,
    internal_message: event.internal_message,
    visibility: event.visibility,
    metadata: event.metadata,
    external_event_id: event.external_event_id,
    idempotency_key: event.idempotency_key,
  };
}

/**
 * An exception as a customer sees it (§21: "clear and calm … do not expose
 * blame, legal conclusions or sensitive internal commentary").
 *
 * `internal_description` and `resolution` are absent by construction, and an
 * exception whose `public_description` is still null is omitted from customer
 * views altogether — a warning banner with nothing honest to say behind it is
 * worse than silence.
 */
export interface CustomerExceptionDto {
  exception_type: ShipmentExceptionType;
  exception_type_key: string;
  severity: ShipmentExceptionSeverity;
  severity_key: string;
  description: string;
  opened_at: string;
  resolved_at: string | null;
}

function toCustomerExceptionDtos(
  exceptions: readonly ShipmentExceptionRow[],
): CustomerExceptionDto[] {
  const visible: CustomerExceptionDto[] = [];
  for (const exception of exceptions) {
    const description = exception.public_description;
    if (description === null) continue;
    visible.push({
      exception_type: exception.exception_type,
      exception_type_key: exceptionTypeKey(exception.exception_type),
      severity: exception.severity,
      severity_key: exceptionSeverityKey(exception.severity),
      description,
      opened_at: exception.opened_at,
      resolved_at: exception.resolved_at,
    });
  }
  return visible;
}

/** An exception as staff see it — §21's full field list. */
export interface StaffExceptionDto {
  id: string;
  shipment_id: string;
  exception_type: ShipmentExceptionType;
  exception_type_key: string;
  severity: ShipmentExceptionSeverity;
  severity_key: string;
  public_description: string | null;
  internal_description: string | null;
  opened_at: string;
  resolved_at: string | null;
  opened_by: string | null;
  assigned_to: string | null;
  customer_notified_at: string | null;
  resolution: string | null;
}

function toStaffExceptionDto(
  exception: ShipmentExceptionRow,
): StaffExceptionDto {
  return {
    id: exception.id,
    shipment_id: exception.shipment_id,
    exception_type: exception.exception_type,
    exception_type_key: exceptionTypeKey(exception.exception_type),
    severity: exception.severity,
    severity_key: exceptionSeverityKey(exception.severity),
    public_description: exception.public_description,
    internal_description: exception.internal_description,
    opened_at: exception.opened_at,
    resolved_at: exception.resolved_at,
    opened_by: exception.opened_by,
    assigned_to: exception.assigned_to,
    customer_notified_at: exception.customer_notified_at,
    resolution: exception.resolution,
  };
}

/* ------------------------------------------------------------------ *
 * Serializer input
 * ------------------------------------------------------------------ */

/**
 * Events and exceptions are optional: §25 requires the current summary to be
 * queryable separately from the full history, so a caller rendering a header
 * passes the row alone and gets empty collections rather than a second query.
 */
export interface ShipmentDtoInput {
  shipment: ShipmentRow;
  events?: readonly ShipmentEventRow[];
  exceptions?: readonly ShipmentExceptionRow[];
}

function customerEvents(
  audience: ShipmentAudience,
  input: ShipmentDtoInput,
): CustomerEventDto[] {
  return filterEventsFor(audience, input.events ?? []).map(toCustomerEventDto);
}

/* ------------------------------------------------------------------ *
 * Public tracking DTO (§4, §8, §19)
 * ------------------------------------------------------------------ */

/**
 * Exactly what an unauthenticated `/track` visitor may receive.
 *
 * Scoped to §8's header, timeline and shipment-summary lists. Three
 * deliberate exclusions beyond §4's forbidden list:
 *
 *   * `id` — §13 forbids exposing internal shipment IDs in predictable URLs;
 *     the public surface is keyed by tracking number and nothing else.
 *   * street addresses and ZIPs — §8 asks for "origin" and "destination", and
 *     city/state is the granularity a delivery-status page needs. A full
 *     dock address on an unauthenticated page is a physical-security fact
 *     about somebody else's business.
 *   * `distance_miles` — not in §8's summary, and mileage plus a public rate
 *     is the first step toward inferring a rate per mile.
 *
 * `carrier_assigned` is a boolean, never the carrier's identity or contact:
 * §1 wants "assigned carrier status" visible, §4 forbids private carrier
 * contact information.
 */
export interface PublicTrackingDto {
  tracking_number: string;
  status: ShipmentStatus;
  status_key: string;
  origin_city: string;
  origin_state: string;
  destination_city: string;
  destination_state: string;
  pickup_appointment_at: string | null;
  delivery_appointment_at: string | null;
  estimated_pickup_at: string | null;
  estimated_delivery_at: string | null;
  eta_source: EtaSource | null;
  eta_confidence: EtaConfidence | null;
  eta_updated_at: string | null;
  delay_minutes: number | null;
  delay_reason: string | null;
  equipment: string;
  commodity_category: string | null;
  weight_lbs: number | null;
  pallets: number | null;
  shipper_reference: string | null;
  po_number: string | null;
  carrier_assigned: boolean;
  tracking_mode: ShipmentTrackingMode;
  location_visibility: ShipmentLocationVisibility;
  current_city: string | null;
  current_state: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  events: CustomerEventDto[];
  exceptions: CustomerExceptionDto[];
}

export function toPublicTrackingDto(
  input: ShipmentDtoInput,
): PublicTrackingDto {
  const s = input.shipment;
  const location = locationFor("public", s);
  return {
    tracking_number: s.tracking_number,
    status: s.status,
    status_key: statusKey(s.status),
    origin_city: s.origin_city,
    origin_state: s.origin_state,
    destination_city: s.destination_city,
    destination_state: s.destination_state,
    pickup_appointment_at: s.pickup_appointment_at,
    delivery_appointment_at: s.delivery_appointment_at,
    estimated_pickup_at: s.estimated_pickup_at,
    estimated_delivery_at: s.estimated_delivery_at,
    eta_source: s.eta_source,
    eta_confidence: s.eta_confidence,
    eta_updated_at: s.eta_updated_at,
    delay_minutes: s.delay_minutes,
    // The PUBLIC reason only. `delay_reason_internal` is named in no
    // customer serializer anywhere in this file.
    delay_reason: s.delay_reason_public,
    equipment: s.equipment,
    commodity_category: s.commodity_category,
    weight_lbs: s.weight_lbs,
    pallets: s.pallets,
    shipper_reference: s.shipper_reference,
    po_number: s.po_number,
    carrier_assigned: s.carrier_id !== null,
    tracking_mode: s.tracking_mode,
    location_visibility: s.location_visibility,
    current_city: location.current_city,
    current_state: location.current_state,
    current_latitude: location.current_latitude,
    current_longitude: location.current_longitude,
    last_location_at: location.last_location_at,
    completed_at: s.completed_at,
    cancelled_at: s.cancelled_at,
    events: customerEvents("public", input),
    exceptions: toCustomerExceptionDtos(input.exceptions ?? []),
  };
}

/* ------------------------------------------------------------------ *
 * Shipper DTO (§11)
 * ------------------------------------------------------------------ */

/**
 * The authenticated shipper's own shipment. Adds what an account holder
 * legitimately owns — the internal id (their portal routes by it), the full
 * facility addresses they themselves booked, distance, lifecycle timestamps
 * and their quote link.
 *
 * It adds NO financial field. §18 marks `gross_shipper_amount` staff-only
 * alongside `carrier_pay` and `margin`, and §11's "invoice status" is a fact
 * about an invoice, not a column on the shipment — M-74 reads it from
 * `invoices`, where amounts already live under their own RLS.
 */
export interface ShipperShipmentDto {
  id: string;
  tracking_number: string;
  status: ShipmentStatus;
  status_key: string;
  quote_id: string | null;
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
  estimated_pickup_at: string | null;
  estimated_delivery_at: string | null;
  eta_source: EtaSource | null;
  eta_confidence: EtaConfidence | null;
  eta_updated_at: string | null;
  delay_minutes: number | null;
  delay_reason: string | null;
  equipment: string;
  commodity_category: string | null;
  weight_lbs: number | null;
  pallets: number | null;
  distance_miles: number | null;
  shipper_reference: string | null;
  po_number: string | null;
  carrier_assigned: boolean;
  tracking_mode: ShipmentTrackingMode;
  location_visibility: ShipmentLocationVisibility;
  current_city: string | null;
  current_state: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  events: CustomerEventDto[];
  exceptions: CustomerExceptionDto[];
}

export function toShipperDto(input: ShipmentDtoInput): ShipperShipmentDto {
  const s = input.shipment;
  const location = locationFor("shipper", s);
  return {
    id: s.id,
    tracking_number: s.tracking_number,
    status: s.status,
    status_key: statusKey(s.status),
    quote_id: s.quote_id,
    origin_company: s.origin_company,
    origin_address: s.origin_address,
    origin_city: s.origin_city,
    origin_state: s.origin_state,
    origin_zip: s.origin_zip,
    destination_company: s.destination_company,
    destination_address: s.destination_address,
    destination_city: s.destination_city,
    destination_state: s.destination_state,
    destination_zip: s.destination_zip,
    pickup_appointment_at: s.pickup_appointment_at,
    delivery_appointment_at: s.delivery_appointment_at,
    estimated_pickup_at: s.estimated_pickup_at,
    estimated_delivery_at: s.estimated_delivery_at,
    eta_source: s.eta_source,
    eta_confidence: s.eta_confidence,
    eta_updated_at: s.eta_updated_at,
    delay_minutes: s.delay_minutes,
    delay_reason: s.delay_reason_public,
    equipment: s.equipment,
    commodity_category: s.commodity_category,
    weight_lbs: s.weight_lbs,
    pallets: s.pallets,
    distance_miles: s.distance_miles,
    shipper_reference: s.shipper_reference,
    po_number: s.po_number,
    carrier_assigned: s.carrier_id !== null,
    tracking_mode: s.tracking_mode,
    location_visibility: s.location_visibility,
    current_city: location.current_city,
    current_state: location.current_state,
    current_latitude: location.current_latitude,
    current_longitude: location.current_longitude,
    last_location_at: location.last_location_at,
    created_at: s.created_at,
    updated_at: s.updated_at,
    completed_at: s.completed_at,
    cancelled_at: s.cancelled_at,
    cancellation_reason: s.cancellation_reason,
    events: customerEvents("shipper", input),
    exceptions: toCustomerExceptionDtos(input.exceptions ?? []),
  };
}

/* ------------------------------------------------------------------ *
 * Carrier DTO (§13, §16, §19)
 * ------------------------------------------------------------------ */

/**
 * The assigned carrier's view.
 *
 * `carrier_pay` IS included, and it is the one deliberate crossing of the
 * `@staffOnly` line in this file. §16 makes the carrier rate confirmation a
 * carrier-visible document, so the number is already contractually theirs;
 * hiding it from the API while mailing it as a PDF would be theatre. What
 * stays out is everything that would let them derive the margin —
 * `gross_shipper_amount` and `margin` are named in no serializer but
 * `toStaffDto`.
 *
 * Also absent: `shipper_id` and `broker_partner_id` (the counterparties are
 * PickLoads' relationships, not the carrier's), `quote_id`, and every
 * internal note. §19's "carrier users cannot edit financial fields" is a
 * write-side rule that M-71's RLS and M-72's engine enforce; this is the read
 * side of the same boundary.
 */
export interface CarrierShipmentDto {
  id: string;
  tracking_number: string;
  status: ShipmentStatus;
  status_key: string;
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
  estimated_pickup_at: string | null;
  estimated_delivery_at: string | null;
  eta_source: EtaSource | null;
  eta_confidence: EtaConfidence | null;
  eta_updated_at: string | null;
  delay_minutes: number | null;
  delay_reason: string | null;
  equipment: string;
  commodity_category: string | null;
  weight_lbs: number | null;
  pallets: number | null;
  distance_miles: number | null;
  shipper_reference: string | null;
  po_number: string | null;
  /** Their own contracted pay — never gross, never margin. */
  carrier_pay: number | null;
  tracking_mode: ShipmentTrackingMode;
  location_visibility: ShipmentLocationVisibility;
  current_city: string | null;
  current_state: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  events: CustomerEventDto[];
  exceptions: CustomerExceptionDto[];
}

export function toCarrierDto(input: ShipmentDtoInput): CarrierShipmentDto {
  const s = input.shipment;
  const location = locationFor("carrier", s);
  return {
    id: s.id,
    tracking_number: s.tracking_number,
    status: s.status,
    status_key: statusKey(s.status),
    origin_company: s.origin_company,
    origin_address: s.origin_address,
    origin_city: s.origin_city,
    origin_state: s.origin_state,
    origin_zip: s.origin_zip,
    destination_company: s.destination_company,
    destination_address: s.destination_address,
    destination_city: s.destination_city,
    destination_state: s.destination_state,
    destination_zip: s.destination_zip,
    pickup_appointment_at: s.pickup_appointment_at,
    delivery_appointment_at: s.delivery_appointment_at,
    estimated_pickup_at: s.estimated_pickup_at,
    estimated_delivery_at: s.estimated_delivery_at,
    eta_source: s.eta_source,
    eta_confidence: s.eta_confidence,
    eta_updated_at: s.eta_updated_at,
    delay_minutes: s.delay_minutes,
    delay_reason: s.delay_reason_public,
    equipment: s.equipment,
    commodity_category: s.commodity_category,
    weight_lbs: s.weight_lbs,
    pallets: s.pallets,
    distance_miles: s.distance_miles,
    shipper_reference: s.shipper_reference,
    po_number: s.po_number,
    carrier_pay: s.carrier_pay,
    tracking_mode: s.tracking_mode,
    location_visibility: s.location_visibility,
    current_city: location.current_city,
    current_state: location.current_state,
    current_latitude: location.current_latitude,
    current_longitude: location.current_longitude,
    last_location_at: location.last_location_at,
    created_at: s.created_at,
    updated_at: s.updated_at,
    completed_at: s.completed_at,
    cancelled_at: s.cancelled_at,
    cancellation_reason: s.cancellation_reason,
    events: customerEvents("carrier", input),
    exceptions: toCustomerExceptionDtos(input.exceptions ?? []),
  };
}

/* ------------------------------------------------------------------ *
 * Broker-partner DTO (§12)
 * ------------------------------------------------------------------ */

/**
 * An invited, admin-approved broker partner's view of a shipment shared with
 * their organization.
 *
 * §12 grants: assigned shipments, status, timeline, POD, BOL when authorized,
 * approved contact channels. §12 forbids: the carrier's private packet,
 * carrier insurance records, shipper billing, PickLoads commission, internal
 * margin, unrelated shipments.
 *
 * So this DTO carries NO financial field at all — not even `carrier_pay`.
 * A broker partner who knows what PickLoads pays the carrier and what they
 * themselves were quoted has computed the commission §12 forbids them; the
 * carrier gets their own rate because it is their own contract, and a broker
 * partner is not a party to it. Documents (POD/BOL) are M-77's, gated by the
 * `broker` value in `doc_visibility`; contact channels are M-81's
 * `shipment_parties` read, gated by `public_contact`.
 */
export interface BrokerShipmentDto {
  id: string;
  tracking_number: string;
  status: ShipmentStatus;
  status_key: string;
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
  estimated_pickup_at: string | null;
  estimated_delivery_at: string | null;
  eta_source: EtaSource | null;
  eta_confidence: EtaConfidence | null;
  eta_updated_at: string | null;
  delay_minutes: number | null;
  delay_reason: string | null;
  equipment: string;
  commodity_category: string | null;
  weight_lbs: number | null;
  pallets: number | null;
  distance_miles: number | null;
  shipper_reference: string | null;
  po_number: string | null;
  carrier_assigned: boolean;
  tracking_mode: ShipmentTrackingMode;
  location_visibility: ShipmentLocationVisibility;
  current_city: string | null;
  current_state: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  events: CustomerEventDto[];
  exceptions: CustomerExceptionDto[];
}

export function toBrokerDto(input: ShipmentDtoInput): BrokerShipmentDto {
  const s = input.shipment;
  const location = locationFor("broker", s);
  return {
    id: s.id,
    tracking_number: s.tracking_number,
    status: s.status,
    status_key: statusKey(s.status),
    origin_company: s.origin_company,
    origin_address: s.origin_address,
    origin_city: s.origin_city,
    origin_state: s.origin_state,
    origin_zip: s.origin_zip,
    destination_company: s.destination_company,
    destination_address: s.destination_address,
    destination_city: s.destination_city,
    destination_state: s.destination_state,
    destination_zip: s.destination_zip,
    pickup_appointment_at: s.pickup_appointment_at,
    delivery_appointment_at: s.delivery_appointment_at,
    estimated_pickup_at: s.estimated_pickup_at,
    estimated_delivery_at: s.estimated_delivery_at,
    eta_source: s.eta_source,
    eta_confidence: s.eta_confidence,
    eta_updated_at: s.eta_updated_at,
    delay_minutes: s.delay_minutes,
    delay_reason: s.delay_reason_public,
    equipment: s.equipment,
    commodity_category: s.commodity_category,
    weight_lbs: s.weight_lbs,
    pallets: s.pallets,
    distance_miles: s.distance_miles,
    shipper_reference: s.shipper_reference,
    po_number: s.po_number,
    carrier_assigned: s.carrier_id !== null,
    tracking_mode: s.tracking_mode,
    location_visibility: s.location_visibility,
    current_city: location.current_city,
    current_state: location.current_state,
    current_latitude: location.current_latitude,
    current_longitude: location.current_longitude,
    last_location_at: location.last_location_at,
    created_at: s.created_at,
    updated_at: s.updated_at,
    completed_at: s.completed_at,
    cancelled_at: s.cancelled_at,
    cancellation_reason: s.cancellation_reason,
    events: customerEvents("broker", input),
    exceptions: toCustomerExceptionDtos(input.exceptions ?? []),
  };
}

/* ------------------------------------------------------------------ *
 * Staff DTO (§14, §15)
 * ------------------------------------------------------------------ */

/**
 * Admin and dispatcher view — every operational and financial field, plus
 * the unfiltered timeline.
 *
 * Still an explicit allow-list, for two reasons. A new column must be a
 * decision on every surface including this one, and `public_access_hash` is
 * excluded here too: staff need to know a shipment is protected, not what the
 * secret is, and a credential that never enters a payload cannot leak through
 * a log line, an error boundary or a screen share.
 *
 * WHICH shipments a dispatcher may reach is a different question, answered by
 * `src/lib/staff-scope.ts` and M-71's policies. This function does not
 * authorize; it serializes what the caller already established it may read.
 */
export interface StaffShipmentDto {
  id: string;
  tracking_number: string;
  shipper_id: string;
  carrier_id: string | null;
  dispatcher_id: string | null;
  quote_id: string | null;
  broker_partner_id: string | null;
  load_id: string | null;
  status: ShipmentStatus;
  status_key: string;
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
  gross_shipper_amount: number | null;
  carrier_pay: number | null;
  margin: number | null;
  shipper_reference: string | null;
  po_number: string | null;
  public_tracking_enabled: boolean;
  tracking_mode: ShipmentTrackingMode;
  location_visibility: ShipmentLocationVisibility;
  current_city: string | null;
  current_state: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_at: string | null;
  estimated_pickup_at: string | null;
  estimated_delivery_at: string | null;
  eta_source: EtaSource | null;
  eta_confidence: EtaConfidence | null;
  eta_updated_at: string | null;
  delay_minutes: number | null;
  delay_reason_public: string | null;
  delay_reason_internal: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  events: StaffEventDto[];
  exceptions: StaffExceptionDto[];
}

export function toStaffDto(input: ShipmentDtoInput): StaffShipmentDto {
  const s = input.shipment;
  const location = locationFor("staff", s);
  return {
    id: s.id,
    tracking_number: s.tracking_number,
    shipper_id: s.shipper_id,
    carrier_id: s.carrier_id,
    dispatcher_id: s.dispatcher_id,
    quote_id: s.quote_id,
    broker_partner_id: s.broker_partner_id,
    load_id: s.load_id,
    status: s.status,
    status_key: statusKey(s.status),
    origin_company: s.origin_company,
    origin_address: s.origin_address,
    origin_city: s.origin_city,
    origin_state: s.origin_state,
    origin_zip: s.origin_zip,
    destination_company: s.destination_company,
    destination_address: s.destination_address,
    destination_city: s.destination_city,
    destination_state: s.destination_state,
    destination_zip: s.destination_zip,
    pickup_appointment_at: s.pickup_appointment_at,
    delivery_appointment_at: s.delivery_appointment_at,
    equipment: s.equipment,
    commodity_category: s.commodity_category,
    weight_lbs: s.weight_lbs,
    pallets: s.pallets,
    distance_miles: s.distance_miles,
    gross_shipper_amount: s.gross_shipper_amount,
    carrier_pay: s.carrier_pay,
    margin: s.margin,
    shipper_reference: s.shipper_reference,
    po_number: s.po_number,
    public_tracking_enabled: s.public_tracking_enabled,
    tracking_mode: s.tracking_mode,
    location_visibility: s.location_visibility,
    current_city: location.current_city,
    current_state: location.current_state,
    current_latitude: location.current_latitude,
    current_longitude: location.current_longitude,
    last_location_at: location.last_location_at,
    estimated_pickup_at: s.estimated_pickup_at,
    estimated_delivery_at: s.estimated_delivery_at,
    eta_source: s.eta_source,
    eta_confidence: s.eta_confidence,
    eta_updated_at: s.eta_updated_at,
    delay_minutes: s.delay_minutes,
    delay_reason_public: s.delay_reason_public,
    delay_reason_internal: s.delay_reason_internal,
    created_at: s.created_at,
    updated_at: s.updated_at,
    completed_at: s.completed_at,
    cancelled_at: s.cancelled_at,
    cancellation_reason: s.cancellation_reason,
    events: filterEventsFor("staff", input.events ?? []).map(toStaffEventDto),
    exceptions: (input.exceptions ?? []).map(toStaffExceptionDto),
  };
}
