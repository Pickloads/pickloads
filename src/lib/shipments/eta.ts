import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getShipperOwnerRecipient, notifyCustomer } from "@/lib/notify";
import { logShipmentSignal } from "@/lib/shipments/observability";
import {
  ETA_ESTIMATE_METHOD,
  describeEstimate,
  estimateEta,
  type EtaEstimate,
  type EtaEstimateRefusal,
} from "@/lib/shipments/eta-estimate";
import type {
  EtaConfidence,
  EtaKind,
  EtaSource,
  ShipmentEventSource,
  ShipmentEventVisibility,
} from "@/lib/shipments/types";

/**
 * M-78 — §10's ETA architecture, complete. (M-75 owned the first half; this
 * file is the same module grown into the scope the plan assigned to M-78.)
 *
 * ── §10'S THREE OBLIGATIONS WHEN AN ETA CHANGES ───────────────────────────
 *
 * *"When ETA changes: create a shipment event; notify the customer according
 * to preferences; preserve previous ETA values in history or metadata."*
 *
 * All three happen, and each one has a named owner:
 *
 *   1. EVENT — `set_shipment_eta()` inserts the `eta_update` row in the same
 *      transaction as the column write (0022, unchanged).
 *   2. HISTORY — 0025 added the `shipment_eta_history` INSERT to that same
 *      transaction, carrying `previous_eta_at` beside `new_eta_at`. One
 *      statement, so an ETA whose history is missing is not a state the system
 *      can reach. The event ALSO keeps its metadata copy: §7 is append-only
 *      and deleting what past events said would rewrite history.
 *   3. NOTIFY — `notifyEtaChange()` below.
 *
 * ── WHAT "NOTIFY THE CUSTOMER" HONESTLY MEANS TODAY ───────────────────────
 *
 * The decision, argued rather than assumed. §17 names TWO launch channels:
 * email and in-app notifications. `src/lib/notify.ts` is the SHIPPED fan-out
 * that writes the in-app row and, when given a built email, sends it — it is
 * M-60's, it is used by five existing flows, and it already resolves the
 * recipient's locale from `profiles.preferred_language`.
 *
 * So this module CALLS it, with `email` omitted. That is the honest reuse:
 *   * the in-app notification is REAL today — the row appears in the shipper's
 *     portal feed, linked to the shipment, the moment the ETA moves;
 *   * the localized EMAIL is not, because there is no shipment email template
 *     in `src/emails/` and inventing one here would be M-79's eleven customer
 *     events, idempotency, dedupe, retry-with-backoff and preference matrix
 *     built badly in one file. Passing `email: null` sends nothing and claims
 *     nothing.
 *
 * The HAND-OFF is the `eta_update` event, which M-79's worker selects on. It
 * is already written, already carries the previous and new values, and already
 * has an idempotency key when the caller supplies one — so M-79 arrives to a
 * queue rather than to a retrofit.
 *
 * "According to preferences", stated exactly: the only customer preference
 * that EXISTS today is `profiles.preferred_language`, and `notifyCustomer`
 * honours it. There is no per-event opt-out table; M-79 owns it. This module
 * does not pretend to consult one.
 *
 * Two things it does decide, because they are §10's own logic and not M-79's:
 *   * a PICKUP ETA change does not notify the consignee-facing feed — §17's
 *     customer notification list names "delivery ETA updated", not pickup;
 *   * a REPLAYED write notifies nobody. A retried form submission must not
 *     produce a second notification, which is the one dedupe rule that can be
 *     honoured without M-79's infrastructure.
 *
 * ── §30 AND THE THREE REACHABLE SOURCES ───────────────────────────────────
 *
 *   `manual` / `dispatcher_adjusted` — a human typed it. The customer page
 *       labels it "ETA provided by dispatcher".
 *   `calculated` — the SERVER computed it from `shipments.distance_miles` by
 *       the stated method in `eta-estimate.ts`. The submitted datetime is
 *       DISCARDED; an operator cannot label a typed guess as calculated
 *       because the typed value never reaches the database on this path. The
 *       customer page labels it "Estimated from distance and standard transit
 *       times" — a different sentence, because it is a different claim.
 *   `provider` — UNREACHABLE. Nothing in this codebase receives an ETA from a
 *       telematics provider; M-80 owns those adapters. `DISPATCHER_ETA_SOURCES`
 *       excludes it, `UNREACHABLE_ETA_SOURCES` names it, and a unit test pins
 *       the partition so it cannot drift into the form by accident.
 *
 * `eta_source` remains a REQUIRED argument with no default. A caller has to
 * decide what claim it is making.
 */

export type EtaFailureCode =
  | "not_configured"
  | "shipment_not_found"
  | "no_change"
  | "invalid_input"
  /** §26 — `calculated` was asked for and the inputs could not support it. */
  | "cannot_calculate"
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
  /** The `shipment_eta_history` row 0025 wrote, when one was written. */
  historyId: string | null;
  kind: EtaKind;
  previousAt: string | null;
  newAt: string | null;
  replayed: boolean;
  /** Set when the source was `calculated` — the method's own account of itself. */
  estimate: EtaEstimate | null;
  /** True when the in-app customer notification was written (§10, §17). */
  customerNotified: boolean;
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
  /**
   * `null` clears the ETA — and is recorded as a change, not as a no-op.
   * IGNORED when `etaSource` is `calculated`: the server computes its own.
   */
  newAt: string | null;
  /** Required. See the §30 note above. */
  etaSource: EtaSource;
  etaConfidence?: EtaConfidence | null;
  delayMinutes?: number | null;
  /** Customer-safe wording — a D-6 phrase token or free text (§21, §24). */
  reasonPublic?: string | null;
  reasonInternal?: string | null;
  actorId: string | null;
  /**
   * M-76 widened this from `"admin" | "dispatcher"`. §13 lists "update ETA"
   * among a CARRIER's allowed actions, and the driver link inherits it, so
   * the two new values are the ones §13 names. It changes no behaviour beyond
   * the default event source below and the `actor_role` recorded in the audit
   * row — which is exactly the point of recording it.
   */
  actorRole: "admin" | "dispatcher" | "carrier" | "driver";
  source?: ShipmentEventSource;
  /** Defaults to `shipper`: an ETA change is the customer's own logistics. */
  visibility?: ShipmentEventVisibility;
  publicMessage?: string | null;
  idempotencyKey?: string | null;
  /**
   * Suppress the §10 customer notification. Used by the backfill/replay paths
   * and by tests; a form never sets it. Named rather than inferred so
   * "why didn't the customer get told?" has a greppable answer.
   */
  skipNotification?: boolean;
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

/**
 * The §7 event source that matches the actor, when the caller does not pick
 * one. A `Record` over the union rather than a ternary chain, so a fifth actor
 * is a compile error here instead of silently landing on "dispatcher" — an
 * event source is how §15 answers "who recorded this", and a wrong default
 * would put a driver's ETA in the dispatcher's name.
 */
const ETA_EVENT_SOURCE: Record<
  SetEtaInput["actorRole"],
  ShipmentEventSource
> = {
  admin: "admin",
  dispatcher: "dispatcher",
  carrier: "carrier",
  driver: "driver",
};

function defaultEtaSource(
  actorRole: SetEtaInput["actorRole"],
): ShipmentEventSource {
  return ETA_EVENT_SOURCE[actorRole];
}

/** Operator-readable refusals for the three ways an estimate can be refused. */
const ESTIMATE_REFUSAL_MESSAGE: Record<EtaEstimateRefusal, string> = {
  no_distance:
    "This shipment has no distance recorded, so there is nothing to calculate from. Enter the ETA yourself, or add the mileage first.",
  distance_out_of_range:
    "The recorded distance is outside the range this method can estimate from. Check the mileage, or enter the ETA yourself.",
  invalid_departure:
    "Couldn't read the departure time to estimate from. Enter the ETA yourself.",
};

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

  /*
   * §25 — ONE extra read, and only on the two paths that need it: the
   * calculated source needs `distance_miles`, and the notification needs
   * `shipper_id` + `tracking_number`. Both are on the same row, so the
   * `calculated` + notify case costs one query rather than two.
   *
   * The columns are named. §18's financial trio and `public_access_hash` are
   * not among them, so an ETA write never has a margin in memory.
   */
  const needsShipment =
    input.etaSource === "calculated" || input.skipNotification !== true;
  let distanceMiles: number | null = null;
  let shipperId: string | null = null;
  let trackingNumber: string | null = null;

  if (needsShipment) {
    const { data, error } = await admin
      .from("shipments")
      .select("distance_miles, shipper_id, tracking_number")
      .eq("id", input.shipmentId)
      .maybeSingle();
    if (error) {
      return etaFailure({ code: "PL500", message: error.message }, input);
    }
    if (!data) {
      return etaFailure(
        { code: "PL404", message: "shipment not found" },
        input,
      );
    }
    distanceMiles = data.distance_miles;
    shipperId = data.shipper_id;
    trackingNumber = data.tracking_number;
  }

  /*
   * THE CALCULATED PATH. `input.newAt` is discarded here, deliberately and
   * visibly: whatever the form submitted, the value stored is the one this
   * server computed. That is the whole mechanism behind the honest label —
   * `eta_source = 'calculated'` cannot be attached to an operator's number,
   * because on this branch the operator's number is not used.
   */
  let estimate: EtaEstimate | null = null;
  let newAt = input.newAt;
  let confidence = input.etaConfidence ?? null;
  let reasonInternal = input.reasonInternal ?? null;

  if (input.etaSource === "calculated") {
    const result = estimateEta(distanceMiles);
    if (!result.ok) {
      // §26 names `eta_calculation_failure` among the nine tracked signals,
      // and THIS is the case it was named for: the pipeline was asked for a
      // number and honestly could not produce one.
      logShipmentSignal({
        signal: "eta_calculation_failure",
        code: result.reason,
        shipmentId: input.shipmentId,
        trackingNumber,
        actorRole: input.actorRole,
        actorId: input.actorId,
        detail: `${ETA_ESTIMATE_METHOD}: ${result.reason}`,
      });
      return {
        ok: false,
        code: "cannot_calculate",
        message: ESTIMATE_REFUSAL_MESSAGE[result.reason],
        shipmentId: input.shipmentId,
      };
    }
    estimate = result;
    newAt = result.etaAt;
    // The method grades its own output; a form cannot overrule it upward.
    confidence = result.confidence;
    // The method's own account of itself, on the staff record. §24 exempts
    // internal staff notes from translation and this is one.
    reasonInternal = [reasonInternal, describeEstimate(result)]
      .filter((part): part is string => part !== null && part !== "")
      .join(" · ");
  }

  const { data, error } = await admin.rpc("set_shipment_eta", {
    p_shipment_id: input.shipmentId,
    p_kind: input.kind,
    p_new_eta_at: newAt,
    p_eta_source: input.etaSource,
    p_eta_confidence: confidence,
    p_delay_minutes: input.delayMinutes ?? null,
    p_reason_public: input.reasonPublic ?? null,
    p_reason_internal: reasonInternal,
    p_actor: input.actorId,
    p_source: input.source ?? defaultEtaSource(input.actorRole),
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
    historyId:
      typeof envelope.history_id === "string" ? envelope.history_id : null,
    kind: input.kind,
    previousAt:
      typeof envelope.previous_at === "string" ? envelope.previous_at : null,
    newAt: typeof envelope.new_at === "string" ? envelope.new_at : null,
    replayed: envelope.replayed === true,
    estimate,
    customerNotified: false,
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
        eta_confidence: confidence,
        delay_minutes: input.delayMinutes ?? null,
        event_id: success.eventId,
        history_id: success.historyId,
        estimate_method: estimate === null ? null : ETA_ESTIMATE_METHOD,
        actor_role: input.actorRole,
      },
    });

    // §10's second obligation. Best-effort by construction — see the note in
    // `notifyEtaChange`.
    success.customerNotified = await notifyEtaChange({
      kind: input.kind,
      shipperId,
      shipmentId: input.shipmentId,
      trackingNumber,
      skip: input.skipNotification === true,
    });
  }

  return success;
}

/* ------------------------------------------------------------------ *
 * §10 — "notify the customer according to preferences"
 * ------------------------------------------------------------------ */

interface NotifyEtaChangeInput {
  kind: EtaKind;
  shipperId: string | null;
  shipmentId: string;
  trackingNumber: string | null;
  skip: boolean;
}

/**
 * Write the in-app customer notification for an ETA change.
 *
 * BEST-EFFORT, and that is a decision rather than an oversight: the ETA is
 * already committed by the time this runs, so a notification failure must not
 * fail the operator's action and roll nothing back. `notifyCustomer` is itself
 * best-effort for the same reason (M-60), and this function returns a boolean
 * rather than throwing so the caller can record what actually happened.
 *
 * NO EMAIL. `email` is omitted, so `notifyCustomer` writes the feed row and
 * sends nothing. See the module header for why building a shipment email here
 * would be M-79's job done badly.
 *
 * The title carries the tracking number and nothing else. §17: *"do not expose
 * sensitive data"* — a notification row is rendered in a feed, may be
 * summarised in a push payload later, and has no business carrying a delay
 * reason, a customer's own commercial reference or an address.
 */
async function notifyEtaChange(
  input: NotifyEtaChangeInput,
): Promise<boolean> {
  // §17's customer list names "delivery ETA updated". A pickup ETA is
  // operational scheduling between dispatch and the carrier; the shipper sees
  // it on their timeline, which is where it belongs.
  if (input.skip || input.kind !== "delivery") return false;
  if (input.shipperId === null) return false;

  const admin = tryCreateAdminClient();
  if (!admin) return false;

  const recipient = await getShipperOwnerRecipient(admin, input.shipperId);
  // No portal owner = nobody to notify. Not an error: a shipment can be
  // created for an organization before its owner account is invited.
  if (!recipient) return false;

  await notifyCustomer({
    recipient,
    kind: "shipment_eta",
    title: `Updated delivery estimate — ${input.trackingNumber ?? "your shipment"}`,
    body: "Open the shipment for the current estimate and timeline.",
    href: `/portal/shipper/shipments/${input.shipmentId}`,
  });
  return true;
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
  // the right one even for a write failure: the signal is about the ETA
  // pipeline failing to produce a value, and the calculator above emits the
  // same one rather than a tenth string.
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
