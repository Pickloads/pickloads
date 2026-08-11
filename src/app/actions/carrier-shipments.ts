"use server";

import { revalidatePath } from "next/cache";

import { field } from "@/lib/forms/guard";
import type { FormState } from "@/lib/form-state";
import { firstIssueMessage } from "@/lib/validation/shared";
import {
  appendShipmentEvent,
  applyShipmentTransition,
  resolveShipmentFacts,
} from "@/lib/shipments/apply-transition";
import { setShipmentEta } from "@/lib/shipments/eta";
import {
  issueDriverToken,
  revokeDriverToken,
} from "@/lib/shipments/driver-access";
import {
  driverUpdatePath,
  isDriverTokenConfigured,
} from "@/lib/shipments/driver-token";
import {
  carrierAction,
  isFactIndependent,
  refuseCarrierAction,
  CARRIER_REFUSAL_MESSAGES,
  CARRIER_STALE_PAGE_MESSAGE,
} from "@/lib/shipments/carrier-updates";
import {
  resolveCarrierShipmentAccess,
  type CarrierShipmentAccessGrant,
} from "@/lib/shipments/carrier-access";
import {
  carrierEtaSchema,
  carrierExceptionSchema,
  carrierStatusUpdateSchema,
  issueDriverTokenSchema,
  revokeDriverTokenSchema,
} from "@/lib/validation/carrier-shipments";
import { createClient } from "@/lib/supabase/server";

/**
 * M-76 — the §13 CARRIER PORTAL actions.
 *
 * ── THE FOUR RULES, MIRRORED FROM M-75 AND NOT COPIED ────────────────────
 *
 *   1. **`resolveCarrierShipmentAccess` first, always.** A server action is a
 *      public HTTP endpoint; the page that rendered its form is not a
 *      control. The gate re-reads the session, resolves the carrier through
 *      M-57's membership helper and re-reads the shipment through the
 *      COOKIE-BOUND client so 0018's `"carrier member read shipments"` policy
 *      applies. `tests/unit/carrier-shipment-actions.test.ts` ENUMERATES the
 *      exports of this file and asserts none of them skips it.
 *   2. **Zod before any write**, over schemas whose key sets exclude every
 *      §18 financial column (§19's "approved fields").
 *   3. **Never a raw UPDATE on a status.** Every status move is
 *      `applyShipmentTransition` with `actor: "carrier"` — M-72's graph, its
 *      actor gate, its preconditions and its compare-and-swap. This file
 *      invents no event semantics and re-implements no engine, and it never
 *      passes `actor: "dispatcher"` from a carrier surface, which is the one
 *      thing M-72's extension note asks of M-76 by name.
 *   4. **The engine and the RPCs journal their own writes** through the M-69
 *      single writer, so an action that composes two of them does not
 *      double-journal.
 *
 * ── WHAT A CARRIER CANNOT DO HERE, BY CONSTRUCTION ───────────────────────
 *
 * Cancel a shipment (a commercial decision), complete one (closeout is a
 * brokerage act), accept a quote, assign itself, correct a status (§20's
 * admin-only flow), touch any financial column, or act on another carrier's
 * freight. The first five are `ACTOR_PERMITTED_TARGETS.carrier` and
 * `actorMayCorrect`; the sixth is the schemas; the seventh is the gate plus
 * 0018's policy.
 */

const CARRIER_PATH = "/portal/carrier/shipments";

function refresh(shipmentId?: string): void {
  revalidatePath(CARRIER_PATH);
  if (shipmentId) revalidatePath(`${CARRIER_PATH}/${shipmentId}`);
}

function error(message: string): FormState {
  return { status: "error", message };
}

function ok(message: string): FormState {
  return { status: "success", message };
}

/** Every action's opening move. */
async function gate(
  formData: FormData,
): Promise<CarrierShipmentAccessGrant | { ok: false; message: string }> {
  const access = await resolveCarrierShipmentAccess(
    field(formData, "shipment_id"),
  );
  return access.ok ? access : { ok: false, message: access.message };
}

/* ================================================================== *
 * 1 · §13 status updates (confirm dispatch … delivered)
 * ================================================================== */

export async function carrierStatusUpdateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = carrierStatusUpdateSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    action: field(formData, "action"),
    expected_status: field(formData, "expected_status"),
    city: field(formData, "city"),
    state: field(formData, "state"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const action = carrierAction(d.action);
  if (action === null || action.kind !== "transition" || action.status === null) {
    return error(CARRIER_REFUSAL_MESSAGES.unknown_action);
  }

  // The engine judges against the status the SERVER just read, not the one
  // the form carried — but the compare-and-swap uses the form's, so a page
  // that has gone stale is refused rather than silently applied to a
  // different edge. Both matter; they are different guarantees.
  if (d.expected_status !== access.status) return error(CARRIER_STALE_PAGE_MESSAGE);

  // The fact-INDEPENDENT refusals first, with no facts argument: an action a
  // carrier may never invoke costs zero database reads.
  const early = refuseCarrierAction("carrier", d.action, access.status);
  if (isFactIndependent(early)) return error(CARRIER_REFUSAL_MESSAGES[early]);

  const facts = await resolveShipmentFacts(access.shipmentId);
  /*
   * `deliveryTimestamp` is a fact about THIS REQUEST, not about history —
   * §20's "`delivered` may require delivery timestamp" is a property of the
   * assertion being made. `applyShipmentTransition` merges it the same way
   * before it judges, so omitting it here would make the pre-check refuse
   * every "delivered" the engine would then accept. The integration lane
   * caught exactly that.
   */
  const eventTime = new Date().toISOString();
  const refusal = refuseCarrierAction(
    "carrier",
    d.action,
    access.status,
    facts.ok ? { ...facts.facts, deliveryTimestamp: eventTime } : undefined,
  );
  if (refusal !== null) return error(CARRIER_REFUSAL_MESSAGES[refusal]);

  const result = await applyShipmentTransition({
    shipmentId: access.shipmentId,
    expectedStatus: d.expected_status,
    to: action.status,
    eventTime,
    // Reuse the facts already resolved — §25's "no N+1". Without this the
    // engine resolves them a second time on the same request.
    ...(facts.ok ? { facts } : {}),
    actor: "carrier",
    actorId: access.session.userId,
    source: "carrier",
    // The `carrier` band, never `public`. A carrier's status move IS visible
    // to the customer — as the STATUS on their tracking page, which M-73
    // renders from `shipments.status` — but the event's message text is the
    // carrier's own operational note, and D-6 governs what reaches a
    // five-locale customer timeline. Dispatch publishes the customer-facing
    // sentence from the curated library.
    visibility: "carrier",
    internalMessage: d.note,
    city: d.city,
    state: d.state,
    metadata: { carrier_action: d.action, surface: "carrier_portal" },
  });

  if (!result.ok) {
    if (result.code === "status_conflict") return error(CARRIER_STALE_PAGE_MESSAGE);
    return error(result.message);
  }
  refresh(access.shipmentId);
  return ok(result.replayed ? "Already recorded." : "Update recorded.");
}

/* ================================================================== *
 * 2 · §13 "update ETA"
 * ================================================================== */

export async function carrierEtaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = carrierEtaSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    kind: field(formData, "kind"),
    eta_at: field(formData, "eta_at"),
    delay_minutes: field(formData, "delay_minutes"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const refusal = refuseCarrierAction("carrier", "update_eta", access.status);
  if (refusal !== null) return error(CARRIER_REFUSAL_MESSAGES[refusal]);

  const result = await setShipmentEta({
    shipmentId: access.shipmentId,
    kind: d.kind,
    newAt: d.eta_at,
    // §30: a carrier typed it, so it is `manual` and nothing else. See
    // `carrierEtaSchema` for why the source is not a form field.
    etaSource: "manual",
    delayMinutes: d.delay_minutes,
    reasonInternal: d.note,
    actorId: access.session.userId,
    actorRole: "carrier",
    // `carrier`, not the `shipper` default: the customer's ETA is what
    // dispatch confirms, not what the truck last guessed. The value lands on
    // the shipment either way — this governs who sees the EVENT.
    visibility: "carrier",
  });

  if (!result.ok) return error(result.message);
  refresh(access.shipmentId);
  return ok("ETA updated. Dispatch has been notified.");
}

/* ================================================================== *
 * 3 · §13 "submit exception"
 * ================================================================== */

export async function carrierExceptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = carrierExceptionSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    exception_type: field(formData, "exception_type"),
    description: field(formData, "description"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  const refusal = refuseCarrierAction(
    "carrier",
    "submit_exception",
    access.status,
  );
  if (refusal !== null) return error(CARRIER_REFUSAL_MESSAGES[refusal]);

  /*
   * §21's `shipment_exceptions` table is M-78's and does NOT exist. M-75
   * settled the pattern and M-76 follows it exactly rather than creating half
   * a table: the exception is an `exception_opened` event carrying the §21
   * type and severity in `metadata`, marked with an
   * `exception_source` so M-78's backfill can select on it.
   *
   * `severity` is fixed at `medium` — see `carrierExceptionSchema` for why a
   * carrier does not triage their own exception.
   */
  const result = await appendShipmentEvent({
    shipmentId: access.shipmentId,
    eventType: "exception_opened",
    actor: "carrier",
    actorId: access.session.userId,
    source: "carrier",
    visibility: "carrier",
    internalMessage: d.description,
    metadata: {
      exception_type: d.exception_type,
      severity: "medium",
      exception_source: "m76_carrier_report",
      reported_by: "carrier",
    },
    status: access.status,
  });

  if (!result.ok) return error(result.message);
  refresh(access.shipmentId);
  return ok("Reported to dispatch. We'll call you if we need more.");
}

/* ================================================================== *
 * 4 · §13 driver-link lifecycle (carrier half)
 * ================================================================== */

/**
 * Issue a driver link for a shipment this carrier is hauling.
 *
 * THE PLAINTEXT TOKEN IS IN THE RETURN VALUE AND NOWHERE ELSE. It is rendered
 * once so it can be copied into a text message, and it is never retrievable —
 * `shipment_driver_tokens` holds a hash and `token_hash` is column-revoked
 * from every browser-reachable role. A "show me that link again" feature is
 * impossible by construction, which is the right trade: re-issuing is one
 * click, and a link the portal cannot re-read is a link the portal cannot
 * leak.
 */
export async function issueDriverLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = issueDriverTokenSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    driver_id: field(formData, "driver_id"),
    driver_name: field(formData, "driver_name"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));
  const d = parsed.data;

  if (!isDriverTokenConfigured()) {
    return error(
      "Driver links aren't switched on in this environment yet. Call dispatch on (908) 404-5373 and we'll take the update by phone.",
    );
  }

  const result = await issueDriverToken({
    shipmentId: access.shipmentId,
    carrierId: access.carrierId,
    driverId: d.driver_id,
    driverName: d.driver_name,
    issuedBy: access.session.userId,
    issuedByRole: "carrier",
  });
  if (!result.ok) return error(result.message);

  refresh(access.shipmentId);
  return ok(
    `Send this to the driver — it works once, expires, and can be revoked: ${driverUpdatePath(result.token)}`,
  );
}

export async function revokeDriverLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await gate(formData);
  if (!access.ok) return error(access.message);

  const parsed = revokeDriverTokenSchema.safeParse({
    token_id: field(formData, "token_id"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return error(firstIssueMessage(parsed.error));

  /*
   * The gate proved the CARRIER may act on the SHIPMENT. It has not proved
   * this token belongs to this shipment, and `revoke_shipment_driver_token`
   * takes an id — so without this read, a carrier could revoke any link in
   * the system by posting somebody else's token id. The read goes through the
   * COOKIE-BOUND client, so 0023's `"carrier member read driver tokens"`
   * policy applies on top of the `shipment_id` predicate: two independent
   * reasons the row is unreachable.
   */
  const supabase = await createClient();
  const { data: token } = await supabase
    .from("shipment_driver_tokens")
    .select("id, shipment_id")
    .eq("id", parsed.data.token_id)
    .eq("shipment_id", access.shipmentId)
    .maybeSingle();
  if (!token) return error("That link no longer exists.");

  const result = await revokeDriverToken({
    tokenId: parsed.data.token_id,
    reason: parsed.data.reason,
    actorId: access.session.userId,
    actorRole: "carrier",
  });
  if (!result.ok) return error(result.message);

  refresh(access.shipmentId);
  return ok(
    result.alreadyRevoked
      ? "That link was already revoked."
      : "Link revoked. It stops working immediately.",
  );
}
