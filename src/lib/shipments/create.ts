import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { getBooleanSetting } from "@/lib/company-settings";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { logShipmentSignal } from "@/lib/shipments/observability";
import { generateTrackingNumber } from "@/lib/shipments/tracking-number";
import type { ShipmentRow, ShipmentStatus } from "@/lib/shipments/types";

/**
 * M-75 — shipment creation and quote→shipment conversion (§14), with the
 * SERVICE-LAYER half of §2's brokerage gate.
 *
 * ── §2: THE GATE THIS FILE OWNS ───────────────────────────────────────────
 *
 * M-71 shipped the database half — `trg_shipments_brokerage_gate`, a BEFORE
 * INSERT trigger that raises `P0001` while `company_settings.brokerage_active`
 * is false — and its documentation is explicit that it is **one layer, not the
 * whole control**:
 *
 *   > "M-75 must still refuse in the service layer with a human error
 *   >  message… A `P0001` at the bottom of the stack is a safety net, not a
 *   >  user experience."
 *
 * So `assertBrokerageOpen()` runs BEFORE any tracking number is minted and
 * before any round trip, and it returns a typed refusal carrying a sentence a
 * dispatcher can act on ("PickLoads is not operating as a licensed broker
 * yet…") rather than a Postgres error string. The trigger stays underneath it
 * and is what a future server action that forgets to call this cannot bypass.
 *
 * It FAILS CLOSED for the same reason the trigger does: `getBooleanSetting`
 * resolves an unreadable switchboard to its fallback, and the fallback here is
 * `false`. A gate that opens when its configuration is missing is not a gate.
 *
 * ── §5: THE TRACKING NUMBER AND THE 23505 RETRY ───────────────────────────
 *
 * M-70's generator is a pure CSPRNG draw and its doc is equally explicit:
 * *"Collision handling belongs to the caller: the unique constraint is the
 * arbiter, and M-71/M-75 retry generation on a 23505."* That loop is
 * `TRACKING_NUMBER_ATTEMPTS` below. It retries ONLY on 23505 and only on the
 * tracking-number index — a duplicate anything else is a real error and
 * re-rolling a random number would not fix it, it would just hide it behind a
 * different failure a few milliseconds later.
 *
 * ── EVERY WRITE IS ONE STATEMENT ──────────────────────────────────────────
 *
 * `create_shipment()` (migration 0022) inserts the shipment AND its
 * `shipment_created` event in one transaction, for the reason M-72 argued at
 * length: two supabase-js calls are two transactions, and a crash between them
 * leaves a shipment whose history begins nowhere.
 */

/* ------------------------------------------------------------------ *
 * §2 gate
 * ------------------------------------------------------------------ */

/**
 * The staff-facing sentence. Deliberately NOT "creation failed": it names the
 * business fact, the person who can change it and what still works — §30's
 * honest-labels rule applied to an internal surface, which is where operators
 * learn whether the product tells them the truth.
 */
export const BROKERAGE_CLOSED_MESSAGE =
  "Brokerage operations are switched off, so no shipment can be created. " +
  "PickLoads is not operating as a licensed freight broker until the MC " +
  "authority and BMC-84 bond are active; an admin turns this on with the " +
  "`brokerage_active` switch in Settings once they are. Dispatch loads are " +
  "unaffected — book those on the Loads board.";

export interface BrokerageGateResult {
  open: boolean;
  /** Present exactly when `open` is false. */
  message?: string;
}

/**
 * §2's service-layer gate. Call before ANY shipment creation path.
 *
 * Reads the same `company_settings.brokerage_active` key the 0017 trigger
 * reads, through M-69's single switchboard reader (cached, fail-closed).
 */
export async function assertBrokerageOpen(): Promise<BrokerageGateResult> {
  const open = await getBooleanSetting("brokerage_active", false);
  return open ? { open: true } : { open: false, message: BROKERAGE_CLOSED_MESSAGE };
}

/* ------------------------------------------------------------------ *
 * The draft a caller supplies
 * ------------------------------------------------------------------ */

/**
 * The columns a creation path may set.
 *
 * An ALLOW-LIST, and the mirror of the one migration 0022 applies in SQL. Two
 * layers because this one is a constant somebody can edit and that one is a
 * property of the write path; `tests/unit/shipment-create.test.ts` pins both
 * and asserts the five forbidden keys are stripped even when a caller sends
 * them.
 *
 * `tracking_number` is absent by design: the service mints it (§5 "generated
 * server-side"), so a caller cannot choose one. `status` IS present, because
 * a converted quote starts at `quote_accepted` while a shipment dispatch books
 * directly starts at `carrier_search`, and a fixed initial status would make
 * one of those two lie.
 */
export type ShipmentDraft = Partial<
  Pick<
    ShipmentRow,
    | "carrier_id"
    | "dispatcher_id"
    | "quote_id"
    | "broker_partner_id"
    | "load_id"
    | "status"
    | "origin_company"
    | "origin_address"
    | "origin_zip"
    | "destination_company"
    | "destination_address"
    | "destination_zip"
    | "pickup_appointment_at"
    | "delivery_appointment_at"
    | "commodity_category"
    | "weight_lbs"
    | "pallets"
    | "distance_miles"
    | "gross_shipper_amount"
    | "carrier_pay"
    | "margin"
    | "shipper_reference"
    | "po_number"
    | "public_tracking_enabled"
    | "public_access_hash"
    | "estimated_pickup_at"
    | "estimated_delivery_at"
    | "eta_source"
    | "eta_confidence"
  >
> &
  Pick<
    ShipmentRow,
    | "shipper_id"
    | "origin_city"
    | "origin_state"
    | "destination_city"
    | "destination_state"
    | "equipment"
  >;

/** Keys migration 0022 strips whatever a caller sends. Asserted by the suite. */
export const FORBIDDEN_CREATE_KEYS = [
  "id",
  "created_at",
  "updated_at",
  "completed_at",
  "cancelled_at",
] as const;

/** How many distinct tracking numbers to try before giving up (§5). */
export const TRACKING_NUMBER_ATTEMPTS = 5;

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export type ShipmentCreateFailureCode =
  | "brokerage_closed"
  | "not_configured"
  | "invalid_input"
  | "tracking_number_exhausted"
  | "write_failed";

export interface ShipmentCreateFailure {
  ok: false;
  code: ShipmentCreateFailureCode;
  message: string;
}

export interface ShipmentCreateSuccess {
  ok: true;
  shipmentId: string;
  trackingNumber: string;
  status: ShipmentStatus;
  eventId: string;
  /** How many tracking numbers were minted. >1 means a real 23505 collision. */
  attempts: number;
}

export type ShipmentCreateResult =
  | ShipmentCreateSuccess
  | ShipmentCreateFailure;

export interface CreateShipmentInput {
  draft: ShipmentDraft;
  actorId: string | null;
  /** `admin` or `dispatcher`. Recorded on the event and in the audit row. */
  actorRole: "admin" | "dispatcher";
  /** Optional customer-visible creation note (D-6 token or free text). */
  publicMessage?: string | null;
  internalMessage?: string | null;
  /** Test seam only; production callers leave it unset. */
  trackingNumberFactory?: () => string;
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/** Is this the tracking-number unique violation, and nothing else? */
export function isTrackingNumberCollision(error: PostgrestLikeError): boolean {
  if (error.code !== "23505") return false;
  const haystack = `${error.message ?? ""} ${error.details ?? ""}`;
  return haystack.includes("shipments_tracking_number_key");
}

/**
 * Strip the forbidden keys and drop `undefined`, leaving a payload migration
 * 0022 can populate a record from.
 *
 * `undefined` must not survive: `JSON.stringify` would drop it anyway, but an
 * EXPLICIT null and an ABSENT key mean different things to 0022 (null
 * overrides a column default, absent takes it), and letting `undefined`
 * decide which one happens by accident is how `public_tracking_enabled` ends
 * up null.
 */
export function buildCreatePayload(
  draft: ShipmentDraft,
  trackingNumber: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { tracking_number: trackingNumber };
  for (const [key, value] of Object.entries(draft)) {
    if (value === undefined) continue;
    if ((FORBIDDEN_CREATE_KEYS as readonly string[]).includes(key)) continue;
    payload[key] = value;
  }
  return payload;
}

/* ------------------------------------------------------------------ *
 * Creation
 * ------------------------------------------------------------------ */

export async function createShipment(
  input: CreateShipmentInput,
): Promise<ShipmentCreateResult> {
  const gate = await assertBrokerageOpen();
  if (!gate.open) {
    logShipmentSignal({
      signal: "status_update_error",
      code: "brokerage_closed",
      actorRole: input.actorRole,
      actorId: input.actorId,
      detail: "shipment creation refused: brokerage_active is false",
    });
    return {
      ok: false,
      code: "brokerage_closed",
      message: gate.message ?? BROKERAGE_CLOSED_MESSAGE,
    };
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is unset — the shipment was NOT created.",
    };
  }

  const mint = input.trackingNumberFactory ?? (() => generateTrackingNumber());
  let lastError: PostgrestLikeError | null = null;

  for (let attempt = 1; attempt <= TRACKING_NUMBER_ATTEMPTS; attempt += 1) {
    const trackingNumber = mint();
    const { data, error } = await admin.rpc("create_shipment", {
      p_payload: buildCreatePayload(input.draft, trackingNumber) as never,
      p_actor: input.actorId,
      p_source: input.actorRole === "admin" ? "admin" : "dispatcher",
      p_public_message: input.publicMessage ?? null,
      p_internal_message: input.internalMessage ?? null,
    });

    if (error) {
      lastError = error;
      // §5: the unique index is the arbiter. Re-roll ONLY for it.
      if (isTrackingNumberCollision(error)) continue;
      break;
    }

    const envelope = (data ?? {}) as Record<string, unknown>;
    const shipmentId = String(envelope.shipment_id ?? "");
    const success: ShipmentCreateSuccess = {
      ok: true,
      shipmentId,
      trackingNumber: String(envelope.tracking_number ?? trackingNumber),
      status: (envelope.status as ShipmentStatus | undefined) ?? "quote_requested",
      eventId: String(envelope.event_id ?? ""),
      attempts: attempt,
    };

    await recordAuditEvent({
      actorId: input.actorId,
      action: "shipment.created",
      targetTable: "shipments",
      targetId: shipmentId,
      detail: {
        tracking_number: success.trackingNumber,
        status: success.status,
        shipper_id: input.draft.shipper_id,
        quote_id: input.draft.quote_id ?? null,
        actor_role: input.actorRole,
        tracking_number_attempts: attempt,
      },
    });

    // No success signal is emitted: §26's vocabulary is nine FAILURE signals
    // (`observability.ts`, closed union) and adding a tenth for a happy path
    // would widen the contract M-84b is going to map onto Sentry. The
    // successful creation is journalled where §15 asks for it — `audit_events`.
    return success;
  }

  if (lastError !== null && isTrackingNumberCollision(lastError)) {
    return {
      ok: false,
      code: "tracking_number_exhausted",
      message: `Could not mint a free tracking number in ${TRACKING_NUMBER_ATTEMPTS} attempts. Retry — this is astronomically unlikely and worth reporting if it repeats.`,
    };
  }

  const code = lastError?.code ?? "";
  // 0017's §2 trigger, if the switchboard changed between the gate and the
  // write. The message stays the staff-facing one — the operator does not
  // need to learn what P0001 is to understand what happened.
  if (code === "P0001") {
    return { ok: false, code: "brokerage_closed", message: BROKERAGE_CLOSED_MESSAGE };
  }
  if (code === "PL422" || code === "23514" || code === "22P02" || code === "23503") {
    return {
      ok: false,
      code: "invalid_input",
      message:
        lastError?.message ??
        "The shipment details were rejected. Check the lane, shipper and equipment.",
    };
  }
  console.error("[shipment-create] write failed", lastError?.message);
  return {
    ok: false,
    code: "write_failed",
    message: "Couldn't create the shipment. Retry, and check the Supabase connection.",
  };
}

/* ------------------------------------------------------------------ *
 * §14 — quote → shipment conversion
 * ------------------------------------------------------------------ */

/**
 * The `freight_quotes` columns the mapping reads. Explicit, so a conversion
 * cannot silently start depending on a column nobody reviewed.
 */
export const QUOTE_CONVERSION_COLUMNS =
  "id, shipper_id, status, quoted_rate, equipment, commodity, weight_lbs, pallets, pickup_date, delivery_deadline, pickup_company, pickup_address, pickup_city, pickup_state, pickup_zip, delivery_company, delivery_address, delivery_city, delivery_state, delivery_zip, special_instructions";

export interface ConvertibleQuote {
  id: string;
  shipper_id: string | null;
  status: string;
  quoted_rate: number | null;
  equipment: string | null;
  commodity: string | null;
  weight_lbs: number | null;
  pallets: string | null;
  pickup_date: string | null;
  delivery_deadline: string | null;
  pickup_company: string | null;
  pickup_address: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_zip: string | null;
  delivery_company: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_zip: string | null;
  special_instructions: string | null;
}

export type QuoteMappingResult =
  | { ok: true; draft: ShipmentDraft; warnings: readonly string[] }
  | { ok: false; reason: string };

/** `freight_quotes.pallets` is TEXT ("12", "12-14", "a few"). Parse honestly. */
export function parsePallets(raw: string | null): number | null {
  if (raw === null) return null;
  const match = /\d+/.exec(raw);
  if (match === null) return null;
  const value = Number(match[0]);
  return Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : null;
}

/**
 * A quote's pickup date is a DATE; a shipment's appointment is a TIMESTAMPTZ.
 * Promoted to local midnight in the operating zone rather than to UTC
 * midnight, so a 2026-03-10 pickup does not land on the 9th at 19:00 for the
 * dispatcher reading it. The value is a PLANNED date, not a confirmed
 * appointment time — which is why the conversion form lets a dispatcher set
 * the real appointment, and why the mapping emits a warning when it does this.
 */
export function dateToAppointment(date: string | null): string | null {
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  // Noon UTC: unambiguous on both sides of every DST boundary and in every US
  // zone, so the calendar date a dispatcher typed is the calendar date they
  // see back. Midnight is the one hour of the day where that is not true.
  return `${date}T12:00:00.000Z`;
}

/**
 * Map an accepted quote onto a shipment draft. **Pure** — no client, no
 * clock, no environment — which is what makes the mapping table testable
 * field by field rather than only end to end.
 *
 * THE RULES, each stated because each is a decision:
 *
 *   * **`shipper_id` carries over unchanged, and is MANDATORY.** The task
 *     names it and §11's whole portal depends on it: a shipment whose
 *     `shipper_id` differs from its quote's would show up in the wrong
 *     company's portal. A quote with no `shipper_id` (M-32's public-form path,
 *     never claimed by an account) CANNOT be converted — refused here rather
 *     than converted onto a guessed shipper.
 *   * **`quoted_rate` becomes `gross_shipper_amount`.** §18's staff-only gross
 *     is what the shipper was quoted. `carrier_pay` and `margin` are NOT
 *     derived — nobody has bought the truck yet, and inventing a margin from a
 *     rate nobody has paid is a fake metric (§11).
 *   * **Status is `quote_accepted`.** §20: "`quote_accepted` may move to
 *     `carrier_search`". Converting means the customer said yes; the carrier
 *     search is the dispatcher's next action, not the conversion's.
 *   * **`quote_id` is set**, so `idx_shipments_quote` answers "already
 *     converted?" and the created event records the provenance.
 *   * **City/state are required by the schema and often absent on a quote**
 *     (the public form takes ZIPs). Missing ones are refused with a reason
 *     rather than filled with a placeholder — "Unknown, XX" on an operational
 *     record is worse than a form the dispatcher has to complete.
 */
export function mapQuoteToShipmentDraft(
  quote: ConvertibleQuote,
): QuoteMappingResult {
  if (quote.shipper_id === null) {
    return {
      ok: false,
      reason:
        "This quote has no shipper account attached, so a shipment created from it would belong to nobody. Link the quote to a shipper company first.",
    };
  }
  const missing: string[] = [];
  if (!quote.pickup_city?.trim()) missing.push("pickup city");
  if (!quote.pickup_state?.trim()) missing.push("pickup state");
  if (!quote.delivery_city?.trim()) missing.push("delivery city");
  if (!quote.delivery_state?.trim()) missing.push("delivery state");
  if (!quote.equipment?.trim()) missing.push("equipment");
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `This quote is missing ${missing.join(", ")}. Fill it in on the quotes desk, or create the shipment directly and reference the quote.`,
    };
  }

  const warnings: string[] = [];
  if (quote.pickup_date !== null) {
    warnings.push(
      "The pickup date came from the quote as a calendar date. Set the real appointment time before dispatch.",
    );
  }
  if (quote.pallets !== null && parsePallets(quote.pallets) === null) {
    warnings.push(
      `Pallet count "${quote.pallets}" is not a number and was not carried over.`,
    );
  }
  if (quote.quoted_rate === null) {
    warnings.push("The quote has no rate, so the shipment has no gross amount yet.");
  }

  const draft: ShipmentDraft = {
    shipper_id: quote.shipper_id,
    quote_id: quote.id,
    status: "quote_accepted",
    origin_company: quote.pickup_company,
    origin_address: quote.pickup_address,
    origin_city: quote.pickup_city!.trim(),
    origin_state: quote.pickup_state!.trim().toUpperCase(),
    origin_zip: quote.pickup_zip,
    destination_company: quote.delivery_company,
    destination_address: quote.delivery_address,
    destination_city: quote.delivery_city!.trim(),
    destination_state: quote.delivery_state!.trim().toUpperCase(),
    destination_zip: quote.delivery_zip,
    equipment: quote.equipment!.trim(),
    commodity_category: quote.commodity,
    weight_lbs: quote.weight_lbs,
    pallets: parsePallets(quote.pallets),
    pickup_appointment_at: dateToAppointment(quote.pickup_date),
    delivery_appointment_at: dateToAppointment(quote.delivery_deadline),
    gross_shipper_amount: quote.quoted_rate,
  };

  return { ok: true, draft, warnings };
}
