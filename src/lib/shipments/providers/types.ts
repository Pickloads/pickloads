import type { TrackingProvider } from "@/lib/shipments/types";

/**
 * M-80 — §9 Mode C: the tracking-provider ADAPTER INTERFACE.
 *
 * ── NO PROVIDER IS CONNECTED ──────────────────────────────────────────────
 *
 * §9 is explicit: *"Do not implement a fake connection."* §30 repeats it from
 * the other side: *"do not display fake GPS positions."* Nothing in this
 * directory opens a socket to Motive, Samsara, Geotab or Verizon Connect, and
 * every `fetch*` method of every shipped adapter refuses. That is not a stub
 * standing in for work that was skipped — it is the honest state of a product
 * with no telematics contract, and the map surfaces say so in words.
 *
 * ── WHAT §9 ACTUALLY ASKED FOR ───────────────────────────────────────────
 *
 * *"Create an adapter interface so future providers can be added without
 * rewriting the shipment system."* Seven responsibilities are named:
 *
 *   1. fetch current vehicle location      → `fetchCurrentLocation`
 *   2. fetch last update time              → `fetchLastUpdateAt`
 *   3. fetch vehicle speed, if permitted   → `fetchVehicleSpeed`
 *   4. fetch ETA inputs                    → `fetchEtaInputs`
 *   5. normalize provider data             → `normalize`  ← IMPLEMENTED FOR REAL
 *   6. store raw provider metadata securely→ `NormalizedReading.raw` → 0027's
 *                                            staff-only `raw_metadata`
 *   7. prevent duplicate events            → `dedupeKey` → 0027's partial
 *                                            unique index on
 *                                            `(shipment_id, provider,
 *                                             external_event_id)`
 *
 * Five of the seven are transport. **`normalize` is not**, and that is the
 * one this module implements for real, per provider, against each vendor's
 * documented payload shape. It is also the piece that decides whether adding
 * a real provider later is a rewrite or a wiring job: the shipment system
 * consumes `NormalizedReading` and knows nothing about anybody's JSON.
 *
 * ── WHY THE RESULT TYPE IS NOT A THROW ───────────────────────────────────
 *
 * The same reason M-72's engine returns typed refusals: "not configured",
 * "consent not granted" and "the provider rate-limited us" are different
 * operational facts that a dispatcher screen and §26's
 * `location_provider_failure` signal both need to tell apart. A thrown
 * `Error` collapses them into a stack trace.
 */

/** Why an adapter call did not produce data. Closed union, on purpose. */
export type ProviderErrorCode =
  /** No credentials in the environment (§15: credentials live in env vars). */
  | "not_configured"
  /** Credentials present, but this adapter has no transport. See the note. */
  | "not_implemented"
  /** No `tracking_provider_connections` row, or it is inactive/expired. */
  | "not_connected"
  /** §9/§13: the driver has not granted location sharing. */
  | "consent_missing"
  /** The provider rejected our credentials. */
  | "unauthorized"
  /** The provider throttled us. */
  | "rate_limited"
  /** The provider was unreachable or returned 5xx. */
  | "unavailable"
  /** A payload arrived that `normalize` could not read. */
  | "malformed_payload";

export interface ProviderFailure {
  ok: false;
  code: ProviderErrorCode;
  /**
   * An OPERATOR sentence. Never a provider payload, never a URL carrying a
   * token: this string reaches a dispatcher screen and §26's signal, and
   * `logShipmentSignal` drops credential-shaped content whole.
   */
  message: string;
}

export type ProviderResult<T> = { ok: true; value: T } | ProviderFailure;

export function providerFailure(
  code: ProviderErrorCode,
  message: string,
): ProviderFailure {
  return { ok: false, code, message };
}

export function providerOk<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/**
 * One position reading, normalized. This is the ONLY shape the shipment
 * system consumes — `src/lib/shipments/locations.ts` maps it onto 0027's
 * `record_shipment_location()` and nothing downstream knows which vendor it
 * came from.
 *
 * `city`/`state` are nullable because most telematics APIs return a fix and
 * leave reverse geocoding to the caller; PickLoads does not reverse-geocode
 * (there is no geocoding provider, and inventing one would be the fake
 * connection §9 forbids), so a coordinate-only reading is stored as exactly
 * that and the customer surfaces show the coordinates or nothing.
 */
export interface NormalizedReading {
  /** §9 "prevent duplicate events" — the provider's own event identifier. */
  externalEventId: string | null;
  /** ISO-8601 UTC. When the truck WAS there. */
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  /** §9 "vehicle speed, if permitted". Miles per hour. */
  speedMph: number | null;
  headingDegrees: number | null;
  /**
   * §9 "store raw provider event metadata securely". Goes to 0027's
   * `raw_metadata`, which is staff-only at the table AND absent from
   * `my_shipment_locations()`'s return type.
   */
  raw: Record<string, unknown>;
}

/** §9 "fetch ETA inputs" — the INPUTS, never a provider ETA claim. */
export interface EtaInputs {
  /** Road miles left to the delivery stop, as the provider computes it. */
  remainingMiles: number | null;
  /** The provider's own drive-time estimate, in minutes. */
  remainingDriveMinutes: number | null;
  /** Remaining HOS driving minutes, when the provider exposes them. */
  hoursOfServiceMinutesRemaining: number | null;
  raw: Record<string, unknown>;
}

/** What an adapter is told about the shipment it is being asked about. */
export interface ProviderContext {
  shipmentId: string;
  /** From `tracking_provider_connections.external_tracking_id`. */
  externalTrackingId: string | null;
  /** From `tracking_provider_connections.consent_status`. */
  consentGranted: boolean;
}

export interface TrackingProviderAdapter {
  readonly provider: TrackingProvider;
  /** Vendor name as a human writes it. Not localized — it is a brand. */
  readonly displayName: string;
  /**
   * The environment variables a real implementation would read. §15:
   * credentials live in environment variables, never database plaintext.
   * Surfaced verbatim in the runbook and on the dispatcher screen so the
   * "not configured" state names what is missing instead of being a shrug.
   */
  readonly requiredEnvVars: readonly string[];

  /** True only when EVERY `requiredEnvVars` entry is present and non-empty. */
  isConfigured(): boolean;

  fetchCurrentLocation(
    ctx: ProviderContext,
  ): Promise<ProviderResult<NormalizedReading | null>>;
  fetchLastUpdateAt(ctx: ProviderContext): Promise<ProviderResult<string | null>>;
  fetchVehicleSpeed(ctx: ProviderContext): Promise<ProviderResult<number | null>>;
  fetchEtaInputs(ctx: ProviderContext): Promise<ProviderResult<EtaInputs | null>>;

  /**
   * The one method implemented for real by every adapter: this vendor's
   * documented payload → `NormalizedReading`. Pure, synchronous, total — it
   * never throws, and an unreadable payload is `malformed_payload`.
   */
  normalize(payload: unknown): ProviderResult<NormalizedReading>;

  /**
   * §9 "prevent duplicate events". The value written to
   * `shipment_locations.external_event_id`, where 0027's partial unique index
   * is the actual enforcement. `null` means the provider gave nothing stable
   * to dedupe on, and the row is stored without a dedupe key rather than with
   * a fabricated one.
   */
  dedupeKey(reading: NormalizedReading): string | null;
}
