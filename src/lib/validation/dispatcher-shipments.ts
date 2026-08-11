import { z } from "zod";
import { optionalText } from "./shared";
import {
  SHIPMENT_EXCEPTION_SEVERITIES,
  SHIPMENT_EXCEPTION_TYPES,
  SHIPMENT_STATUSES,
  ETA_KINDS,
  ETA_CONFIDENCES,
  DISPATCHER_ETA_SOURCES,
} from "@/lib/shipments/types";

/**
 * M-75 — Zod schemas for the §14 dispatcher actions.
 *
 * ── WHY THE ENUMS COME FROM `types.ts` AND NOT FROM STRING LITERALS ───────
 *
 * Every enum below is `z.enum(SOME_CONST)` over an M-70 array. §6 is explicit
 * that statuses must not be free text, and the same discipline is what makes
 * §14's action list a vocabulary rather than a set of form fields: a schema
 * that spelled `"in_transit"` by hand would be a second copy of the enum, and
 * the first `alter type` would leave it silently wrong. `z.enum` over a
 * `readonly [...]` tuple also gives the ACTION a narrowed TypeScript type for
 * free, so nothing downstream needs a cast.
 *
 * ── THE ONE SCHEMA THAT REFUSES RATHER THAN COERCES ───────────────────────
 *
 * `correctionSchema` requires a non-blank reason and says so in the message.
 * §20 calls the reason mandatory; `apply_shipment_correction` refuses a blank
 * one with `PL422`; `shipment_events_correction_has_reason` refuses it a third
 * time as a CHECK. This is the layer the OPERATOR meets, and it is the only
 * one that can explain why.
 */

const shipmentId = z.uuid("Invalid shipment.");
const optionalUuid = z
  .union([z.literal(""), z.uuid("Invalid selection.")])
  .transform((v) => (v ? v : null));

/** Free text a dispatcher publishes or files. 2000 is generous but finite. */
const message = optionalText(2000);

/** ISO datetime from an `<input type="datetime-local">`, or blank to clear. */
const optionalDateTime = z
  .union([z.literal(""), z.string().trim().max(40)])
  .transform((v) => (v ? v : null))
  .refine(
    (v) => v === null || !Number.isNaN(new Date(v).getTime()),
    "Enter a valid date and time.",
  )
  .transform((v) => (v === null ? null : new Date(v).toISOString()));

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, "That entry is too long.");

/* ------------------------------------------------------------------ *
 * Creation and conversion
 * ------------------------------------------------------------------ */

/**
 * §14 "create shipment".
 *
 * `status` is restricted to the three a NEW shipment can honestly be in.
 * A shipment cannot be created `in_transit` — the freight has not moved, and
 * a status with no event history behind it is exactly the state §6 and §7
 * forbid. Later statuses are reached through M-72's engine, one edge at a
 * time, each writing its own event.
 */
export const CREATABLE_STATUSES = [
  "quote_requested",
  "quote_accepted",
  "carrier_search",
] as const;

export const createShipmentSchema = z.object({
  shipper_id: z.uuid("Choose the shipper this freight belongs to."),
  quote_id: optionalUuid,
  status: z.enum(CREATABLE_STATUSES).catch("carrier_search"),
  origin_company: optionalText(160),
  origin_address: optionalText(200),
  origin_city: requiredText(80, "Enter the pickup city."),
  origin_state: requiredText(2, "Enter the pickup state (2 letters).")
    .toUpperCase(),
  origin_zip: optionalText(12),
  destination_company: optionalText(160),
  destination_address: optionalText(200),
  destination_city: requiredText(80, "Enter the delivery city."),
  destination_state: requiredText(2, "Enter the delivery state (2 letters).")
    .toUpperCase(),
  destination_zip: optionalText(12),
  equipment: requiredText(60, "Choose the equipment."),
  commodity_category: optionalText(120),
  weight_lbs: z.coerce.number().int().min(0).max(200_000).nullable().catch(null),
  pallets: z.coerce.number().int().min(0).max(100_000).nullable().catch(null),
  shipper_reference: optionalText(80),
  po_number: optionalText(80),
  pickup_appointment_at: optionalDateTime,
  delivery_appointment_at: optionalDateTime,
  gross_shipper_amount: z.coerce
    .number()
    .min(0)
    .max(10_000_000)
    .nullable()
    .catch(null),
  carrier_pay: z.coerce.number().min(0).max(10_000_000).nullable().catch(null),
  internal_note: message,
});

export const convertQuoteSchema = z.object({
  quote_id: z.uuid("Invalid quote."),
});

/* ------------------------------------------------------------------ *
 * Assignments (§14)
 * ------------------------------------------------------------------ */

export const assignCarrierSchema = z.object({
  shipment_id: shipmentId,
  carrier_id: z.uuid("Choose a carrier."),
  driver_id: optionalUuid,
  truck_id: optionalUuid,
  dispatcher_id: optionalUuid,
  internal_note: message,
});

export const releaseCarrierSchema = z.object({
  shipment_id: shipmentId,
  reason: requiredText(
    300,
    "Say why the carrier is coming off — the next dispatcher will need it.",
  ),
});

export const assignDispatcherSchema = z.object({
  shipment_id: shipmentId,
  dispatcher_id: optionalUuid,
});

/* ------------------------------------------------------------------ *
 * Appointments, status, ETA (§14)
 * ------------------------------------------------------------------ */

export const appointmentSchema = z.object({
  shipment_id: shipmentId,
  kind: z.enum(ETA_KINDS),
  /** Blank clears the appointment, which 0019 records as a change. */
  appointment_at: optionalDateTime,
  reason: optionalText(300),
});

export const statusUpdateSchema = z.object({
  shipment_id: shipmentId,
  /** Compare-and-swap: what the operator's page believed (M-72's R-4). */
  expected_status: z.enum(SHIPMENT_STATUSES),
  to: z.enum(SHIPMENT_STATUSES),
  public_message: message,
  internal_message: message,
  city: optionalText(80),
  state: optionalText(2),
  /** §20 — required when `to` is `cancelled`; the engine refuses a blank. */
  cancellation_reason: optionalText(300),
  /** §20's `completed` closeout, asserted by a human. Absent = not done. */
  closeout_confirmed: z.coerce.boolean().catch(false),
  /** True publishes the note to the customer timeline; false keeps it staff. */
  publish: z.coerce.boolean().catch(false),
});

export const etaUpdateSchema = z.object({
  shipment_id: shipmentId,
  kind: z.enum(ETA_KINDS),
  eta_at: optionalDateTime,
  eta_source: z.enum(DISPATCHER_ETA_SOURCES).catch("manual"),
  eta_confidence: z
    .union([z.literal(""), z.enum(ETA_CONFIDENCES)])
    .transform((v) => (v ? v : null)),
  delay_minutes: z.coerce.number().int().min(0).max(100_000).nullable().catch(null),
  reason_public: optionalText(300),
  reason_internal: optionalText(300),
});

/* ------------------------------------------------------------------ *
 * §14's timeline actions
 * ------------------------------------------------------------------ */

/** Public update vs internal note — one form, one visibility switch (§7). */
export const noteSchema = z.object({
  shipment_id: shipmentId,
  /** `public` writes a `public_update`; `internal` writes an `internal_note`. */
  band: z.enum(["public", "internal"]),
  body: requiredText(2000, "Write the update before saving it."),
});

/** §14 "record call". */
export const CALL_DIRECTIONS = ["inbound", "outbound"] as const;
export const CALL_PARTIES = [
  "shipper",
  "consignee",
  "carrier",
  "driver",
  "broker_partner",
  "facility",
  "other",
] as const;

export const recordCallSchema = z.object({
  shipment_id: shipmentId,
  direction: z.enum(CALL_DIRECTIONS),
  party: z.enum(CALL_PARTIES),
  contact_name: optionalText(120),
  /** When the call happened, not when it was typed up (§7 keeps both). */
  occurred_at: optionalDateTime,
  summary: requiredText(2000, "Summarise the call — that is the whole point."),
  /** Optional customer-visible line drawn from the call. */
  public_message: message,
});

/** §14 "record email". */
export const recordEmailSchema = z.object({
  shipment_id: shipmentId,
  direction: z.enum(CALL_DIRECTIONS),
  party: z.enum(CALL_PARTIES),
  /** The counterparty address. Stored in metadata; never a credential. */
  counterparty: optionalText(254),
  subject: requiredText(200, "Enter the email subject."),
  occurred_at: optionalDateTime,
  summary: message,
  public_message: message,
});

/** §14 "log exception" — see M-75's doc for the M-78 hand-off. */
export const logExceptionSchema = z.object({
  shipment_id: shipmentId,
  exception_type: z.enum(SHIPMENT_EXCEPTION_TYPES),
  severity: z.enum(SHIPMENT_EXCEPTION_SEVERITIES),
  /** Customer-safe wording — a D-6 phrase token or calm free text (§21). */
  public_description: optionalText(600),
  internal_description: requiredText(
    2000,
    "Record what actually happened — the internal note is the operational record.",
  ),
});

/** §14 "request POD". */
export const requestPodSchema = z.object({
  shipment_id: shipmentId,
  note: optionalText(600),
});

/** §14 "resend customer notification". */
export const RESENDABLE_NOTIFICATIONS = [
  "shipment_status",
  "shipment_eta",
  "shipment_delivered",
] as const;

export const resendNotificationSchema = z.object({
  shipment_id: shipmentId,
  kind: z.enum(RESENDABLE_NOTIFICATIONS),
  reason: requiredText(
    300,
    "Say why it is being resent — a duplicate email needs a reason on the record.",
  ),
});

/* ------------------------------------------------------------------ *
 * §20 admin correction
 * ------------------------------------------------------------------ */

/**
 * The mandatory reason is `min(10)`, not `min(1)`.
 *
 * §20 requires a reason; a one-character reason satisfies the letter and
 * defeats the purpose. Ten characters is the smallest bound that forces a
 * sentence fragment rather than a keystroke, and the operator is told exactly
 * that. The database still refuses a blank independently — this bound is the
 * one a human reads, not the one the system relies on.
 */
export const correctionSchema = z.object({
  shipment_id: shipmentId,
  expected_status: z.enum(SHIPMENT_STATUSES),
  corrected_status: z.enum(SHIPMENT_STATUSES),
  reason: z
    .string()
    .trim()
    .min(10, "A correction needs a written reason — at least a short sentence.")
    .max(600, "Keep the reason under 600 characters."),
  /** Optional customer-visible sentence, when the error was customer-visible. */
  public_message: message,
});
