import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { logShipmentSignal } from "@/lib/shipments/observability";
import type {
  EtaConfidence,
  EtaKind,
  EtaSource,
  ShipmentEventSource,
  ShipmentEventVisibility,
} from "@/lib/shipments/types";

/**
 * M-75 — §14's "update ETA", and an honest statement of where it stops.
 *
 * ── WHAT M-78 OWNS AND THIS FILE DOES NOT PRETEND TO ──────────────────────
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §7 assigns the ETA ARCHITECTURE to
 * **M-78**: *"ETA architecture (8 fields incl. `eta_confidence`, public/
 * internal delay reasons), ETA-change events, previous-value history"*, plus
 * `shipment_eta_history` (M-70's `ShipmentEtaHistoryRow`, a table M-71
 * deliberately did not create). M-75's own scope line says only "status/ETA
 * updates", and the task is explicit: *"wire what M-71's columns already have
 * and defer the rest honestly."*
 *
 * So this file writes EXACTLY the seven columns 0017 shipped —
 * `estimated_pickup_at`, `estimated_delivery_at`, `eta_source`,
 * `eta_confidence`, `eta_updated_at`, `delay_minutes`,
 * `delay_reason_public` / `delay_reason_internal` — and records the change as
 * an `eta_update` event carrying the PREVIOUS value in `metadata`.
 *
 * **Deferred to M-78, stated rather than implied:**
 *   * `shipment_eta_history` as a table (queryable ETA history, `event_id`
 *     back-reference, per-kind previous values). Today the history is real but
 *     lives in the event ledger, so M-78 arrives to data it can backfill from
 *     rather than to a column that was never populated.
 *   * Calculated and provider ETAs. `EtaSource` has `calculated`, `provider`
 *     and `dispatcher_adjusted` values; **nothing in M-75 writes them**, and
 *     the dispatcher form offers only `manual` and `dispatcher_adjusted`.
 *     Offering "calculated" from a form that does no calculation is precisely
 *     the fake capability §30 forbids.
 *   * Confidence decay, ETA recomputation on a location update, and the
 *     late-delivery sweep (`system` → `delayed`, M-79).
 *
 * ── §30: THE LABEL IS THE FEATURE ─────────────────────────────────────────
 *
 * `eta_source` is not decoration. M-73 and M-74 both render
 * `label.eta_dispatcher` when it says a human typed the ETA, and that label is
 * only honest if this write path never sets a source it cannot justify. It is
 * a REQUIRED argument here — no default — so a caller has to decide.
 */

export type EtaFailureCode =
  | "not_configured"
  | "shipment_not_found"
  | "no_change"
  | "invalid_input"
  | "write_failed";

export interface EtaFailure {
  ok: false;
  code: EtaFailureCode;
  message: string;
  shipmentId: string;
}

export interface EtaSuccess {
  ok: true;
  shipmentId: string;
  eventId: string;
  kind: EtaKind;
  previousAt: string | null;
  newAt: string | null;
  replayed: boolean;
}

export type EtaResult = EtaSuccess | EtaFailure;

/**
 * The dispatcher-settable ETA sources live in `types.ts`, not here: the form
 * that renders them is a CLIENT component, and this module carries
 * `server-only`. See `DISPATCHER_ETA_SOURCES` there for the §30 argument.
 */

export interface SetEtaInput {
  shipmentId: string;
  kind: EtaKind;
  /** `null` clears the ETA — and is recorded as a change, not as a no-op. */
  newAt: string | null;
  /** Required. See the §30 note above. */
  etaSource: EtaSource;
  etaConfidence?: EtaConfidence | null;
  delayMinutes?: number | null;
  /** Customer-safe wording — a D-6 phrase token or free text (§21, §24). */
  reasonPublic?: string | null;
  reasonInternal?: string | null;
  actorId: string | null;
  actorRole: "admin" | "dispatcher";
  source?: ShipmentEventSource;
  /** Defaults to `shipper`: an ETA change is the customer's own logistics. */
  visibility?: ShipmentEventVisibility;
  publicMessage?: string | null;
  idempotencyKey?: string | null;
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

export async function setShipmentEta(input: SetEtaInput): Promise<EtaResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message: "SUPABASE_SERVICE_ROLE_KEY is unset — the ETA was NOT written.",
      shipmentId: input.shipmentId,
    };
  }

  const { data, error } = await admin.rpc("set_shipment_eta", {
    p_shipment_id: input.shipmentId,
    p_kind: input.kind,
    p_new_eta_at: input.newAt,
    p_eta_source: input.etaSource,
    p_eta_confidence: input.etaConfidence ?? null,
    p_delay_minutes: input.delayMinutes ?? null,
    p_reason_public: input.reasonPublic ?? null,
    p_reason_internal: input.reasonInternal ?? null,
    p_actor: input.actorId,
    p_source: input.source ?? (input.actorRole === "admin" ? "admin" : "dispatcher"),
    p_visibility: input.visibility ?? "shipper",
    p_idempotency_key: input.idempotencyKey ?? null,
    p_public_message: input.publicMessage ?? null,
  });

  if (error) return etaFailure(error, input);

  const envelope = (data ?? {}) as Record<string, unknown>;
  const success: EtaSuccess = {
    ok: true,
    shipmentId: input.shipmentId,
    eventId: String(envelope.event_id ?? ""),
    kind: input.kind,
    previousAt:
      typeof envelope.previous_at === "string" ? envelope.previous_at : null,
    newAt: typeof envelope.new_at === "string" ? envelope.new_at : null,
    replayed: envelope.replayed === true,
  };

  if (!success.replayed) {
    await recordAuditEvent({
      actorId: input.actorId,
      action: "shipment.eta_update",
      targetTable: "shipments",
      targetId: input.shipmentId,
      detail: {
        eta_kind: input.kind,
        previous_at: success.previousAt,
        new_at: success.newAt,
        eta_source: input.etaSource,
        eta_confidence: input.etaConfidence ?? null,
        delay_minutes: input.delayMinutes ?? null,
        event_id: success.eventId,
        actor_role: input.actorRole,
      },
    });
  }

  return success;
}

function etaFailure(
  error: PostgrestLikeError,
  input: SetEtaInput,
): EtaFailure {
  let code: EtaFailureCode = "write_failed";
  let message =
    error.message ?? "Couldn't save the ETA. Retry and check the connection.";

  if (error.code === "PL404") {
    code = "shipment_not_found";
    message = "That shipment no longer exists.";
  } else if (error.code === "PL422") {
    // 0022 refuses a restatement of the SAME ETA with no delay information.
    // Surfaced as its own code so the form can say "nothing changed" rather
    // than "invalid" — the operator did nothing wrong.
    code = /already/.test(error.message ?? "") ? "no_change" : "invalid_input";
    message =
      code === "no_change"
        ? "That ETA is already set to this time. Change the time, or record delay minutes / a reason instead."
        : (error.message ?? message);
  } else if (error.code === "22P02" || error.code === "23514") {
    code = "invalid_input";
    message = "That date/time was rejected. Check the value and try again.";
  }

  // §26 names `eta_calculation_failure` among the nine tracked signals. It is
  // the right one even though nothing here CALCULATES: the signal is about
  // the ETA pipeline failing to produce a value, and M-78's calculator will
  // emit the same one rather than a tenth string.
  logShipmentSignal({
    signal: "eta_calculation_failure",
    code,
    shipmentId: input.shipmentId,
    actorRole: input.actorRole,
    actorId: input.actorId,
    detail: message,
  });

  return { ok: false, code, message, shipmentId: input.shipmentId };
}
