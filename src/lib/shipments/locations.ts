import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { logShipmentSignal } from "@/lib/shipments/observability";
import { getProviderAdapter } from "@/lib/shipments/providers";
import type { NormalizedReading } from "@/lib/shipments/providers/types";
import type {
  ShipmentEventSource,
  ShipmentLocationRow,
  ShipmentLocationVisibility,
  TrackingProvider,
  TrackingProviderConnectionRow,
} from "@/lib/shipments/types";

/**
 * M-80 — the server half of §9: reading location history per audience,
 * recording a reading, moving the privacy dial, and running the retention
 * purge.
 *
 * ── THE SAME READ/WRITE SPLIT M-77 AND M-78 USE ──────────────────────────
 *
 * WRITES go through 0027's `security definer` functions under the
 * service-role key, EXECUTE-granted to nobody else. That is what makes §19's
 * "unauthorized writes fail" structural rather than a code-review promise,
 * and it is what lets one statement do a dedupe-insert plus a newest-wins
 * update to `shipments.current_*` without a race between two round trips.
 *
 * READS run under the CALLER'S cookie-bound client, so the database decides:
 *   * staff  → 0027's `"staff manage shipment locations"` policy, full row;
 *   * shipper / carrier / broker → `my_shipment_locations()`, whose RETURN
 *     TYPE has seven columns and carries neither `raw_metadata` nor the
 *     provider's identifiers;
 *   * public → the service-role read below, capped by `toPublicTrackingDto`.
 *
 * ── EVERY READ IS BOUNDED (§25) ──────────────────────────────────────────
 *
 * A shipment polled every two minutes for a five-day run is 3 600 readings.
 * A map that plots all of them is a slow page and an unreadable picture, so
 * the bound is a constant here rather than a number a caller might forget.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/** §25 — the newest N readings. Enough for a route line, far short of a scan. */
export const LOCATION_PAGE_SIZE = 50;

/** Explicit projection. `select("*")` appears nowhere in this file. */
export const STAFF_LOCATION_COLUMNS =
  "id, shipment_id, recorded_at, latitude, longitude, city, state, " +
  "speed_mph, heading_degrees, source, provider, external_event_id, " +
  "retention_expires_at";

/**
 * NOTE WHAT IS ABSENT FROM THAT LIST: `raw_metadata`.
 *
 * §9 says to store raw provider metadata SECURELY. The securest handling of a
 * third party's payload is that it never enters a page request at all — so it
 * is in no projection, in no DTO and on no screen. It is readable by a staff
 * session directly against the table when somebody is debugging an
 * integration, which is the only time anybody needs it.
 */
export const FORBIDDEN_LOCATION_COLUMNS = ["raw_metadata"] as const;

export const PROVIDER_CONNECTION_COLUMNS =
  "id, shipment_id, provider, external_tracking_id, tracking_url, " +
  "expires_at, consent_status, active, connected_by, connected_at, " +
  "last_polled_at, last_error";

export interface LocationListResult<T> {
  locations: T[];
  /** True when the read failed. The surfaces degrade honestly rather than 500. */
  failed: boolean;
}

/** The seven columns `my_shipment_locations()` returns. */
export interface CustomerLocationRead {
  recorded_at: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  speed_mph: number | null;
  source: ShipmentEventSource;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * A customer's own location history, through the accessor.
 *
 * The audience is resolved INSIDE the SQL function from the caller's own
 * memberships — never from an argument — so a shipper cannot ask for the
 * staff view, and the four §9 levels are applied before a row leaves the
 * database. The rows are widened to `ShipmentLocationRow` with the withheld
 * columns written out as the nulls they are, which is the discipline M-78
 * applied to exceptions: a new column on the row type becomes a compile error
 * here rather than an accidental disclosure.
 */
export async function listCustomerLocations(
  supabase: ServerSupabase,
  shipmentId: string,
  limit: number = LOCATION_PAGE_SIZE,
): Promise<LocationListResult<ShipmentLocationRow>> {
  const { data, error } = await supabase.rpc("my_shipment_locations", {
    p_shipment_id: shipmentId,
    p_limit: Math.min(Math.max(limit, 1), 200),
  });

  if (error) {
    logShipmentSignal({
      signal: "location_provider_failure",
      code: "customer_location_read_failed",
      shipmentId,
      detail: error.message,
    });
    return { locations: [], failed: true };
  }

  const rows = (data ?? []) as unknown as CustomerLocationRead[];
  return {
    locations: rows.map((row) => ({
      id: "",
      shipment_id: shipmentId,
      recorded_at: row.recorded_at,
      latitude: row.latitude,
      longitude: row.longitude,
      city: row.city,
      state: row.state,
      speed_mph: row.speed_mph,
      heading_degrees: null,
      source: row.source,
      provider: null,
      external_event_id: null,
      raw_metadata: null,
      retention_expires_at: null,
    })),
    failed: false,
  };
}

/** Staff read the table directly, under 0027's staff policy. */
export async function listStaffLocations(
  supabase: ServerSupabase,
  shipmentId: string,
  limit: number = LOCATION_PAGE_SIZE,
): Promise<LocationListResult<ShipmentLocationRow>> {
  const { data, error } = await supabase
    .from("shipment_locations")
    .select(STAFF_LOCATION_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("recorded_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) {
    logShipmentSignal({
      signal: "location_provider_failure",
      code: "staff_location_read_failed",
      shipmentId,
      detail: error.message,
    });
    return { locations: [], failed: true };
  }

  const rows = (data ?? []) as unknown as Omit<
    ShipmentLocationRow,
    "raw_metadata"
  >[];
  return {
    locations: rows.map((row) => ({ ...row, raw_metadata: null })),
    failed: false,
  };
}

/**
 * The PUBLIC path's read, on the service-role client M-73 already holds.
 *
 * §9's cap for public visitors is applied twice: the projection here omits
 * `speed_mph` and the coordinates entirely, and `toPublicTrackingDto` nulls
 * them again. Two layers, because the one that matters is whichever one a
 * future refactor does not delete.
 */
export const PUBLIC_LOCATION_COLUMNS = "recorded_at, city, state, source";

export async function listPublicLocations(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  shipmentId: string,
  level: ShipmentLocationVisibility,
  limit: number = LOCATION_PAGE_SIZE,
): Promise<ShipmentLocationRow[]> {
  if (level === "hidden" || level === "milestone_only") return [];

  const { data, error } = await admin
    .from("shipment_locations")
    .select(PUBLIC_LOCATION_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("recorded_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (error) {
    logShipmentSignal({
      signal: "location_provider_failure",
      code: "public_location_read_failed",
      shipmentId,
      detail: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as unknown as {
    recorded_at: string;
    city: string | null;
    state: string | null;
    source: ShipmentEventSource;
  }[];
  return rows.map((row) => ({
    id: "",
    shipment_id: shipmentId,
    recorded_at: row.recorded_at,
    latitude: null,
    longitude: null,
    city: row.city,
    state: row.state,
    speed_mph: null,
    heading_degrees: null,
    source: row.source,
    provider: null,
    external_event_id: null,
    raw_metadata: null,
    retention_expires_at: null,
  }));
}

/** Staff-only. `tracking_url` reaches no customer surface at any audience. */
export async function listProviderConnections(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<{ connections: TrackingProviderConnectionRow[]; failed: boolean }> {
  const { data, error } = await supabase
    .from("tracking_provider_connections")
    .select(PROVIDER_CONNECTION_COLUMNS)
    .eq("shipment_id", shipmentId)
    .order("connected_at", { ascending: false })
    .limit(20);

  if (error) {
    logShipmentSignal({
      signal: "location_provider_failure",
      code: "connection_read_failed",
      shipmentId,
      detail: error.message,
    });
    return { connections: [], failed: true };
  }
  return {
    connections: (data ?? []) as unknown as TrackingProviderConnectionRow[],
    failed: false,
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

export type LocationWriteResult =
  | { ok: true; deduped: boolean; locationId: string | null }
  | { ok: false; code: string; message: string };

const NOT_CONFIGURED: LocationWriteResult = {
  ok: false,
  code: "not_configured",
  message: "SUPABASE_SERVICE_ROLE_KEY is unset — nothing was recorded.",
};

export interface RecordLocationInput {
  shipmentId: string;
  recordedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  state?: string | null;
  speedMph?: number | null;
  headingDegrees?: number | null;
  source: ShipmentEventSource;
  provider?: TrackingProvider | null;
  externalEventId?: string | null;
  /** §9's raw provider payload. Stored; never serialized to any audience. */
  rawMetadata?: Record<string, unknown> | null;
}

/**
 * Record one reading (§9 Mode B/Mode C ingestion).
 *
 * Dedupe is the DATABASE's job — 0027's partial unique index plus
 * `on conflict do nothing` — and the result says which happened, so a poller
 * can distinguish "stored" from "already knew" without a pre-read.
 *
 * NO PROVIDER CALLS THIS TODAY. It is reachable from the poll orchestrator
 * below, which refuses because no adapter has a transport; it exists so that
 * when one does, nothing above it changes.
 */
export async function recordShipmentLocation(
  input: RecordLocationInput,
): Promise<LocationWriteResult> {
  const admin = tryCreateAdminClient();
  if (!admin) return NOT_CONFIGURED;

  const { data, error } = await admin.rpc("record_shipment_location", {
    p_shipment_id: input.shipmentId,
    p_recorded_at: input.recordedAt ?? null,
    p_latitude: input.latitude ?? null,
    p_longitude: input.longitude ?? null,
    p_city: input.city ?? null,
    p_state: input.state ?? null,
    p_speed_mph: input.speedMph ?? null,
    p_heading_degrees: input.headingDegrees ?? null,
    p_source: input.source,
    p_provider: input.provider ?? null,
    p_external_event_id: input.externalEventId ?? null,
    p_raw_metadata: input.rawMetadata ?? {},
  });

  if (error) {
    logShipmentSignal({
      signal: "location_provider_failure",
      code: error.code ?? "location_write_failed",
      shipmentId: input.shipmentId,
      detail: error.message,
    });
    return {
      ok: false,
      code: error.code ?? "location_write_failed",
      message: "That location reading could not be recorded.",
    };
  }

  const envelope = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    deduped: envelope.deduped === true,
    locationId:
      typeof envelope.location_id === "string" ? envelope.location_id : null,
  };
}

export type VisibilityWriteResult =
  | { ok: true; previous: ShipmentLocationVisibility }
  | { ok: false; code: string; message: string };

/**
 * Move §9's dial. The authoritative direction rule lives in 0027; this is the
 * caller, and it journals through the M-69 single writer because "who changed
 * how much of the truck the customer can see" is exactly the kind of fact
 * §15's *"audit who changed each status"* is about.
 */
export async function setShipmentLocationVisibility(input: {
  shipmentId: string;
  level: ShipmentLocationVisibility;
  actorId: string | null;
  actorRole: "admin" | "dispatcher";
}): Promise<VisibilityWriteResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message: "SUPABASE_SERVICE_ROLE_KEY is unset — nothing was changed.",
    };
  }

  const { data, error } = await admin.rpc("set_shipment_location_visibility", {
    p_shipment_id: input.shipmentId,
    p_level: input.level,
    p_actor_id: input.actorId,
    p_actor_role: input.actorRole,
  });

  if (error) {
    return {
      ok: false,
      code: error.code ?? "visibility_write_failed",
      message:
        error.code === "PL403"
          ? "Showing more of a truck's position is an admin action. Ask an admin to widen it."
          : error.code === "PL422"
            ? "That is already this shipment's location visibility."
            : "That location visibility change could not be saved.",
    };
  }

  const envelope = (data ?? {}) as Record<string, unknown>;
  const previous = (envelope.previous_level ??
    "approximate") as ShipmentLocationVisibility;

  await recordAuditEvent({
    actorId: input.actorId,
    action: "shipment.location_visibility_changed",
    targetTable: "shipments",
    targetId: input.shipmentId,
    detail: {
      previous_level: previous,
      new_level: input.level,
      actor_role: input.actorRole,
    },
  });

  return { ok: true, previous };
}

export type ConnectionWriteResult =
  | { ok: true; connectionId: string | null }
  | { ok: false; code: string; message: string };

/** Attach a §9 Mode B per-shipment tracking link. */
export async function attachProviderConnection(input: {
  shipmentId: string;
  provider: TrackingProvider;
  externalTrackingId?: string | null;
  trackingUrl?: string | null;
  expiresAt?: string | null;
  consentStatus?: TrackingProviderConnectionRow["consent_status"];
  actorId: string | null;
}): Promise<ConnectionWriteResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message: "SUPABASE_SERVICE_ROLE_KEY is unset — nothing was attached.",
    };
  }

  const { data, error } = await admin.rpc(
    "attach_tracking_provider_connection",
    {
      p_shipment_id: input.shipmentId,
      p_provider: input.provider,
      p_external_tracking_id: input.externalTrackingId ?? null,
      p_tracking_url: input.trackingUrl ?? null,
      p_expires_at: input.expiresAt ?? null,
      p_consent_status: input.consentStatus ?? "pending",
      p_actor_id: input.actorId,
    },
  );

  if (error) {
    logShipmentSignal({
      signal: "location_provider_failure",
      code: error.code ?? "connection_attach_failed",
      shipmentId: input.shipmentId,
      // NEVER the URL. §26's never-log list, and a Mode B link is a bearer
      // credential to a live truck position.
      detail: `attach refused for ${input.provider}`,
    });
    return {
      ok: false,
      code: error.code ?? "connection_attach_failed",
      message:
        error.code === "23514"
          ? "That tracking link was refused: it must be an https:// URL and must not carry an API credential (§15 — integration credentials live in environment variables)."
          : "That tracking link could not be attached.",
    };
  }

  const envelope = (data ?? {}) as Record<string, unknown>;
  const connectionId =
    typeof envelope.connection_id === "string" ? envelope.connection_id : null;

  await recordAuditEvent({
    actorId: input.actorId,
    action: "shipment.provider_connection_attached",
    targetTable: "tracking_provider_connections",
    targetId: connectionId,
    detail: {
      shipment_id: input.shipmentId,
      provider: input.provider,
      // The URL is not journalled either — the audit log is read by more
      // people than the dispatcher screen it appears on.
      has_tracking_url: (input.trackingUrl ?? "") !== "",
      expires_at: input.expiresAt ?? null,
    },
  });

  return { ok: true, connectionId };
}

export async function revokeProviderConnection(input: {
  connectionId: string;
  shipmentId: string;
  actorId: string | null;
  reason?: string | null;
}): Promise<ConnectionWriteResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      code: "not_configured",
      message: "SUPABASE_SERVICE_ROLE_KEY is unset — nothing was revoked.",
    };
  }

  const { error } = await admin.rpc("revoke_tracking_provider_connection", {
    p_connection_id: input.connectionId,
    p_actor_id: input.actorId,
    p_reason: input.reason ?? null,
  });

  if (error) {
    return {
      ok: false,
      code: error.code ?? "connection_revoke_failed",
      message: "That tracking link could not be revoked.",
    };
  }

  await recordAuditEvent({
    actorId: input.actorId,
    action: "shipment.provider_connection_revoked",
    targetTable: "tracking_provider_connections",
    targetId: input.connectionId,
    detail: { shipment_id: input.shipmentId },
  });

  return { ok: true, connectionId: input.connectionId };
}

/* ------------------------------------------------------------------ *
 * The retention EXECUTOR's caller (§9, plan §4)
 * ------------------------------------------------------------------ */

export interface PurgeResult {
  ok: boolean;
  retentionDays: number | null;
  deleted: number;
  moreRemaining: boolean;
  reason?: string;
}

/**
 * Run one retention batch. Called by `/api/cron/daily`.
 *
 * The DELETE itself is 0027's `purge_expired_shipment_locations()` — it has to
 * be, because a paginated read/delete loop over PostgREST would be N round
 * trips and a window in which the set being deleted changes underneath the
 * pager. This function is the caller, and its only job beyond the RPC is to
 * make a failure VISIBLE (§26): a retention executor that silently stops is
 * indistinguishable from the policy-with-no-purger it replaced.
 */
export async function purgeExpiredLocations(options?: {
  retentionDays?: number | null;
  limit?: number | null;
}): Promise<PurgeResult> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      ok: false,
      retentionDays: null,
      deleted: 0,
      moreRemaining: false,
      reason: "service credentials not configured",
    };
  }

  const { data, error } = await admin.rpc("purge_expired_shipment_locations", {
    p_retention_days: options?.retentionDays ?? null,
    p_limit: options?.limit ?? null,
  });

  if (error) {
    logShipmentSignal({
      signal: "location_provider_failure",
      code: error.code ?? "retention_purge_failed",
      detail: `location retention purge failed: ${error.message}`,
    });
    return {
      ok: false,
      retentionDays: null,
      deleted: 0,
      moreRemaining: false,
      reason: error.message,
    };
  }

  const envelope = (data ?? {}) as Record<string, unknown>;
  const deleted = Number(envelope.deleted ?? 0);
  const retentionDays = Number(envelope.retention_days ?? 0);

  if (deleted > 0) {
    await recordAuditEvent({
      actorId: null,
      action: "shipment.location_retention_purged",
      targetTable: "shipment_locations",
      targetId: null,
      detail: {
        retention_days: retentionDays,
        deleted,
        more_remaining: envelope.more_remaining === true,
      },
    });
  }

  return {
    ok: true,
    retentionDays: Number.isFinite(retentionDays) ? retentionDays : null,
    deleted: Number.isFinite(deleted) ? deleted : 0,
    moreRemaining: envelope.more_remaining === true,
  };
}

/* ------------------------------------------------------------------ *
 * The poll orchestrator (§9 Mode C) — honest, and refusing
 * ------------------------------------------------------------------ */

export type PollOutcome =
  | { ok: true; deduped: boolean; reading: NormalizedReading }
  | { ok: false; code: string; message: string };

/**
 * Ask a provider where a truck is, and store the answer.
 *
 * THIS ALWAYS REFUSES TODAY, and the refusal is the point: no adapter has a
 * transport (see `providers/base.ts`), so every call returns
 * `not_configured` or `not_implemented` and emits §26's
 * `location_provider_failure` signal. Nothing fabricates a position.
 *
 * It exists so that adding a real provider is a change to ONE adapter file:
 * the consent gate, the dedupe key, the raw-metadata handling and the write
 * path are already here and already tested.
 */
export async function pollProviderLocation(
  connection: TrackingProviderConnectionRow,
): Promise<PollOutcome> {
  const adapter = getProviderAdapter(connection.provider);

  if (!connection.active) {
    return {
      ok: false,
      code: "not_connected",
      message: `${adapter.displayName} connection is revoked.`,
    };
  }
  if (
    connection.expires_at !== null &&
    Date.parse(connection.expires_at) <= Date.now()
  ) {
    return {
      ok: false,
      code: "not_connected",
      message: `${adapter.displayName} tracking link expired.`,
    };
  }
  // §9/§13: no consent, no position. Checked before the adapter is called at
  // all, so a provider is never asked a question we are not permitted to ask.
  if (connection.consent_status !== "granted") {
    return {
      ok: false,
      code: "consent_missing",
      message: `${adapter.displayName}: the driver has not granted location sharing.`,
    };
  }

  const result = await adapter.fetchCurrentLocation({
    shipmentId: connection.shipment_id,
    externalTrackingId: connection.external_tracking_id,
    consentGranted: true,
  });

  if (!result.ok) {
    logShipmentSignal({
      signal: "location_provider_failure",
      code: result.code,
      shipmentId: connection.shipment_id,
      detail: result.message,
    });
    return { ok: false, code: result.code, message: result.message };
  }
  if (result.value === null) {
    return {
      ok: false,
      code: "unavailable",
      message: `${adapter.displayName} returned no current position.`,
    };
  }

  const reading = result.value;
  const write = await recordShipmentLocation({
    shipmentId: connection.shipment_id,
    recordedAt: reading.recordedAt,
    latitude: reading.latitude,
    longitude: reading.longitude,
    city: reading.city,
    state: reading.state,
    speedMph: reading.speedMph,
    headingDegrees: reading.headingDegrees,
    source: "eld",
    provider: connection.provider,
    externalEventId: adapter.dedupeKey(reading),
    rawMetadata: reading.raw,
  });

  if (!write.ok) return { ok: false, code: write.code, message: write.message };
  return { ok: true, deduped: write.deduped, reading };
}
