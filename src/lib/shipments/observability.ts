/**
 * M-72 — §26 observability hooks for the shipment domain.
 *
 * WHAT THIS IS AND IS NOT. `FINAL-IMPLEMENTATION-PLAN` §2 correction C-5 is
 * blunt: Sentry is a DSN in `.env.example` and nothing else, so §26's
 * "use existing Sentry and logging infrastructure" rests on a false premise
 * and the plan moves real observability to **M-84b**. This module is not that
 * module. It is the CALL-SITE SHAPE — one function, a closed signal
 * vocabulary, a structured payload — so that when M-84b wires a transport it
 * edits this file and nothing else. No framework is invented here; the
 * transport is `console`, exactly what the codebase already uses.
 *
 * WHY IT EXISTS IN M-72 AT ALL. §26 names *"status-update errors"* as one of
 * its nine tracked signals, and this is the module that produces them. A
 * failed transition that logs nothing is indistinguishable from one that never
 * happened; retrofitting the call sites later means auditing every branch of
 * every server action a second time.
 *
 * §26's NEVER-LOG LIST is enforced by construction, not by discipline.
 * `logShipmentSignal` takes a fixed, named field set — there is no `payload`,
 * no `...rest`, no object spread. Passwords, bank details, EIN plaintext,
 * document contents and access tokens have no parameter to arrive through. The
 * one free-text field, `detail`, is truncated and swept for credential shapes
 * before it is written, because the realistic leak is not somebody logging a
 * password on purpose — it is a driver-link URL or a provider error string
 * containing a bearer token being passed through verbatim.
 *
 * Exact location is likewise absent: §26 forbids logging position "beyond
 * operational need", so a signal carries `city`/`state` at most and never
 * coordinates. M-80's provider failures follow the same rule.
 */

import type { ShipmentStatus } from "@/lib/shipments/types";

/**
 * §26's nine tracked signals, named as the directive names them. A closed
 * union so M-84b can map each one to a severity and a Sentry fingerprint
 * without discovering a tenth string in production.
 */
export type ShipmentSignal =
  | "public_tracking_failure"
  | "repeated_invalid_tracking_attempts"
  | "status_update_error"
  | "webhook_failure"
  | "notification_failure"
  | "location_provider_failure"
  | "unauthorized_access_attempt"
  | "document_download_error"
  | "eta_calculation_failure";

export const SHIPMENT_SIGNALS = [
  "public_tracking_failure",
  "repeated_invalid_tracking_attempts",
  "status_update_error",
  "webhook_failure",
  "notification_failure",
  "location_provider_failure",
  "unauthorized_access_attempt",
  "document_download_error",
  "eta_calculation_failure",
] as const satisfies readonly ShipmentSignal[];

/** Every field a signal may carry. There is deliberately no escape hatch. */
export interface ShipmentSignalFields {
  signal: ShipmentSignal;
  /** Machine code for the failure — the engine's rejection code, a SQLSTATE. */
  code: string;
  shipmentId?: string | null;
  /** Identifier, not a credential (§5). Safe to correlate on. */
  trackingNumber?: string | null;
  from?: ShipmentStatus | null;
  to?: ShipmentStatus | null;
  actorRole?: string | null;
  actorId?: string | null;
  /**
   * A short operator-readable sentence. Redacted before it is written — see
   * `redactDetail`. Never a provider payload, never a URL with a token in it.
   */
  detail?: string | null;
}

const MAX_DETAIL = 200;

/**
 * Credential shapes that must never reach a log line, whatever the caller
 * believed they were passing. Deliberately shape-based rather than
 * value-based: we cannot know the secrets, only what they look like.
 *
 *   `eyJ`         — the base64 prefix of every JWT header (`{"alg"`).
 *   `Bearer `     — an Authorization header pasted into an error string.
 *   `sk_` / `whsec_` — Stripe secret and webhook-signing keys.
 *   `-----BEGIN`  — a PEM private key.
 *   `token=` / `access_token` / `X-Signature` — query-string and header
 *                   credentials, which is how a driver-update link (M-76) or a
 *                   signed document URL (M-77) would leak.
 */
const CREDENTIAL_MARKERS = [
  "eyJ",
  "Bearer ",
  "sk_",
  "whsec_",
  "-----BEGIN",
  "token=",
  "access_token",
  "X-Signature",
];

/**
 * Returns a detail string safe to write, or the redaction sentinel.
 *
 * Fails CLOSED: if anything credential-shaped is present the WHOLE string is
 * dropped rather than partially masked, because a partial mask still discloses
 * length, position and surrounding context, and because a log line that is
 * merely less useful is a better outcome than one that is a liability.
 */
export function redactDetail(detail: string | null | undefined): string | null {
  if (detail === null || detail === undefined) return null;
  const trimmed = detail.trim();
  if (trimmed === "") return null;
  const haystack = trimmed.toLowerCase();
  for (const marker of CREDENTIAL_MARKERS) {
    if (haystack.includes(marker.toLowerCase())) {
      return "[redacted: credential-shaped content]";
    }
  }
  return trimmed.length > MAX_DETAIL
    ? `${trimmed.slice(0, MAX_DETAIL)}…`
    : trimmed;
}

/** The structured record a transport receives. Stable; M-84b maps from it. */
export interface ShipmentSignalRecord {
  scope: "shipment";
  signal: ShipmentSignal;
  code: string;
  shipment_id: string | null;
  tracking_number: string | null;
  from: ShipmentStatus | null;
  to: ShipmentStatus | null;
  actor_role: string | null;
  actor_id: string | null;
  detail: string | null;
}

/** Built by explicit allow-list construction, same doctrine as `dto.ts`. */
export function buildShipmentSignal(
  fields: ShipmentSignalFields,
): ShipmentSignalRecord {
  return {
    scope: "shipment",
    signal: fields.signal,
    code: fields.code,
    shipment_id: fields.shipmentId ?? null,
    tracking_number: fields.trackingNumber ?? null,
    from: fields.from ?? null,
    to: fields.to ?? null,
    actor_role: fields.actorRole ?? null,
    actor_id: fields.actorId ?? null,
    detail: redactDetail(fields.detail),
  };
}

/**
 * Emit one §26 signal.
 *
 * `console.error` with a `[shipment]` prefix and a JSON body: the same shape
 * `src/lib/audit.ts` and the Stripe/Dropbox webhooks already log with, so
 * Vercel's log drain groups it without configuration. M-84b replaces the body
 * of this function with a Sentry capture (plus the console line, which is what
 * makes local development legible) and NO CALL SITE CHANGES — that is the
 * whole reason the shape is fixed here rather than at each `catch`.
 *
 * Never throws. An observability helper that can break the operation it is
 * observing is worse than no observability at all.
 */
export function logShipmentSignal(fields: ShipmentSignalFields): void {
  try {
    // `console` IS the transport today (plan §2, C-5: Sentry is a DSN in
    // .env.example and nothing more). M-84b swaps the body of this try block.
    console.error("[shipment]", JSON.stringify(buildShipmentSignal(fields)));
  } catch {
    /* a logger must never be the reason a shipment update fails */
  }
}
