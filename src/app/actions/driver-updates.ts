"use server";

import { headers } from "next/headers";

import { field, guardPublicForm } from "@/lib/forms/guard";
import type { FormState } from "@/lib/form-state";
import { firstIssueMessage } from "@/lib/validation/shared";
import {
  applyShipmentTransition,
  resolveShipmentFacts,
} from "@/lib/shipments/apply-transition";
import { setShipmentEta } from "@/lib/shipments/eta";
import { openShipmentException } from "@/lib/shipments/exceptions";
import {
  DRIVER_UPDATE_RATE_LIMIT,
  DRIVER_UPDATE_RATE_LIMIT_FORM,
  recordDriverUpdateRejected,
  redeemDriverToken,
  setDriverConsent,
  type DriverTokenGrant,
} from "@/lib/shipments/driver-access";
import {
  carrierAction,
  isFactIndependent,
  refuseCarrierAction,
  DRIVER_CONSENT_OFF_KEY,
  DRIVER_CONSENT_ON_KEY,
  DRIVER_CONSENT_REQUIRED_KEY,
  DRIVER_INVALID_KEY,
  DRIVER_LINK_EXPIRED_KEY,
  DRIVER_NOT_ALLOWED_KEY,
  DRIVER_NOT_NOW_KEY,
  DRIVER_RATE_LIMITED_KEY,
  DRIVER_REPORTED_KEY,
  DRIVER_SAVED_KEY,
  DRIVER_STALE_KEY,
  DRIVER_UNAVAILABLE_KEY,
} from "@/lib/shipments/carrier-updates";
import {
  driverConsentSchema,
  driverEtaSchema,
  driverExceptionSchema,
  driverStatusUpdateSchema,
} from "@/lib/validation/carrier-shipments";

/**
 * M-76 — the `/driver/update/[token]` write path (§13, §9, §19, §26, §30).
 *
 * ── THE ORDER OF OPERATIONS, AND WHY EACH STEP SITS WHERE IT DOES ────────
 *
 *   1. `guardPublicForm` — the repo's public-write pipeline (IP → Upstash
 *      rate limit → Turnstile). It runs FIRST because it is the only step
 *      that costs nothing on our side.
 *   2. Zod on the token's SHAPE, before it is hashed. A near-miss is refused
 *      without a database round trip.
 *   3. `redeemDriverToken` — 0023's single statement: the ledger-backed rate
 *      limit, the lookup, expiry, revocation and the carrier check, all
 *      atomic. Nothing about the shipment is known before this returns.
 *   4. Zod on the rest of the body.
 *   5. `refuseCarrierAction("driver", …)` — §13's action list intersected
 *      with M-72's graph, actor gate and preconditions.
 *   6. The engine, with `actor: "driver"`.
 *
 * ── WHY BOTH RATE LIMITS ─────────────────────────────────────────────────
 *
 * They protect different things. Upstash caps how many POSTs an address may
 * make, and it is the mechanism every other public form in this repo uses.
 * 0023's ledger count caps how many TOKEN PRESENTATIONS an address may make,
 * successful or not — which is the enumeration budget, and which has to be
 * the same write as the audit record or the two can disagree about what
 * happened. Neither substitutes for the other, and the ledger one is the
 * one that works in an environment with no Redis.
 *
 * ── EVERY REFUSAL IS A `FormState`, NEVER A THROW ────────────────────────
 *
 * A driver at a dock gets a sentence and a phone number, never a stack trace.
 * The engine's refusals are already typed and explanatory; what this file adds
 * is the translation from operator vocabulary into driver vocabulary, and the
 * ledger row that turns a refused attempt into §26 telemetry.
 *
 * ── NOTHING HERE READS A FINANCIAL COLUMN ────────────────────────────────
 *
 * §13: *"no access to financial data."* Not "does not render" — does not
 * read. The only shipment data this file ever holds is what
 * `redeemDriverToken` returns, and 0023's redeem payload names no financial
 * column at all.
 */

/* ------------------------------------------------------------------ *
 * Shared refusal vocabulary
 * ------------------------------------------------------------------ */

/**
 * The driver page renders MESSAGE KEYS, not English.
 *
 * §24 makes the driver surface a five-locale one and the plan calls drivers
 * "exactly the population the 5-locale requirement exists for". Returning an
 * English sentence from a server action would make every refusal English
 * regardless of the page's language — which is what M-73 avoided on `/track`
 * by returning keys, and what this file does for the same reason.
 */
function fail(key: string): FormState {
  return { status: "error", message: key };
}

function done(key: string): FormState {
  return { status: "success", message: key };
}

async function requestContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
}

type GateResult =
  | { ok: true; grant: DriverTokenGrant; ip: string | null; userAgent: string | null }
  | { ok: false; state: FormState };

/**
 * §13's gate: the public-form pipeline, then the token.
 *
 * Returns the grant or a rendered refusal. Every action in this file calls it
 * first, and `tests/unit/carrier-shipment-actions.test.ts` enumerates the
 * exports and asserts none of them skips it.
 */
async function driverGate(formData: FormData): Promise<GateResult> {
  const guard = await guardPublicForm(
    DRIVER_UPDATE_RATE_LIMIT_FORM,
    formData,
    DRIVER_UPDATE_RATE_LIMIT,
  );
  if (!guard.ok) return { ok: false, state: fail(DRIVER_RATE_LIMITED_KEY) };

  const { ip, userAgent } = await requestContext();
  const token = field(formData, "token");
  const result = await redeemDriverToken({ token, ip, userAgent });
  if (!result.ok) {
    return {
      ok: false,
      state: fail(
        result.code === "rate_limited"
          ? DRIVER_RATE_LIMITED_KEY
          : result.code === "unavailable"
            ? DRIVER_UNAVAILABLE_KEY
            : DRIVER_LINK_EXPIRED_KEY,
      ),
    };
  }
  return { ok: true, grant: result, ip, userAgent };
}

/* ================================================================== *
 * 1 · §13 limited status transitions
 * ================================================================== */

export async function driverStatusUpdateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await driverGate(formData);
  if (!gate.ok) return gate.state;
  const { grant, ip, userAgent } = gate;

  const parsed = driverStatusUpdateSchema.safeParse({
    token: field(formData, "token"),
    action: field(formData, "action"),
    expected_status: field(formData, "expected_status"),
    city: field(formData, "city"),
    state: field(formData, "state"),
    note: field(formData, "note"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const d = parsed.data;

  const action = carrierAction(d.action);
  if (action === null || action.kind !== "transition" || action.status === null) {
    await recordDriverUpdateRejected({
      tokenId: grant.tokenId,
      shipmentId: grant.shipment.shipment_id,
      detail: `unknown action ${String(d.action).slice(0, 40)}`,
      ip,
      userAgent,
    });
    return fail(DRIVER_INVALID_KEY);
  }

  /*
   * §9/§13 CONSENT GATE.
   *
   * A driver may always report a STATUS — that is a fact about freight, and
   * §13's whole purpose. What is gated is the LOCATION: city and state are
   * refused outright unless the driver has actively granted consent on this
   * link. Refused, not silently dropped — a location quietly discarded is a
   * driver who believes dispatch knows where the truck is.
   *
   * `consent_status` defaults to `pending` and the checkbox starts unticked,
   * so nothing is granted by omission. Granting is one tap and reversible.
   */
  const wantsLocation = d.city !== null || d.state !== null;
  if (wantsLocation && grant.consentStatus !== "granted") {
    await recordDriverUpdateRejected({
      tokenId: grant.tokenId,
      shipmentId: grant.shipment.shipment_id,
      detail: "location supplied without consent",
      ip,
      userAgent,
    });
    return fail(DRIVER_CONSENT_REQUIRED_KEY);
  }

  if (d.expected_status !== grant.shipment.status) return fail(DRIVER_STALE_KEY);

  // The fact-INDEPENDENT refusals first, with no facts argument: an action a
  // driver may never invoke — `confirm_dispatch` above all — costs zero
  // database reads, which is what makes probing the graph through a leaked
  // link cheap for us and expensive for whoever is doing it.
  const early = refuseCarrierAction("driver", d.action, grant.shipment.status);
  if (isFactIndependent(early)) {
    await recordDriverUpdateRejected({
      tokenId: grant.tokenId,
      shipmentId: grant.shipment.shipment_id,
      detail: `${early}: ${d.action}`,
      ip,
      userAgent,
    });
    return fail(
      early === "actor_not_permitted"
        ? DRIVER_NOT_ALLOWED_KEY
        : early === "unknown_action"
          ? DRIVER_INVALID_KEY
          : DRIVER_NOT_NOW_KEY,
    );
  }

  const facts = await resolveShipmentFacts(grant.shipment.shipment_id);
  // See the carrier action's note: `deliveryTimestamp` is a fact about THIS
  // request, and the engine merges it the same way before judging.
  const eventTime = new Date().toISOString();
  const refusal = refuseCarrierAction(
    "driver",
    d.action,
    grant.shipment.status,
    facts.ok ? { ...facts.facts, deliveryTimestamp: eventTime } : undefined,
  );
  if (refusal !== null) {
    await recordDriverUpdateRejected({
      tokenId: grant.tokenId,
      shipmentId: grant.shipment.shipment_id,
      detail: `${refusal}: ${d.action}`,
      ip,
      userAgent,
    });
    return fail(
      refusal === "actor_not_permitted"
        ? DRIVER_NOT_ALLOWED_KEY
        : refusal === "unknown_action"
          ? DRIVER_INVALID_KEY
          : DRIVER_NOT_NOW_KEY,
    );
  }

  const result = await applyShipmentTransition({
    shipmentId: grant.shipment.shipment_id,
    expectedStatus: d.expected_status,
    to: action.status,
    eventTime,
    // Reuse the facts already resolved — §25's "no N+1".
    ...(facts.ok ? { facts } : {}),
    // `actor: "driver"` — M-72's narrowest actor, and the reason the driver
    // cannot confirm dispatch even though the carrier can. `actorId` is NULL
    // because a driver has no profile: §13 says "no full portal account
    // required", and the token id in `metadata` is the attribution.
    actor: "driver",
    actorId: null,
    source: "driver",
    visibility: "carrier",
    internalMessage: d.note,
    city: d.city,
    state: d.state,
    metadata: {
      carrier_action: d.action,
      surface: "driver_link",
      driver_token_id: grant.tokenId,
      driver_name: grant.driverName,
      location_consent: grant.consentStatus,
    },
  });

  if (!result.ok) {
    await recordDriverUpdateRejected({
      tokenId: grant.tokenId,
      shipmentId: grant.shipment.shipment_id,
      detail: `${result.code}: ${action.status}`,
      ip,
      userAgent,
    });
    return fail(
      result.code === "status_conflict" ? DRIVER_STALE_KEY : DRIVER_NOT_NOW_KEY,
    );
  }
  return done(DRIVER_SAVED_KEY);
}

/* ================================================================== *
 * 2 · §13 "update ETA"
 * ================================================================== */

export async function driverEtaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await driverGate(formData);
  if (!gate.ok) return gate.state;
  const { grant, ip, userAgent } = gate;

  const parsed = driverEtaSchema.safeParse({
    token: field(formData, "token"),
    kind: field(formData, "kind"),
    eta_at: field(formData, "eta_at"),
    delay_minutes: field(formData, "delay_minutes"),
    note: field(formData, "note"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const d = parsed.data;

  const refusal = refuseCarrierAction(
    "driver",
    "update_eta",
    grant.shipment.status,
  );
  if (refusal !== null) {
    await recordDriverUpdateRejected({
      tokenId: grant.tokenId,
      shipmentId: grant.shipment.shipment_id,
      detail: `${refusal}: update_eta`,
      ip,
      userAgent,
    });
    return fail(DRIVER_NOT_NOW_KEY);
  }

  const result = await setShipmentEta({
    shipmentId: grant.shipment.shipment_id,
    kind: d.kind,
    newAt: d.eta_at,
    // §30: a human typed it. See `carrierEtaSchema`.
    etaSource: "manual",
    delayMinutes: d.delay_minutes,
    reasonInternal: d.note,
    actorId: null,
    actorRole: "driver",
    visibility: "carrier",
  });
  if (!result.ok) return fail(DRIVER_NOT_NOW_KEY);
  return done(DRIVER_SAVED_KEY);
}

/* ================================================================== *
 * 3 · §13 "submit exception"
 * ================================================================== */

export async function driverExceptionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const gate = await driverGate(formData);
  if (!gate.ok) return gate.state;
  const { grant, ip, userAgent } = gate;

  const parsed = driverExceptionSchema.safeParse({
    token: field(formData, "token"),
    exception_type: field(formData, "exception_type"),
    description: field(formData, "description"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const d = parsed.data;

  const refusal = refuseCarrierAction(
    "driver",
    "submit_exception",
    grant.shipment.status,
  );
  if (refusal !== null) {
    await recordDriverUpdateRejected({
      tokenId: grant.tokenId,
      shipmentId: grant.shipment.shipment_id,
      detail: `${refusal}: submit_exception`,
      ip,
      userAgent,
    });
    return fail(DRIVER_NOT_NOW_KEY);
  }

  /*
   * M-78 — the driver's report now opens a REAL §21 row, exactly as the
   * carrier portal's does. M-76 marked these events `m76_driver_report`
   * BECAUSE the table did not exist and named M-78 as the module that would
   * migrate them; 0025's backfill did, and deleted nothing.
   *
   * `driver_token_id` stays in `metadata` — it is an internal correlation id
   * for §13's audit, NOT a credential (the token itself exists only in the
   * driver's URL and is never stored in any form, hashed or otherwise).
   *
   * Severity `medium` and NOTHING published to the customer, for the same two
   * reasons argued in `carrierExceptionAction`.
   */
  const result = await openShipmentException({
    shipmentId: grant.shipment.shipment_id,
    exceptionType: d.exception_type,
    severity: "medium",
    publicDescription: null,
    internalDescription: d.description,
    openedBy: null,
    source: "driver",
    reportedBy: "driver",
    metadata: { driver_token_id: grant.tokenId },
  });
  if (!result.ok) return fail(DRIVER_NOT_NOW_KEY);
  return done(DRIVER_REPORTED_KEY);
}

/* ================================================================== *
 * 4 · §9/§13 consent
 * ================================================================== */

/**
 * The driver's own decision about location sharing.
 *
 * Deliberately NOT behind `driverGate`: it runs the public-form guard and
 * then `setDriverConsent`, which does its own expiry/revocation check. Going
 * through `redeemDriverToken` would burn a redemption — and therefore rate
 * budget and a ledger row — every time a driver toggled a checkbox, which
 * would let a driver lock themselves out of their own shipment by changing
 * their mind eight times.
 */
export async function driverConsentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const guard = await guardPublicForm(
    DRIVER_UPDATE_RATE_LIMIT_FORM,
    formData,
    DRIVER_UPDATE_RATE_LIMIT,
  );
  if (!guard.ok) return fail(DRIVER_RATE_LIMITED_KEY);

  const parsed = driverConsentSchema.safeParse({
    token: field(formData, "token"),
    granted: field(formData, "granted") || undefined,
  });
  if (!parsed.success) return fail(DRIVER_LINK_EXPIRED_KEY);

  const { ip, userAgent } = await requestContext();
  const result = await setDriverConsent({
    token: parsed.data.token,
    granted: parsed.data.granted,
    ip,
    userAgent,
  });
  if (!result.ok) {
    return fail(
      result.code === "expired"
        ? DRIVER_LINK_EXPIRED_KEY
        : DRIVER_UNAVAILABLE_KEY,
    );
  }
  return done(
    result.consentStatus === "granted"
      ? DRIVER_CONSENT_ON_KEY
      : DRIVER_CONSENT_OFF_KEY,
  );
}
