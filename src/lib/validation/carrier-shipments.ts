import { z } from "zod";
import { optionalText } from "./shared";
import {
  ETA_KINDS,
  SHIPMENT_EXCEPTION_TYPES,
  SHIPMENT_STATUSES,
} from "@/lib/shipments/types";

/**
 * M-76 — Zod schemas for the §13 carrier and driver actions.
 *
 * Same discipline as M-75's `dispatcher-shipments.ts`: every enum is
 * `z.enum(SOME_CONST)` over an array declared in `types.ts` or
 * `carrier-updates.ts`, never a string literal typed here. A second copy of a
 * value list is a thing the first `alter type` leaves silently wrong.
 *
 * ── THE FIELDS THAT ARE NOT HERE ARE THE POINT ───────────────────────────
 *
 * §19: *"Carrier updates must be limited to approved fields and transitions."*
 * The transitions half is `carrier-updates.ts`. The FIELDS half is these
 * schemas: `gross_shipper_amount`, `carrier_pay`, `margin`, `shipper_id`,
 * `dispatcher_id`, `tracking_number` and `public_access_hash` are not keys in
 * any object below, so a carrier POSTing them gets them dropped by Zod before
 * anything downstream can see them — and the server actions never read a
 * FormData key the schema does not name.
 * `CARRIER_FORBIDDEN_FIELDS` names them explicitly and
 * `tests/unit/carrier-shipment-actions.test.ts` asserts a POST carrying every
 * one of them changes nothing.
 *
 * ── THE TOKEN SCHEMA IS STRICT ON PURPOSE ────────────────────────────────
 *
 * `driverToken` matches the exact base64url shape of a 32-byte token and
 * nothing else. A looser schema would push near-misses into the hashing path,
 * where they cost a database round trip and a ledger row each — which is
 * precisely the budget an enumeration attempt wants to spend on our side
 * rather than its own.
 */

const shipmentId = z.uuid("That shipment is not on your board.");

/** 43 base64url characters — `randomBytes(32).toString("base64url")`. */
const driverToken = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, "This link is no longer valid.");

/**
 * Free text a carrier or driver files against a shipment.
 *
 * 500, not M-75's 2000. A driver types on a phone at a dock; a dispatcher
 * types at a desk. The shorter bound is also the honest one for a field whose
 * contents land in an operator's queue rather than on a customer's page.
 */
const note = optionalText(500);

/**
 * A place name a driver reports. Bounded and stripped of the characters that
 * would change the shape of a PostgREST filter if this value ever reached one
 * — the same allow-list M-74 applies to its text filters, for the same
 * reason, even though this value goes to an RPC parameter rather than a
 * filter string.
 */
const place = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => v.replace(/[^A-Za-z0-9 .'\-/]/g, ""))
    .optional()
    .transform((v) => (v ? v : null));

/* ------------------------------------------------------------------ *
 * §13 status updates
 * ------------------------------------------------------------------ */

/**
 * `expected_status` is REQUIRED and is not decoration: it is M-72's
 * compare-and-swap key. A driver's page can sit open on a phone for an hour
 * while dispatch moves the shipment; without it, a stale tap would overwrite
 * whatever happened in between, and with it the engine returns `PL409` and
 * the page says "somebody moved this — reload".
 */
export const carrierStatusUpdateSchema = z.object({
  shipment_id: shipmentId,
  /**
   * A bounded string, NOT `z.enum(CARRIER_ACTION_IDS)`.
   *
   * The enum would be the obvious choice and produces the wrong ERROR: Zod
   * would answer an unknown id with `Invalid option: expected one of
   * "confirm_dispatch" | …`, which leaks the whole action vocabulary to
   * whoever is probing and reads like a bug to a carrier who hit a stale page.
   * `carrierAction()` + `refuseCarrierAction()` are the single place the
   * vocabulary is checked, and they answer `unknown_action` — one sentence, no
   * list. The narrowing is not lost: the action object is looked up by id and
   * a miss refuses before any write.
   */
  action: z.string().trim().min(1).max(40),
  expected_status: z.enum(SHIPMENT_STATUSES),
  city: place(80, "That city name is too long."),
  state: place(2, "Use the 2-letter state code.").transform((v) =>
    v === null ? null : v.toUpperCase(),
  ),
  note,
});

export const driverStatusUpdateSchema = carrierStatusUpdateSchema
  .omit({ shipment_id: true })
  .extend({ token: driverToken });

/* ------------------------------------------------------------------ *
 * §13 "update ETA"
 * ------------------------------------------------------------------ */

/**
 * A carrier's ETA is recorded with `eta_source: "manual"` and NOTHING ELSE —
 * the source is not a form field.
 *
 * §30 is the reason. `EtaSource` also has `calculated` and `provider`, and a
 * carrier form offering either would let a hand-typed time be labelled as a
 * computed one on the customer's tracking page, where M-73 renders
 * `label.eta_dispatcher` off exactly this column. M-75 withheld the same
 * values from the dispatcher form for the same reason; M-76 withholds one
 * more (`dispatcher_adjusted`, which asserts a dispatcher looked at it).
 */
export const carrierEtaSchema = z.object({
  shipment_id: shipmentId,
  kind: z.enum(ETA_KINDS),
  eta_at: z
    .string()
    .trim()
    .min(1, "Enter the estimated date and time.")
    .max(40)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Enter a valid date and time.")
    .transform((v) => new Date(v).toISOString()),
  delay_minutes: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(20_160)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  note,
});

export const driverEtaSchema = carrierEtaSchema
  .omit({ shipment_id: true })
  .extend({ token: driverToken });

/* ------------------------------------------------------------------ *
 * §13 "submit exception"
 * ------------------------------------------------------------------ */

/**
 * §21's thirteen types, and a required description.
 *
 * SEVERITY IS NOT A FIELD. §21 makes severity an operational triage decision
 * (it drives escalation timing), and a carrier reporting their own delay is
 * not a neutral party to how urgent it is. Every carrier- and driver-reported
 * exception is recorded at `medium` for dispatch to triage, which is stated
 * on the form rather than hidden.
 *
 * The description lands in `internal_message` at the `carrier` band and NEVER
 * in `public_message`. Decision D-6 is explicit that customer-facing text on
 * a five-locale page comes from the curated phrase library or carries the
 * "written by dispatch, in English" label; a carrier typing English prose
 * straight onto a Haitian Creole customer's timeline is the outcome D-6
 * exists to prevent.
 */
export const carrierExceptionSchema = z.object({
  shipment_id: shipmentId,
  exception_type: z.enum(SHIPMENT_EXCEPTION_TYPES),
  description: z
    .string()
    .trim()
    .min(5, "Tell dispatch what happened.")
    .max(500, "That entry is too long."),
});

export const driverExceptionSchema = carrierExceptionSchema
  .omit({ shipment_id: true })
  .extend({ token: driverToken });

/* ------------------------------------------------------------------ *
 * §13 driver-link lifecycle
 * ------------------------------------------------------------------ */

export const issueDriverTokenSchema = z.object({
  shipment_id: shipmentId,
  driver_id: z
    .union([z.literal(""), z.uuid("Choose a driver from the list.")])
    .optional()
    .transform((v) => (v ? v : null)),
  driver_name: optionalText(120),
});

export const revokeDriverTokenSchema = z.object({
  token_id: z.uuid("That link no longer exists."),
  /** Optional: revoking fast matters more than explaining why. */
  reason: optionalText(300),
});

/**
 * §9/§13 consent.
 *
 * `granted` is derived from the presence of a checkbox, so an ABSENT checkbox
 * is `false` — which is the whole mechanism. A schema with `.default(true)`
 * or a coercion that treated "not sent" as unchanged would turn an actively
 * granted permission into a default one, and §9 asks for the opposite.
 */
export const driverConsentSchema = z.object({
  token: driverToken,
  granted: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "1" || v === "true"),
});
