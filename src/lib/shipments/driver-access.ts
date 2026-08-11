import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { logShipmentSignal } from "@/lib/shipments/observability";
import {
  driverTokenExpiry,
  decoyDriverTokenHash,
  hashDriverToken,
  isDriverTokenConfigured,
  mintDriverToken,
  normalizeDriverToken,
} from "@/lib/shipments/driver-token";
import type {
  DriverTokenIssuerRole,
  DriverTokenOutcome,
  ShipmentStatus,
  TrackingConsentStatus,
} from "@/lib/shipments/types";

/**
 * M-76 — the server side of `/driver/update/[token]` (§13, §9, §19, §26, §30).
 *
 * `driver-token.ts` decides what a token IS. This file is the only thing in
 * the codebase that turns one into access, and it is the driver-side analogue
 * of M-75's `staff-access.ts`: one gate, called first by every entry point,
 * returning a typed grant or a typed refusal.
 *
 * ── §13's NINE REQUIREMENTS, AND WHERE EACH ONE ACTUALLY LIVES ────────────
 *
 *   short-lived           `driver-token.ts` mints the expiry; 0023's column is
 *                         NOT NULL and its CHECK refuses a past one
 *   shipment-scoped       0023's `shipment_id` + its immutability trigger
 *   only assigned shipment `issue_shipment_driver_token` refuses a carrier
 *                         that is not the shipment's, and `redeem_…` re-checks
 *                         on every presentation (a reassignment kills the link)
 *   limited transitions   `carrier-updates.ts`'s DRIVER matrix → M-72's engine
 *                         with `actor: "driver"`
 *   no financial data     three layers: 0023's redeem payload names no
 *                         financial column, this file never reads `shipments`
 *                         directly, and the driver view is its own DTO
 *   no other carriers     the carrier check above, plus the fact that a token
 *                         resolves to exactly one shipment
 *   rate limited          0023's `redeem_…`, counting the same ledger row the
 *                         audit requirement produces
 *   audit logged          `shipment_driver_token_access` (every presentation)
 *                         + `audit_events` (issue/revoke) + `shipment_events`
 *                         (every update the driver actually makes)
 *   revocable             `revokeDriverToken` → 0023, one-way by trigger
 *
 * ── ONE REFUSAL, ONE SHAPE (§13 "non-enumerable") ─────────────────────────
 *
 * `not_found`, `expired`, `revoked` and `carrier_released` collapse into the
 * SAME returned value: `{ ok: false, code: "expired" }`. Not similar —
 * identical, so no caller can accidentally render a different sentence for
 * one of them, and `tests/unit/shipment-driver-token.test.ts` asserts deep
 * equality across all four. The page renders §30's authored label
 * "Tracking link expired", which is the honest sentence for every one of
 * them: the link does not work any more, and why is not the driver's problem.
 *
 * M-73 authored `label.tracking_link_expired` in five locales and recorded
 * that it had no honest call site yet. This is that call site.
 *
 * ── WHY THERE IS NO UPSTASH CALL HERE ─────────────────────────────────────
 *
 * Every other public write in this repo rate-limits through
 * `guardPublicForm` → Upstash. The driver PAGE LOAD cannot: it is a GET on a
 * bearer credential, so the limit has to be applied before anything is read,
 * and it has to be applied to the same event the audit ledger records or the
 * two disagree about what happened. 0023's `redeem_…` does both in one
 * statement. The driver's POSTs still go through `guardPublicForm` on top of
 * it (see `src/app/actions/driver-updates.ts`), so the Upstash layer is
 * present where it fits and absent where it would have been a second,
 * weaker copy of a limit that already exists.
 */

/* ------------------------------------------------------------------ *
 * Rate-limit policy (§13)
 * ------------------------------------------------------------------ */

/** Window both counters are measured over, in minutes. */
export const DRIVER_TOKEN_WINDOW_MINUTES = 10;

/**
 * Failed presentations per IP per window before everything from that address
 * is refused.
 *
 * A driver holding a working link produces ZERO of these — a failure means
 * the token did not resolve, expired, was revoked, or belongs to a carrier
 * that no longer has the freight. Eight leaves room for a link that expired
 * mid-shift being retried a few times before the driver calls dispatch, and
 * caps a guesser at ~1 150 attempts a day per address against a 2^256 space.
 */
export const DRIVER_TOKEN_FAIL_LIMIT = 8;

/**
 * TOTAL presentations per IP per window, successes included.
 *
 * Much higher than the fail limit and for a different threat: this one exists
 * so a compromised link cannot be used to hammer the database, not to stop
 * guessing. It has to clear the honest ceiling by a wide margin — a yard full
 * of drivers behind one carrier's NAT, each reloading a page on bad signal —
 * because the failure mode of setting it too low is a driver at a dock who
 * cannot report a delivery.
 */
export const DRIVER_TOKEN_TOTAL_LIMIT = 60;

/**
 * The Upstash bucket the driver's POSTs use. Its own bucket, so a busy dock
 * cannot spend the contact form's budget or vice versa.
 */
export const DRIVER_UPDATE_RATE_LIMIT_FORM = "driver-update";

/** POSTs per IP per 10 minutes. A stop produces two or three. */
export const DRIVER_UPDATE_RATE_LIMIT = 12;

/* ------------------------------------------------------------------ *
 * Result types
 * ------------------------------------------------------------------ */

/**
 * Everything the driver page may know. This is the DTO §13's "no financial
 * data" clause is enforced by: `gross_shipper_amount`, `carrier_pay` and
 * `margin` are not fields here, are not columns in 0023's redeem payload, and
 * are therefore never read on this path at all.
 *
 * Note what else is absent: the shipper's identity, the shipper reference and
 * PO number (the broker's customer relationship is not the driver's), the
 * public access hash, and any internal note.
 */
export interface DriverShipmentView {
  /** §13: the driver page NEVER renders this; it is the write key only. */
  shipment_id: string;
  tracking_number: string;
  status: ShipmentStatus;
  origin_company: string | null;
  origin_city: string;
  origin_state: string;
  destination_company: string | null;
  destination_city: string;
  destination_state: string;
  pickup_appointment_at: string | null;
  delivery_appointment_at: string | null;
  equipment: string;
  current_city: string | null;
  current_state: string | null;
}

export interface DriverTokenGrant {
  ok: true;
  tokenId: string;
  carrierId: string;
  driverId: string | null;
  driverName: string | null;
  expiresAt: string;
  /** §9/§13 — `granted` is the only value that unlocks the location fields. */
  consentStatus: TrackingConsentStatus;
  useCount: number;
  shipment: DriverShipmentView;
}

export interface DriverTokenRefusal {
  ok: false;
  /**
   * `expired` covers unknown / expired / revoked / carrier-released — see the
   * header. `rate_limited` and `unavailable` are distinct because neither
   * says anything about any particular token: both are true for every input,
   * including inputs that do not exist, so neither is an oracle.
   */
  code: "expired" | "rate_limited" | "unavailable";
}

export type DriverTokenResult = DriverTokenGrant | DriverTokenRefusal;

/** Frozen so no caller can mutate the shared refusal into something narrower. */
const EXPIRED: DriverTokenRefusal = Object.freeze({
  ok: false,
  code: "expired",
} as const);
const RATE_LIMITED: DriverTokenRefusal = Object.freeze({
  ok: false,
  code: "rate_limited",
} as const);
const UNAVAILABLE: DriverTokenRefusal = Object.freeze({
  ok: false,
  code: "unavailable",
} as const);

/** The four outcomes that collapse into one refusal (§13 non-enumerable). */
const INDISTINGUISHABLE: readonly DriverTokenOutcome[] = [
  "not_found",
  "expired",
  "revoked",
  "carrier_released",
];

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/* ------------------------------------------------------------------ *
 * Redemption — the only door
 * ------------------------------------------------------------------ */

export interface DriverTokenRequest {
  /** Straight out of the URL segment. Normalised and hashed here. */
  token: unknown;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Present a token and, if it holds, get the shipment.
 *
 * A malformed token still calls the RPC — with a well-formed hash of the
 * empty string, which cannot match any row. Short-circuiting on shape would
 * make "not a token at all" the fast path and leave the ledger blind to
 * exactly the scripted scan §26 wants counted.
 */
export async function redeemDriverToken(
  request: DriverTokenRequest,
): Promise<DriverTokenResult> {
  const admin = tryCreateAdminClient();
  if (admin === null || !isDriverTokenConfigured()) {
    logShipmentSignal({
      signal: "unauthorized_access_attempt",
      code: "driver_token_not_configured",
      detail:
        admin === null
          ? "service-role key unset — driver links cannot be redeemed"
          : "DRIVER_TOKEN_SECRET unset — driver links cannot be verified",
    });
    return UNAVAILABLE;
  }

  // `hashDriverToken` returns null for a malformed token, so the fallback is
  // the DECOY hash — well-formed, keyed, and impossible for any issued token
  // to equal. That keeps the RPC call unconditional (see above), so a
  // malformed token spends rate budget, reaches the ledger as `not_found` and
  // gets the SAME refusal as an unknown one.
  //
  // M-83 FIXED THIS. The fallback used to be `hashDriverToken("")`, which is
  // itself null — the empty string is malformed — so every malformed token
  // returned `unavailable` without touching the database. `/driver/update/
  // [token]` renders `unavailable` as a different card from `expired`, which
  // made the shape of the input observable in the response and left a
  // scripted scan of garbage tokens uncounted and unlimited.
  const hash = hashDriverToken(request.token) ?? decoyDriverTokenHash();
  if (hash === null) return UNAVAILABLE;

  const { data, error } = await admin.rpc("redeem_shipment_driver_token", {
    p_token_hash: hash,
    p_ip: request.ip,
    p_user_agent: request.userAgent,
    p_window_minutes: DRIVER_TOKEN_WINDOW_MINUTES,
    p_fail_limit: DRIVER_TOKEN_FAIL_LIMIT,
    p_total_limit: DRIVER_TOKEN_TOTAL_LIMIT,
  });

  if (error) {
    logShipmentSignal({
      signal: "unauthorized_access_attempt",
      code: "driver_token_redeem_failed",
      detail: error.message,
    });
    return UNAVAILABLE;
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const outcome = asString(row.outcome) as DriverTokenOutcome | null;

  if (outcome === "rate_limited") {
    // §26 names "repeated invalid tracking attempts" as a signal; a driver-link
    // sweep is the same shape on a different credential, so it reuses the
    // signal rather than inventing a tenth one M-84b would not know about.
    logShipmentSignal({
      signal: "repeated_invalid_tracking_attempts",
      code: "driver_token_rate_limited",
      detail: "driver link presentation rate limit tripped",
    });
    return RATE_LIMITED;
  }

  if (outcome === null || INDISTINGUISHABLE.includes(outcome)) {
    logShipmentSignal({
      signal: "unauthorized_access_attempt",
      code: `driver_token_${outcome ?? "unknown"}`,
      detail: "driver link presented and refused",
    });
    return EXPIRED;
  }

  if (outcome !== "granted") return UNAVAILABLE;

  const shipmentId = asString(row.shipment_id);
  const tokenId = asString(row.token_id);
  const carrierId = asString(row.carrier_id);
  const status = asString(row.status) as ShipmentStatus | null;
  if (
    shipmentId === null ||
    tokenId === null ||
    carrierId === null ||
    status === null
  ) {
    return UNAVAILABLE;
  }

  return {
    ok: true,
    tokenId,
    carrierId,
    driverId: asString(row.driver_id),
    driverName: asString(row.driver_name),
    expiresAt: asString(row.expires_at) ?? "",
    consentStatus:
      (asString(row.consent_status) as TrackingConsentStatus | null) ??
      "pending",
    useCount: asNumber(row.use_count),
    shipment: {
      shipment_id: shipmentId,
      tracking_number: asString(row.tracking_number) ?? "",
      status,
      origin_company: asString(row.origin_company),
      origin_city: asString(row.origin_city) ?? "",
      origin_state: asString(row.origin_state) ?? "",
      destination_company: asString(row.destination_company),
      destination_city: asString(row.destination_city) ?? "",
      destination_state: asString(row.destination_state) ?? "",
      pickup_appointment_at: asString(row.pickup_appointment_at),
      delivery_appointment_at: asString(row.delivery_appointment_at),
      equipment: asString(row.equipment) ?? "",
      current_city: asString(row.current_city),
      current_state: asString(row.current_state),
    },
  };
}

/**
 * Record an attempt that was refused AFTER the token resolved — an
 * unpermitted transition, an unmet precondition, a location without consent.
 *
 * §26 names "unauthorized access attempts" as a tracked signal, and the ledger
 * is where an operator counts them. It also feeds the rate limiter, so a
 * driver link being used to probe the transition graph burns the same budget
 * a scripted guesser does. Best-effort: the caller is already refusing, so a
 * failed ledger write must not turn a clean refusal into a 500.
 */
export async function recordDriverUpdateRejected(entry: {
  tokenId: string;
  shipmentId: string;
  detail: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const admin = tryCreateAdminClient();
  if (admin === null) return;
  const { error } = await admin.from("shipment_driver_token_access").insert({
    token_id: entry.tokenId,
    shipment_id: entry.shipmentId,
    outcome: "update_rejected",
    detail: entry.detail.slice(0, 200),
    ip: entry.ip,
    user_agent: entry.userAgent,
  });
  if (error) {
    console.error("[driver-access] rejection ledger write failed", error.message);
  }
  logShipmentSignal({
    signal: "unauthorized_access_attempt",
    code: "driver_update_rejected",
    shipmentId: entry.shipmentId,
    actorRole: "driver",
    detail: entry.detail,
  });
}

/* ------------------------------------------------------------------ *
 * Issue / revoke (§13 lifecycle)
 * ------------------------------------------------------------------ */

export interface IssueDriverTokenInput {
  shipmentId: string;
  carrierId: string;
  driverId?: string | null;
  driverName?: string | null;
  issuedBy: string | null;
  issuedByRole: DriverTokenIssuerRole;
}

export type IssueDriverTokenResult =
  | {
      ok: true;
      tokenId: string;
      /**
       * THE ONLY TIME THE PLAINTEXT TOKEN EXISTS OUTSIDE THE DRIVER'S PHONE.
       * It is returned once, rendered once on the issuing surface so it can
       * be copied into a text message, and never retrievable again — the row
       * holds a hash. A "show me that link again" button is impossible by
       * construction, which is the correct trade: re-issuing is one click and
       * a link nobody can re-read is a link that cannot leak from the portal.
       */
      token: string;
      expiresAt: string;
    }
  | { ok: false; code: "not_configured" | "refused"; message: string };

export async function issueDriverToken(
  input: IssueDriverTokenInput,
): Promise<IssueDriverTokenResult> {
  const admin = tryCreateAdminClient();
  if (admin === null || !isDriverTokenConfigured()) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "Driver links are not configured in this environment (DRIVER_TOKEN_SECRET). Nothing was issued.",
    };
  }

  const token = mintDriverToken();
  const hash = token === null ? null : hashDriverToken(token);
  if (token === null || hash === null) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "Driver links are not configured in this environment (DRIVER_TOKEN_SECRET). Nothing was issued.",
    };
  }

  const expiresAt = driverTokenExpiry();
  const { data, error } = await admin.rpc("issue_shipment_driver_token", {
    p_shipment_id: input.shipmentId,
    p_carrier_id: input.carrierId,
    p_token_hash: hash,
    p_expires_at: expiresAt,
    p_driver_id: input.driverId ?? null,
    p_driver_name: input.driverName ?? null,
    p_issued_by_role: input.issuedByRole,
    p_issued_by: input.issuedBy,
    p_label: null,
    p_source: input.issuedByRole === "carrier" ? "carrier" : "dispatcher",
  });

  if (error) {
    logShipmentSignal({
      signal: "status_update_error",
      code: error.code ?? "driver_token_issue_failed",
      shipmentId: input.shipmentId,
      actorRole: input.issuedByRole,
      actorId: input.issuedBy,
      detail: error.message,
    });
    return { ok: false, code: "refused", message: error.message };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const tokenId = asString(row.token_id) ?? "";

  // §15's operator ledger, through the M-69 single writer. The token is NOT
  // in `detail` — §26's never-log list names access tokens outright, and
  // `audit_events` is a table operators read.
  await recordAuditEvent({
    actorId: input.issuedBy,
    action: "shipment.driver_token_issued",
    targetTable: "shipment_driver_tokens",
    targetId: tokenId,
    detail: {
      shipment_id: input.shipmentId,
      carrier_id: input.carrierId,
      driver_id: input.driverId ?? null,
      issued_by_role: input.issuedByRole,
      expires_at: expiresAt,
    },
  });

  return { ok: true, tokenId, token, expiresAt };
}

export type RevokeDriverTokenResult =
  | { ok: true; alreadyRevoked: boolean; shipmentId: string }
  | { ok: false; message: string };

export async function revokeDriverToken(input: {
  tokenId: string;
  reason: string | null;
  actorId: string | null;
  actorRole: DriverTokenIssuerRole;
}): Promise<RevokeDriverTokenResult> {
  const admin = tryCreateAdminClient();
  if (admin === null) {
    return {
      ok: false,
      message:
        "SUPABASE_SERVICE_ROLE_KEY is unset — the link was NOT revoked. Call dispatch.",
    };
  }

  const { data, error } = await admin.rpc("revoke_shipment_driver_token", {
    p_token_id: input.tokenId,
    p_reason: input.reason,
    p_actor: input.actorId,
    p_source: input.actorRole === "carrier" ? "carrier" : "dispatcher",
  });
  if (error) return { ok: false, message: error.message };

  const row = (data ?? {}) as Record<string, unknown>;
  const alreadyRevoked = row.already_revoked === true;

  if (!alreadyRevoked) {
    await recordAuditEvent({
      actorId: input.actorId,
      action: "shipment.driver_token_revoked",
      targetTable: "shipment_driver_tokens",
      targetId: input.tokenId,
      detail: {
        shipment_id: asString(row.shipment_id),
        actor_role: input.actorRole,
        reason: input.reason,
      },
    });
  }

  return {
    ok: true,
    alreadyRevoked,
    shipmentId: asString(row.shipment_id) ?? "",
  };
}

/* ------------------------------------------------------------------ *
 * §9/§13 consent
 * ------------------------------------------------------------------ */

export type DriverConsentResult =
  | { ok: true; consentStatus: TrackingConsentStatus; changed: boolean }
  | { ok: false; code: "expired" | "unavailable" };

/**
 * Record the driver's own decision about location sharing.
 *
 * §9/§13: *"Driver consent must be considered for location tracking."* This is
 * where "considered" becomes a fact with a timestamp and a timeline event.
 * Two properties make it consent rather than a setting:
 *
 *   * the column defaults to `pending` and the page's checkbox starts
 *     UNTICKED, so nothing is granted by omission;
 *   * `denied` is a first-class outcome that the driver can choose and can
 *     change later, not a synonym for "has not answered yet".
 *
 * Takes the token, not an id — the driver page holds nothing else, and giving
 * it an id-shaped argument would mean teaching it an internal identifier,
 * which is the thing §13 forbids exposing.
 */
export async function setDriverConsent(input: {
  token: unknown;
  granted: boolean;
  ip: string | null;
  userAgent: string | null;
}): Promise<DriverConsentResult> {
  const admin = tryCreateAdminClient();
  if (admin === null || !isDriverTokenConfigured()) {
    return { ok: false, code: "unavailable" };
  }
  if (normalizeDriverToken(input.token) === null) {
    return { ok: false, code: "expired" };
  }
  const hash = hashDriverToken(input.token);
  if (hash === null) return { ok: false, code: "unavailable" };

  const { data, error } = await admin.rpc("set_driver_token_consent", {
    p_token_hash: hash,
    p_granted: input.granted,
    p_ip: input.ip,
    p_user_agent: input.userAgent,
  });
  if (error) return { ok: false, code: "unavailable" };

  const row = (data ?? {}) as Record<string, unknown>;
  const outcome = asString(row.outcome);
  if (outcome !== "granted") {
    // Same collapse as redemption: not_found / expired / revoked are one
    // refusal, so the consent form is not an existence oracle either.
    return { ok: false, code: "expired" };
  }
  return {
    ok: true,
    consentStatus:
      (asString(row.consent_status) as TrackingConsentStatus | null) ??
      "pending",
    changed: row.changed === true,
  };
}
