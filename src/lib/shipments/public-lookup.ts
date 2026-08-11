import "server-only";

import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { toPublicTrackingDto, type PublicTrackingDto } from "@/lib/shipments/dto";
import { logShipmentSignal } from "@/lib/shipments/observability";
import {
  DECOY_ACCESS_HASH,
  isTrackingAccessConfigured,
  verifySecondaryValue,
} from "@/lib/shipments/access-code";
import { normalizeTrackingNumber } from "@/lib/shipments/tracking-number";
import { PUBLIC_EXCEPTION_COLUMNS } from "@/lib/shipments/exceptions";
import type {
  ShipmentEventRow,
  ShipmentExceptionRow,
  ShipmentRow,
  TrackingAccessOutcome,
} from "@/lib/shipments/types";

/**
 * M-73 — the server-side public tracking lookup (`docs/DIRECTIVE-tracking.md`
 * §4, §8, §19, §25, §26).
 *
 * §19 is prescriptive about this exact function:
 *
 *   "Do not use direct anonymous table SELECT access. Public tracking requests
 *    must go through a server-side route or server action that: validates
 *    tracking number; validates secondary access credential; applies rate
 *    limiting; returns a strict public DTO; logs access; prevents enumeration."
 *
 * Rate limiting and Turnstile happen one layer up, in
 * `src/app/actions/public-tracking.ts`, because they need the request's
 * `FormData` and headers. Everything else is here.
 *
 * ── NO ANON POLICY EXISTS, AND THAT IS THE POINT ──────────────────────────
 *
 * M-71's 0018 and M-72's 0019 create ZERO anon policies on `shipments` and
 * `shipment_events`. There is therefore no way to reach this data from a
 * browser at all — not with the anon key, not with a crafted PostgREST query,
 * not by guessing a route. The service-role client below is the only door, and
 * this file is the only thing on the far side of it.
 *
 * ── ENUMERATION: ONE REFUSAL, ONE SHAPE, ONE DURATION ─────────────────────
 *
 * Three genuinely different failures — the number does not exist, the number
 * exists but the secondary value is wrong, and the number exists but an admin
 * has suspended public tracking (§15) — return the IDENTICAL value:
 * `{ ok: false, code: "refused" }`. Not similar. Identical: the same object
 * shape with the same single code, so a caller cannot accidentally render a
 * different sentence for one of them, and `tests/unit/shipment-public-lookup.test.ts`
 * asserts deep equality between the three.
 *
 * Timing is equalised two ways:
 *
 *   1. The "no such number" branch still performs a full HMAC + constant-time
 *      comparison, against `DECOY_ACCESS_HASH`. Skipping the comparison when
 *      there is nothing to compare against would make "unknown number" the
 *      fast path and turn the page into an existence oracle regardless of what
 *      the body said.
 *   2. Every outcome is held to `MIN_RESPONSE_MS` before returning, which
 *      absorbs the residual difference between "the SELECT found a row" and
 *      "the SELECT found none" across a real network.
 *
 * A GRANT legitimately takes longer than a refusal — it runs a second query
 * for the timeline. That is not an oracle: reaching it requires already
 * holding the correct credential, which is the thing the attacker does not
 * have.
 *
 * ── THE LEDGER IS NOT OPTIONAL ────────────────────────────────────────────
 *
 * §19 says the route "logs access". It does not say "tries to". If the insert
 * into `shipment_tracking_access` fails, this function REFUSES the lookup even
 * when the credential was correct. An unlogged successful access is precisely
 * the record an enumeration investigation would need and would not have, and
 * the failure mode of the honest alternative — a customer sees "tracking is
 * temporarily unavailable" — is survivable in a way that a silent gap is not.
 */

/**
 * Floor duration for EVERY outcome, in milliseconds.
 *
 * Chosen against the two constraints that actually bound it: comfortably above
 * the p99 difference between a hit and a miss on an indexed unique lookup
 * (single-digit ms), and comfortably below the point at which a human reads
 * the page as broken. It is not a work factor and is not pretending to be one
 * — the rate limit is what makes guessing expensive; this only flattens the
 * signal.
 */
export const MIN_RESPONSE_MS = 350;

/**
 * §25: "event timeline pagination or sensible limits" and "do not load all
 * events … by default when a shipment has a large history".
 *
 * Twenty-five public events is more than any real shipment produces (§8's
 * timeline has nine milestones; the rest are location and ETA updates), so the
 * cap is invisible in practice and hard-bounds the payload of a page anybody
 * on the internet can request. The query asks for one more than the cap purely
 * to answer "is there more?" without a second round trip.
 */
export const PUBLIC_EVENT_LIMIT = 25;

/**
 * M-78 — the same §25 bound for the §21 exception banner.
 *
 * Ten, not twenty-five: an exception is a BANNER, and a page that stacks
 * twenty-five warnings above the status has stopped communicating. Ten is
 * already more than any shipment with an operator paying attention produces,
 * and it hard-bounds a payload anybody on the internet can request.
 */
export const PUBLIC_EXCEPTION_LIMIT = 10;

/** The seven columns `PUBLIC_EXCEPTION_COLUMNS` selects. */
interface PublicExceptionRead {
  id: string;
  shipment_id: string;
  exception_type: ShipmentExceptionRow["exception_type"];
  severity: ShipmentExceptionRow["severity"];
  public_description: string | null;
  opened_at: string;
  resolved_at: string | null;
}

/* ------------------------------------------------------------------ *
 * Rate-limit policy
 *
 * Declared HERE rather than in the server action that applies it: a
 * `"use server"` module may only export async functions, and these two values
 * are policy the tests and the docs need to read by name.
 * ------------------------------------------------------------------ */

/**
 * Four attempts per IP per ten minutes, against the shared default of five.
 *
 * A customer with the right paperwork needs ONE. Four leaves room for a typo,
 * a re-send and a shared office NAT, and still caps a guesser at ~576 attempts
 * a day per address against a 10⁶ sequence space — which, combined with the
 * mandatory second factor, is not a budget anybody works with.
 *
 * A tighter per-TRACKING-NUMBER limit was considered and deliberately NOT
 * added: it would let anyone who knows a customer's number lock that customer
 * out of their own tracking for ten minutes at a time, trading an enumeration
 * risk the second factor already covers for a denial-of-service anyone can
 * mount. The distributed-guessing shape it would have caught is instead made
 * VISIBLE — `idx_shipment_tracking_access_number` (0020) exists so an operator
 * can count attempts per number across every IP.
 */
export const TRACK_RATE_LIMIT = 4;

/** Rate-limit bucket name. Its own bucket, so contact-form traffic is separate. */
export const TRACK_RATE_LIMIT_FORM = "public-tracking";

export interface PublicTrackingLookupRequest {
  trackingNumber: string;
  secondaryValue: string;
  ip: string | null;
  userAgent: string | null;
}

export type PublicTrackingLookupResult =
  | {
      ok: true;
      tracking: PublicTrackingDto;
      /** True when the shipment has more public events than the §25 cap. */
      timelineTruncated: boolean;
    }
  | {
      /**
       * The one refusal. Covers unknown number, wrong secondary value and
       * admin-suspended tracking, with no way for a caller to tell them apart.
       */
      ok: false;
      code: "refused";
    }
  | {
      /**
       * The system could not answer — no service-role key, no
       * `TRACKING_ACCESS_SECRET`, a database error, or a failed ledger write.
       * Distinct from `refused` because it says nothing about any tracking
       * number: it is true for every input, including inputs that do not
       * exist, so it is not an oracle.
       */
      ok: false;
      code: "unavailable";
    };

/** Frozen so no caller can mutate the shared refusal into something narrower. */
const REFUSED: PublicTrackingLookupResult = Object.freeze({
  ok: false,
  code: "refused",
} as const);

const UNAVAILABLE: PublicTrackingLookupResult = Object.freeze({
  ok: false,
  code: "unavailable",
} as const);

/** Columns the ledger accepts. Bounded here as well as by 0020's CHECKs. */
const MAX_LOGGED_NUMBER = 64;
const MAX_LOGGED_IP = 64;
const MAX_LOGGED_UA = 512;

function truncate(value: string | null, max: number): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

async function settle(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed >= MIN_RESPONSE_MS) return;
  await new Promise((resolve) => setTimeout(resolve, MIN_RESPONSE_MS - elapsed));
}

/**
 * Write one row to `shipment_tracking_access`. Returns false if the write did
 * not happen, which the caller treats as a refusal (see the header).
 *
 * NOTE WHAT IS NOT A PARAMETER: the attempted secondary value. It has no way
 * into this function, which is a stronger guarantee than a rule about not
 * passing it — the same construction argument M-70 makes for the DTO
 * allow-list and M-72 makes for `logShipmentSignal`.
 */
export async function recordTrackingAccess(
  client: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  entry: {
    shipmentId: string | null;
    trackingNumberAttempted: string;
    outcome: TrackingAccessOutcome;
    ip: string | null;
    userAgent: string | null;
    profileId?: string | null;
  },
): Promise<boolean> {
  const attempted =
    truncate(entry.trackingNumberAttempted, MAX_LOGGED_NUMBER) ?? "(empty)";
  const { error } = await client.from("shipment_tracking_access").insert({
    shipment_id: entry.shipmentId,
    tracking_number_attempted: attempted,
    outcome: entry.outcome,
    ip: truncate(entry.ip, MAX_LOGGED_IP),
    user_agent: truncate(entry.userAgent, MAX_LOGGED_UA),
    profile_id: entry.profileId ?? null,
  });
  if (error) {
    logShipmentSignal({
      signal: "public_tracking_failure",
      code: "access_log_write_failed",
      trackingNumber: attempted,
      detail: error.message,
    });
    return false;
  }
  return true;
}

/**
 * Log an attempt that never reached the lookup because the rate limiter
 * rejected it.
 *
 * §26 names `repeated_invalid_tracking_attempts` as a tracked signal, and the
 * ledger is where an operator counts them. A rate-limited request that left no
 * trace would make the ledger under-report exactly the burst it exists to
 * detect. Best-effort by design: a rate-limited caller is already being
 * refused, so a failed log write changes nothing about the response.
 */
export async function recordRateLimitedAttempt(
  trackingNumber: string,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const client = tryCreateAdminClient();
  if (client === null) return;
  const attempted = loggableNumber(trackingNumber);
  await recordTrackingAccess(client, {
    shipmentId: null,
    trackingNumberAttempted: attempted,
    outcome: "rate_limited",
    ip,
    userAgent,
  });
  logShipmentSignal({
    signal: "repeated_invalid_tracking_attempts",
    code: "rate_limited",
    trackingNumber: attempted,
    detail: "public tracking lookup rate limit tripped",
  });
}

/**
 * What goes in the ledger's `tracking_number_attempted` column.
 *
 * The CANONICAL form when the input parses, so `pl 2026 000101` and
 * `PL-2026-000101` land on the same row and an operator counting attempts
 * against one number sees one number. The RAW (bounded) input when it does
 * not, because "what exactly is this script posting?" is the question a
 * malformed attempt exists to answer, and normalising it away would discard
 * the evidence.
 */
function loggableNumber(raw: string): string {
  const canonical = normalizeTrackingNumber(raw);
  if (canonical !== null) return canonical;
  return truncate(raw, MAX_LOGGED_NUMBER) ?? "(empty)";
}

/** The `shipments` columns the public path reads — never `select("*")`. */
const SHIPMENT_COLUMNS =
  "id, tracking_number, shipper_id, carrier_id, dispatcher_id, quote_id, " +
  "broker_partner_id, load_id, status, origin_company, origin_address, " +
  "origin_city, origin_state, origin_zip, destination_company, " +
  "destination_address, destination_city, destination_state, destination_zip, " +
  "pickup_appointment_at, delivery_appointment_at, equipment, " +
  "commodity_category, weight_lbs, pallets, distance_miles, shipper_reference, " +
  "po_number, public_tracking_enabled, tracking_mode, location_visibility, " +
  "public_access_hash, current_latitude, current_longitude, current_city, " +
  "current_state, last_location_at, estimated_pickup_at, " +
  "estimated_delivery_at, eta_source, eta_confidence, eta_updated_at, " +
  "delay_minutes, delay_reason_public, created_at, updated_at, completed_at, " +
  "cancelled_at, cancellation_reason";

/**
 * The one thing that must never be selected on this path, named so the
 * omission is a decision rather than an accident: the three §18 financial
 * columns (`gross_shipper_amount`, `carrier_pay`, `margin`) and
 * `delay_reason_internal`. The DTO would drop them anyway — this is defence in
 * depth, so they never enter the process's memory on a public request at all.
 * `tests/unit/shipment-public-lookup.test.ts` asserts the projection.
 */
export const FORBIDDEN_PUBLIC_COLUMNS = [
  "gross_shipper_amount",
  "carrier_pay",
  "margin",
  "delay_reason_internal",
] as const;

const EVENT_COLUMNS =
  "id, shipment_id, event_type, status, event_time, recorded_at, source, " +
  "created_by, city, state, latitude, longitude, public_message, visibility, " +
  "external_event_id, idempotency_key";

/**
 * The §19 lookup.
 *
 * Order of operations, and the reason each step sits where it does:
 *
 *   1. normalise the number (tolerant: case, whitespace, dash variants) so a
 *      value pasted out of a PDF is not a false refusal;
 *   2. refuse UNCONFIGURED environments before touching the database — with no
 *      HMAC key there is no way to verify a credential, and "cannot verify" is
 *      not "verified";
 *   3. one indexed SELECT on `tracking_number`, projecting an explicit column
 *      list that excludes every financial field;
 *   4. verify the secondary value in constant time, against the real hash or
 *      the decoy — ALWAYS, even when there was no row;
 *   5. log the attempt, with the true outcome, before returning anything;
 *   6. return the strict public DTO, or the single shared refusal;
 *   7. hold the response to `MIN_RESPONSE_MS` on every path.
 */
export async function lookupPublicTracking(
  request: PublicTrackingLookupRequest,
): Promise<PublicTrackingLookupResult> {
  const startedAt = Date.now();
  // `normalizeTrackingNumber` VALIDATES as well as folds: null means the input
  // is not a well-formed PickLoads number at all (wrong prefix, impossible
  // year, seven digits). That is a miss, not an error — see step 3 below.
  const canonical = normalizeTrackingNumber(request.trackingNumber);
  const attempted = loggableNumber(request.trackingNumber);

  const client = tryCreateAdminClient();
  if (client === null || !isTrackingAccessConfigured()) {
    logShipmentSignal({
      signal: "public_tracking_failure",
      code: "not_configured",
      detail:
        client === null
          ? "service-role key unset"
          : "TRACKING_ACCESS_SECRET unset — cannot verify the §4 secondary credential",
    });
    await settle(startedAt);
    return UNAVAILABLE;
  }

  let shipment: ShipmentRow | null = null;
  // A malformed number cannot match the unique index, so the query is skipped
  // — but the decoy comparison and the ledger write below still run, so the
  // response is indistinguishable from a well-formed miss.
  if (canonical !== null) {
    const { data, error } = await client
      .from("shipments")
      .select(SHIPMENT_COLUMNS)
      .eq("tracking_number", canonical)
      .maybeSingle();
    if (error) {
      logShipmentSignal({
        signal: "public_tracking_failure",
        code: "shipment_query_failed",
        trackingNumber: attempted,
        detail: error.message,
      });
      await settle(startedAt);
      return UNAVAILABLE;
    }
    shipment = (data as ShipmentRow | null) ?? null;
  }

  // STEP 4 — unconditional. `shipment === null` compares against the decoy.
  const secondaryOk = verifySecondaryValue(
    request.secondaryValue,
    shipment === null ? DECOY_ACCESS_HASH : shipment.public_access_hash,
  );

  const outcome: TrackingAccessOutcome =
    shipment === null
      ? "not_found"
      : !secondaryOk
        ? "bad_secondary"
        : !shipment.public_tracking_enabled
          ? "tracking_disabled"
          : "granted";

  const logged = await recordTrackingAccess(client, {
    shipmentId: shipment?.id ?? null,
    trackingNumberAttempted: attempted,
    outcome,
    ip: request.ip,
    userAgent: request.userAgent,
  });

  if (outcome !== "granted" || !logged || shipment === null) {
    await settle(startedAt);
    return REFUSED;
  }

  // §25: newest-first, hard-capped, one extra row to detect truncation.
  // `visibility = 'public'` is applied in SQL as well as in the DTO — the
  // index `idx_shipment_events_audience` exists precisely so a public request
  // never touches a staff_only row, rather than fetching and then filtering.
  //
  // M-78 joins the fan-out rather than adding a third round trip (§25's "no
  // N+1" is about round trips, and two concurrent reads is one). The exception
  // read is BOUNDED and its projection names neither `internal_description`
  // nor `resolution` — see `PUBLIC_EXCEPTION_COLUMNS`. `public_description
  // is not null` is applied in SQL as well as in M-70's DTO: an exception with
  // nothing honest to say never enters this process.
  const [
    { data: eventRows, error: eventError },
    { data: exceptionRows, error: exceptionError },
  ] = await Promise.all([
    client
      .from("shipment_events")
      .select(EVENT_COLUMNS)
      .eq("shipment_id", shipment.id)
      .eq("visibility", "public")
      .order("event_time", { ascending: false })
      .order("id", { ascending: false })
      .limit(PUBLIC_EVENT_LIMIT + 1),
    client
      .from("shipment_exceptions")
      .select(PUBLIC_EXCEPTION_COLUMNS)
      .eq("shipment_id", shipment.id)
      .not("public_description", "is", null)
      .order("opened_at", { ascending: false })
      .limit(PUBLIC_EXCEPTION_LIMIT),
  ]);

  if (eventError) {
    logShipmentSignal({
      signal: "public_tracking_failure",
      code: "timeline_query_failed",
      shipmentId: shipment.id,
      trackingNumber: attempted,
      detail: eventError.message,
    });
    await settle(startedAt);
    return UNAVAILABLE;
  }

  const rows = (eventRows ?? []) as unknown as ShipmentEventRow[];
  const timelineTruncated = rows.length > PUBLIC_EVENT_LIMIT;
  const events = rows.slice(0, PUBLIC_EVENT_LIMIT);

  /*
   * M-78 — the wiring M-73 said was "one argument".
   *
   * The exception read FAILS SOFT while the timeline read fails hard, and the
   * asymmetry is deliberate. A timeline that silently lost its events would
   * make a moving shipment look stalled — a wrong answer. A missing exception
   * banner is a MISSING answer on a page whose status, ETA and timeline are
   * all still correct, and refusing the whole lookup over it would take a
   * customer's tracking page away to avoid a degraded one. The failure is
   * logged as a §26 signal so it is visible rather than silent.
   *
   * The rows are widened to `ShipmentExceptionRow` with the withheld columns
   * written out as the nulls they are — the same discipline the shipper detail
   * page applies to `ShipmentRow`, and the reason a new column on the row type
   * is a compile error here rather than an accidental disclosure.
   */
  if (exceptionError) {
    logShipmentSignal({
      signal: "public_tracking_failure",
      code: "exception_query_failed",
      shipmentId: shipment.id,
      trackingNumber: attempted,
      detail: exceptionError.message,
    });
  }
  const exceptions: ShipmentExceptionRow[] = (
    // On error the list is EMPTY, explicitly rather than by trusting the
    // driver to null `data` — a half-read banner is worse than no banner.
    exceptionError ? [] : ((exceptionRows ?? []) as unknown as PublicExceptionRead[])
  ).map((row) => ({
    id: row.id,
    shipment_id: row.shipment_id,
    exception_type: row.exception_type,
    severity: row.severity,
    public_description: row.public_description,
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

  const tracking = toPublicTrackingDto({
    shipment,
    events,
    exceptions,
  });

  await settle(startedAt);
  return { ok: true, tracking, timelineTruncated };
}
