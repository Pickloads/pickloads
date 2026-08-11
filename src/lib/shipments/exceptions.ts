import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { logShipmentSignal } from "@/lib/shipments/observability";
import type {
  ShipmentEventSource,
  ShipmentExceptionRow,
  ShipmentExceptionSeverity,
  ShipmentExceptionType,
} from "@/lib/shipments/types";

/**
 * M-78 — §21's exception system: the server half of open / triage / resolve,
 * and the reads every audience gets.
 *
 * ── WHY THE WRITES ARE RPCs AND THE READS ARE NOT ─────────────────────────
 *
 * Same split M-77 uses. A WRITE is an exception row plus a `shipment_events`
 * row that must land together (§7: the timeline explains the state, and a
 * state with no event is the condition §6 and §7 forbid), so it goes through
 * 0025's `security definer` functions under the service-role key — the single
 * door, EXECUTE-granted to nobody else, which is what makes §19's
 * "unauthorized writes fail" structural.
 *
 * A READ runs under the CALLER's cookie-bound client so the database decides
 * what comes back:
 *   * staff  → 0025's `"staff manage shipment exceptions"` policy, full row;
 *   * shipper / carrier / broker → `my_shipment_exceptions()`, whose RETURN
 *     TYPE has seven columns and no internal field in it.
 *
 * ── §21'S ONE NON-NEGOTIABLE, AND WHERE IT IS ENFORCED ────────────────────
 *
 * *"Do not expose blame, legal conclusions or sensitive internal commentary."*
 *
 * Three independent constructions, none of which relies on the other two:
 *   1. the customer accessor cannot RETURN `internal_description` or
 *      `resolution` — they are not in its type (0025 §4);
 *   2. `toCustomerExceptionRows` below builds `ShipmentExceptionRow`s with
 *      those fields set to literal `null`, so the values are not in the Node
 *      process at all on a customer request;
 *   3. `CustomerExceptionDto` (M-70) names neither field, and the DTO suite
 *      sweeps both by sentinel.
 *
 * A bug in any one of them is caught by the other two.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * §25 — a shipment with fifty exceptions is an incident, not a pagination
 * problem. The bound exists so a compromised or looping writer cannot make a
 * detail page unbounded, not because the number is expected to be reached.
 */
export const EXCEPTION_PAGE_SIZE = 50;

/** Explicit projection. `select("*")` appears nowhere in this file. */
export const STAFF_EXCEPTION_COLUMNS =
  "id, shipment_id, exception_type, severity, public_description, " +
  "internal_description, opened_at, resolved_at, opened_by, assigned_to, " +
  "customer_notified_at, resolution, source_event_id, resolution_event_id";

/** The seven columns `my_shipment_exceptions()` returns. */
export interface CustomerExceptionRead {
  id: string;
  shipment_id: string;
  exception_type: ShipmentExceptionType;
  severity: ShipmentExceptionSeverity;
  public_description: string | null;
  opened_at: string;
  resolved_at: string | null;
}

export interface ExceptionListResult<T> {
  exceptions: T[];
  failed: boolean;
}

/**
 * The customer read, for shipper / carrier / broker surfaces.
 *
 * The AUDIENCE IS NOT A PARAMETER — 0025's function resolves it from the
 * caller's own memberships. A parameter would be privilege escalation by
 * argument, and the one thing worse than a customer seeing another customer's
 * exception is a customer choosing to.
 */
export async function listCustomerExceptions(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<ExceptionListResult<CustomerExceptionRead>> {
  const { data, error } = await supabase.rpc("my_shipment_exceptions", {
    p_shipment_id: shipmentId,
  });
  if (error) {
    console.error("[shipment-exceptions] customer read failed", error.message);
    return { exceptions: [], failed: true };
  }
  const rows = (data ?? []) as CustomerExceptionRead[];
  return { exceptions: rows.slice(0, EXCEPTION_PAGE_SIZE), failed: false };
}

/**
 * Widen a customer read into the `ShipmentExceptionRow` M-70's serializers
 * take, with every withheld field written out as the `null` it is.
 *
 * The same discipline `/portal/shipper/shipments/[id]` applies to
 * `ShipmentRow`: an explicit null beside a named field is a visible decision
 * that a new column turns into a compile error, where a `Partial<>` or a cast
 * would quietly stop being checked.
 */
export function toCustomerExceptionRows(
  rows: readonly CustomerExceptionRead[],
): ShipmentExceptionRow[] {
  return rows.map((row) => ({
    id: row.id,
    shipment_id: row.shipment_id,
    exception_type: row.exception_type,
    severity: row.severity,
    public_description: row.public_description,
    // §21's forbidden columns. Not fetched, not fetchable, and null here.
    internal_description: null,
    opened_at: row.opened_at,
    resolved_at: row.resolved_at,
    opened_by: null,
    assigned_to: null,
    customer_notified_at: null,
    resolution: null,
    source_event_id: null,
    resolution_event_id: null,
  }));
}

/** The staff read — §21's full field list, under 0025's staff policy. */
export async function listStaffExceptions(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<ExceptionListResult<ShipmentExceptionRow>> {
  const { data, error } = await supabase
    .from("shipment_exceptions")
    .select(STAFF_EXCEPTION_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("opened_at", { ascending: false })
    .limit(EXCEPTION_PAGE_SIZE);
  if (error) {
    console.error("[shipment-exceptions] staff read failed", error.message);
    return { exceptions: [], failed: true };
  }
  return {
    exceptions: (data ?? []) as unknown as ShipmentExceptionRow[],
    failed: false,
  };
}

/**
 * The service-role read of the calm projection, for `/track`.
 *
 * `/track` is anonymous: there is no session, so `my_shipment_exceptions()`
 * would resolve to no audience at all. The public path already runs under the
 * admin client behind §4's two-factor check (see `public-lookup.ts`), and this
 * function is deliberately the ONE place that reads the base table with the
 * service role for a customer surface — so the projection is written out here,
 * once, and `internal_description` and `resolution` are named nowhere in it.
 */
export const PUBLIC_EXCEPTION_COLUMNS =
  "id, shipment_id, exception_type, severity, public_description, opened_at, resolved_at";

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export type ExceptionFailureCode =
  | "not_configured"
  | "shipment_not_found"
  | "exception_not_found"
  | "already_resolved"
  | "invalid_input"
  | "write_failed";

export interface ExceptionFailure {
  ok: false;
  code: ExceptionFailureCode;
  message: string;
}

export interface ExceptionSuccess {
  ok: true;
  shipmentId: string;
  exceptionId: string | null;
  eventId: string;
  replayed: boolean;
}

export type ExceptionResult = ExceptionSuccess | ExceptionFailure;

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

export interface OpenExceptionInput {
  shipmentId: string;
  exceptionType: ShipmentExceptionType;
  severity: ShipmentExceptionSeverity;
  /** Customer-safe wording — a D-6 phrase token or calm free text (§21, §24). */
  publicDescription?: string | null;
  internalDescription?: string | null;
  openedBy: string | null;
  assignedTo?: string | null;
  source: ShipmentEventSource;
  /** Who reported it, for the provenance marker in `metadata`. */
  reportedBy: "dispatcher" | "admin" | "carrier" | "driver";
  idempotencyKey?: string | null;
  /** Extra provenance (`driver_token_id`, …). Never a credential. */
  metadata?: Record<string, unknown>;
}

/**
 * Open an exception: the §21 row AND the §7 `exception_opened` event, in one
 * transaction.
 *
 * `visibility` is NOT settable from here. 0025 decides it from whether a
 * public description exists, because "the customer was told" and "there is a
 * customer-facing sentence on the record" must be the same fact.
 */
export async function openShipmentException(
  input: OpenExceptionInput,
): Promise<ExceptionResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is unset — the exception was NOT recorded.",
    };
  }

  const { data, error } = await admin.rpc("open_shipment_exception", {
    p_shipment_id: input.shipmentId,
    p_exception_type: input.exceptionType,
    p_severity: input.severity,
    p_public_description: input.publicDescription ?? null,
    p_internal_description: input.internalDescription ?? null,
    p_opened_by: input.openedBy,
    p_assigned_to: input.assignedTo ?? null,
    p_source: input.source,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_metadata: {
      ...(input.metadata ?? {}),
      /*
       * The provenance marker. M-75 wrote `m75_event_only` and M-76 wrote
       * `m76_carrier_report` / `m76_driver_report` to mark exceptions that
       * had NO ROW; those three values are what 0025's backfill selects on,
       * and reusing one here would make a freshly-created row look like a
       * migration candidate forever. `m78_*` says the row already exists.
       */
      exception_source: `m78_${input.reportedBy}_report`,
      reported_by: input.reportedBy,
    },
  });

  if (error) return exceptionFailure(error, input.shipmentId);

  const envelope = (data ?? {}) as Record<string, unknown>;
  const result: ExceptionSuccess = {
    ok: true,
    shipmentId: input.shipmentId,
    exceptionId:
      typeof envelope.exception_id === "string" ? envelope.exception_id : null,
    eventId: String(envelope.event_id ?? ""),
    replayed: envelope.replayed === true,
  };

  if (!result.replayed) {
    await recordAuditEvent({
      actorId: input.openedBy,
      action: "shipment.exception_opened",
      targetTable: "shipment_exceptions",
      targetId: result.exceptionId,
      detail: {
        shipment_id: input.shipmentId,
        exception_type: input.exceptionType,
        severity: input.severity,
        reported_by: input.reportedBy,
        event_id: result.eventId,
        // NEVER the descriptions. §26's never-log list and §21's
        // "no internal commentary" both point the same way, and an audit
        // journal is read by more people than an exception card is.
        customer_facing: (input.publicDescription ?? "") !== "",
      },
    });
  }

  return result;
}

export interface ResolveExceptionInput {
  exceptionId: string;
  /** Mandatory. 0025 refuses a blank one with PL422. */
  resolution: string;
  actorId: string | null;
  source: ShipmentEventSource;
  /** Optional calm line for the customer timeline (§21). */
  publicMessage?: string | null;
  internalMessage?: string | null;
  idempotencyKey?: string | null;
}

export async function resolveShipmentException(
  input: ResolveExceptionInput,
): Promise<ExceptionResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "SUPABASE_SERVICE_ROLE_KEY is unset — the exception was NOT resolved.",
    };
  }

  const { data, error } = await admin.rpc("resolve_shipment_exception", {
    p_exception_id: input.exceptionId,
    p_resolution: input.resolution,
    p_actor: input.actorId,
    p_source: input.source,
    p_public_message: input.publicMessage ?? null,
    p_internal_message: input.internalMessage ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) return exceptionFailure(error, null);

  const envelope = (data ?? {}) as Record<string, unknown>;
  const result: ExceptionSuccess = {
    ok: true,
    shipmentId: String(envelope.shipment_id ?? ""),
    exceptionId: input.exceptionId,
    eventId: String(envelope.event_id ?? ""),
    replayed: envelope.replayed === true,
  };

  if (!result.replayed) {
    await recordAuditEvent({
      actorId: input.actorId,
      action: "shipment.exception_resolved",
      targetTable: "shipment_exceptions",
      targetId: input.exceptionId,
      detail: {
        shipment_id: result.shipmentId,
        event_id: result.eventId,
        published_to_customer: (input.publicMessage ?? "") !== "",
      },
    });
  }

  return result;
}

export interface TriageExceptionInput {
  exceptionId: string;
  assignedTo?: string | null;
  severity?: ShipmentExceptionSeverity | null;
  publicDescription?: string | null;
  /** Stamps `customer_notified_at`. One-way — 0025 refuses un-notifying. */
  markCustomerNotified?: boolean;
  actorId: string | null;
}

/**
 * Triage an OPEN exception: assign it, re-severity it, add the customer
 * wording, or record that the customer was told.
 *
 * No timeline event. Re-assigning an exception is an internal routing
 * decision and a customer history is not a work queue; stamping "we told
 * them" is a CONSEQUENCE of a notification that already produced its own
 * record (`notification_sent`, M-75) rather than a second one.
 */
export async function triageShipmentException(
  input: TriageExceptionInput,
): Promise<ExceptionResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message: "SUPABASE_SERVICE_ROLE_KEY is unset — nothing was changed.",
    };
  }

  const { data, error } = await admin.rpc("update_shipment_exception", {
    p_exception_id: input.exceptionId,
    p_assigned_to: input.assignedTo ?? null,
    p_mark_customer_notified: input.markCustomerNotified === true,
    p_severity: input.severity ?? null,
    p_public_description: input.publicDescription ?? null,
    p_actor: input.actorId,
  });

  if (error) return exceptionFailure(error, null);

  const envelope = (data ?? {}) as Record<string, unknown>;
  await recordAuditEvent({
    actorId: input.actorId,
    action: "shipment.exception_triaged",
    targetTable: "shipment_exceptions",
    targetId: input.exceptionId,
    detail: {
      shipment_id: String(envelope.shipment_id ?? ""),
      assigned: input.assignedTo !== undefined && input.assignedTo !== null,
      severity: input.severity ?? null,
      customer_notified: input.markCustomerNotified === true,
    },
  });

  return {
    ok: true,
    shipmentId: String(envelope.shipment_id ?? ""),
    exceptionId: input.exceptionId,
    eventId: "",
    replayed: false,
  };
}

/**
 * Map a Postgres error onto an operator-readable refusal.
 *
 * `unauthorized_access_attempt` is the §26 signal for a REFUSED write, not
 * `eta_calculation_failure`: a rejected exception write is an authorization or
 * validation outcome, and reusing the ETA signal would make the ETA pipeline's
 * dashboard lie about its own health.
 */
function exceptionFailure(
  error: PostgrestLikeError,
  shipmentId: string | null,
): ExceptionFailure {
  let code: ExceptionFailureCode = "write_failed";
  let message =
    error.message ??
    "Couldn't save that. Retry, and check the connection if it repeats.";

  if (error.code === "PL404") {
    code = /exception/.test(error.message ?? "")
      ? "exception_not_found"
      : "shipment_not_found";
    message =
      code === "exception_not_found"
        ? "That exception no longer exists — reload the shipment."
        : "That shipment no longer exists.";
  } else if (error.code === "PL409") {
    code = "already_resolved";
    message =
      error.message ??
      "That exception is already closed. Reload to see who closed it.";
  } else if (
    error.code === "PL422" ||
    error.code === "22P02" ||
    error.code === "23514"
  ) {
    code = "invalid_input";
    message = error.message ?? "That entry was rejected. Check it and retry.";
  }

  logShipmentSignal({
    signal: "unauthorized_access_attempt",
    code,
    shipmentId,
    detail: message,
  });

  return { ok: false, code, message };
}
