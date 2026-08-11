import "server-only";

import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { logShipmentSignal } from "@/lib/shipments/observability";
import {
  notificationIdempotencyKey,
  payloadIsSafe,
  type NotificationChannel,
  type ShipmentNotificationEvent,
  type ShipmentNotificationPayload,
} from "@/lib/shipments/notification-rules";

/**
 * M-79 — the TypeScript face of migration 0026's queue.
 *
 * FOUR CALLS AND NOTHING ELSE: harvest, enqueue, claim, settle. Every one is a
 * `security definer` RPC granted to `service_role` alone, for the same reason
 * M-72 gave when it refused to `.update()` + `.insert()` from the client:
 * PostgREST has no multi-statement transaction, and every one of these
 * operations is two-to-three writes that must be one.
 *
 *   * ENQUEUE writes the queue row AND guarantees the preference row that its
 *     opt-out token comes from.
 *   * HARVEST reads the rules, resolves the audience, checks preferences,
 *     inserts and advances the watermark.
 *   * CLAIM selects, locks and increments the attempt counter — done in three
 *     round trips it is a race that sends twice.
 *   * SETTLE writes the append-only attempt row and moves the queue row.
 *
 * ── §26 ───────────────────────────────────────────────────────────────────
 *
 * `notification_failure` is one of §26's nine named signals and it is emitted
 * through M-72's `logShipmentSignal` — the same closed vocabulary, the same
 * redacting `detail`, so M-84b wires a transport once and this module needs no
 * edit. Nothing here logs a payload, an address or an error body verbatim.
 */

/* ------------------------------------------------------------------ *
 * Result types
 * ------------------------------------------------------------------ */

export type QueueFailureCode =
  | "not_configured"
  | "invalid_input"
  | "not_found"
  | "write_failed";

export interface QueueFailure {
  ok: false;
  code: QueueFailureCode;
  message: string;
}

export interface EnqueueSuccess {
  ok: true;
  id: string;
  /** §17's dedupe, made OBSERVABLE — the same doctrine as 0019's `replayed`. */
  deduped: boolean;
}

export type EnqueueResult = EnqueueSuccess | QueueFailure;

export interface HarvestSuccess {
  ok: true;
  scanned: number;
  enqueued: number;
  from: string | null;
  through: string | null;
}

export type HarvestResult = HarvestSuccess | QueueFailure;

/** One claimed row, exactly as the worker needs it. */
export interface ClaimedNotification {
  id: string;
  shipmentId: string;
  event: ShipmentNotificationEvent;
  channel: NotificationChannel;
  recipientProfileId: string;
  idempotencyKey: string;
  payload: ShipmentNotificationPayload;
  attempts: number;
  maxAttempts: number;
}

export type SettlementOutcome = "sent" | "failed" | "suppressed" | "skipped";

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

function notConfigured(what: string): QueueFailure {
  return {
    ok: false,
    code: "not_configured",
    message: `SUPABASE_SERVICE_ROLE_KEY is unset — ${what} did not run`,
  };
}

function failureFromDbError(error: PostgrestLikeError): QueueFailure {
  const code = error.code ?? "";
  const message = error.message ?? "notification queue write failed";
  if (code === "PL404") return { ok: false, code: "not_found", message };
  if (code === "PL422" || code === "23514") {
    return { ok: false, code: "invalid_input", message };
  }
  return { ok: false, code: "write_failed", message };
}

/** Emit §26's `notification_failure`. Never throws (M-72's rule). */
export function reportNotificationFailure(args: {
  code: string;
  shipmentId?: string | null;
  trackingNumber?: string | null;
  detail?: string | null;
}): void {
  logShipmentSignal({
    signal: "notification_failure",
    code: args.code,
    shipmentId: args.shipmentId ?? null,
    trackingNumber: args.trackingNumber ?? null,
    detail: args.detail ?? null,
  });
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/* ------------------------------------------------------------------ *
 * 1 · Harvest — shipment events → queue rows
 * ------------------------------------------------------------------ */

export const HARVEST_BATCH = 500;

/**
 * Map every notifiable `shipment_events` row written since the watermark onto
 * queue rows.
 *
 * Idempotent by construction: every insert is `on conflict do nothing` against
 * the unique idempotency key, which is why the SQL deliberately re-reads a
 * ten-minute overlap window rather than trusting a clock.
 */
export async function harvestShipmentNotifications(
  limit: number = HARVEST_BATCH,
): Promise<HarvestResult> {
  const admin = tryCreateAdminClient();
  if (!admin) return notConfigured("the notification harvest");

  const { data, error } = await admin.rpc("harvest_shipment_notifications", {
    p_limit: limit,
  });
  if (error) {
    const failure = failureFromDbError(error);
    reportNotificationFailure({ code: `harvest:${failure.code}`, detail: failure.message });
    return failure;
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    scanned: asNumber(row.scanned),
    enqueued: asNumber(row.enqueued),
    from: asString(row.from),
    through: asString(row.through),
  };
}

/* ------------------------------------------------------------------ *
 * 2 · Enqueue — the direct path
 * ------------------------------------------------------------------ */

export interface EnqueueInput {
  shipmentId: string;
  event: ShipmentNotificationEvent;
  channel: NotificationChannel;
  recipientProfileId: string;
  /** Required for `per_source` events; ignored for `per_shipment` ones. */
  sourceId?: string | null;
  /** The `shipment_events.id` that produced this, when there is one. */
  sourceEventId?: string | null;
  payload?: ShipmentNotificationPayload;
}

/**
 * Enqueue ONE notification, deriving the idempotency key from the same three
 * parts the SQL harvest uses — which is what makes an inline enqueue and a
 * background harvest of the same fact collapse into one row instead of two
 * emails.
 *
 * §17's *"do not expose sensitive data"* is checked HERE as well as by 0026's
 * CHECK constraint. Two layers, because they fail differently: the constraint
 * is absolute but its error is a SQLSTATE at 3am, and this one names the key
 * and refuses before a round trip.
 */
export async function enqueueShipmentNotification(
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  if (!payloadIsSafe(payload)) {
    return {
      ok: false,
      code: "invalid_input",
      message:
        "notification payload carries a field §17 forbids (financial, internal or credential)",
    };
  }

  let key: string;
  try {
    key = notificationIdempotencyKey({
      event: input.event,
      shipmentId: input.shipmentId,
      channel: input.channel,
      sourceId: input.sourceId ?? null,
    });
  } catch (err) {
    return {
      ok: false,
      code: "invalid_input",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const admin = tryCreateAdminClient();
  if (!admin) return notConfigured("the notification enqueue");

  const { data, error } = await admin.rpc("enqueue_shipment_notification", {
    p_shipment_id: input.shipmentId,
    p_event: input.event,
    p_channel: input.channel,
    p_recipient_profile_id: input.recipientProfileId,
    p_idempotency_key: key,
    p_payload: payload as never,
    p_source_event_id: input.sourceEventId ?? null,
  });
  if (error) {
    const failure = failureFromDbError(error);
    reportNotificationFailure({
      code: `enqueue:${failure.code}`,
      shipmentId: input.shipmentId,
      detail: failure.message,
    });
    return failure;
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    id: asString(row.id) ?? "",
    deduped: row.deduped === true,
  };
}

/* ------------------------------------------------------------------ *
 * 3 · Claim
 * ------------------------------------------------------------------ */

export const CLAIM_BATCH = 25;

export type ClaimResult =
  | { ok: true; rows: ClaimedNotification[] }
  | QueueFailure;

/**
 * Claim up to `limit` due rows, marking each `sending` and counting the
 * attempt.
 *
 * The attempt is counted at CLAIM time, not at settle time, and that is the
 * crash story: a worker that dies mid-send never settles, and a row whose
 * attempt was only counted on success would be reclaimed forever by the lock
 * TTL. Counting on claim means a row that keeps killing its worker reaches
 * `dead` and a human sees it.
 */
export async function claimShipmentNotifications(
  limit: number = CLAIM_BATCH,
): Promise<ClaimResult> {
  const admin = tryCreateAdminClient();
  if (!admin) return notConfigured("the notification claim");

  const { data, error } = await admin.rpc("claim_shipment_notifications", {
    p_limit: limit,
  });
  if (error) {
    const failure = failureFromDbError(error);
    reportNotificationFailure({ code: `claim:${failure.code}`, detail: failure.message });
    return failure;
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    ok: true,
    rows: rows.map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        id: asString(r.id) ?? "",
        shipmentId: asString(r.shipment_id) ?? "",
        event: asString(r.notification_event) as ShipmentNotificationEvent,
        channel: asString(r.channel) as NotificationChannel,
        recipientProfileId: asString(r.recipient_profile_id) ?? "",
        idempotencyKey: asString(r.idempotency_key) ?? "",
        payload: (r.payload ?? {}) as ShipmentNotificationPayload,
        attempts: asNumber(r.attempts),
        maxAttempts: asNumber(r.max_attempts),
      };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * 4 · Settle
 * ------------------------------------------------------------------ */

export interface SettleInput {
  id: string;
  outcome: SettlementOutcome;
  providerMessageId?: string | null;
  error?: string | null;
  /** From `retryDelaySeconds()`. Null = no more retries → `dead`. */
  retryAfterSeconds?: number | null;
}

export type SettleResult =
  | { ok: true; state: string; attempts: number }
  | QueueFailure;

/** Close one attempt: append the ledger row, move the queue row. */
export async function settleShipmentNotification(
  input: SettleInput,
): Promise<SettleResult> {
  const admin = tryCreateAdminClient();
  if (!admin) return notConfigured("the notification settlement");

  const { data, error } = await admin.rpc("settle_shipment_notification", {
    p_id: input.id,
    p_outcome: input.outcome,
    p_provider_message_id: input.providerMessageId ?? null,
    p_error: input.error ?? null,
    p_retry_after_seconds: input.retryAfterSeconds ?? null,
  });
  if (error) {
    const failure = failureFromDbError(error);
    reportNotificationFailure({ code: `settle:${failure.code}`, detail: failure.message });
    return failure;
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    state: asString(row.state) ?? "",
    attempts: asNumber(row.attempts),
  };
}
