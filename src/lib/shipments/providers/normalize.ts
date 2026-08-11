import {
  providerFailure,
  providerOk,
  type NormalizedReading,
  type ProviderResult,
} from "@/lib/shipments/providers/types";

/**
 * M-80 — the shared normalisation primitives every provider adapter builds on
 * (§9 "normalize provider data").
 *
 * TOTAL AND DEFENSIVE. Every function here takes `unknown` and returns either
 * a well-formed value or `null`; none of them throws, and none of them
 * coerces. A provider payload is untrusted input arriving over the network
 * from a third party — `Number(x)` on `"12abc"` giving `NaN`, or on `""`
 * giving `0`, is exactly how a truck ends up on the equator.
 *
 * The bounds are the same ones 0027's CHECK constraints enforce, deliberately
 * duplicated: the database is the arbiter, and a value rejected here produces
 * an explainable `malformed_payload` instead of a 23514 from a driver.
 */

/** A finite number, or null. Rejects NaN, ±Infinity, "", booleans, "12abc". */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    // `Number` accepts "0x10", "1e3" and " 12 "; a coordinate that arrives as
    // a hex literal is a payload bug worth surfacing, so the shape is pinned.
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toBoundedNumber(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return n >= min && n <= max ? n : null;
}

/** Latitude in [-90, 90], matching 0027's CHECK. */
export function toLatitude(value: unknown): number | null {
  return toBoundedNumber(value, -90, 90);
}

/** Longitude in [-180, 180], matching 0027's CHECK. */
export function toLongitude(value: unknown): number | null {
  return toBoundedNumber(value, -180, 180);
}

/** Speed in [0, 200] mph. Above that is a malformed payload, not a fast truck. */
export function toSpeedMph(value: unknown): number | null {
  return toBoundedNumber(value, 0, 200);
}

/** Heading in [0, 360) degrees, normalized by modulo so 360 becomes 0. */
export function toHeading(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  const wrapped = ((Math.round(n) % 360) + 360) % 360;
  return wrapped;
}

/** Kilometres per hour → miles per hour, for the providers that report metric. */
export function kphToMph(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return toSpeedMph(Math.round(n * 0.621371 * 10) / 10);
}

/** A non-empty trimmed string bounded to `max`, or null. */
export function toText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * A US state as a two-letter uppercase code, or null.
 *
 * Providers send "NJ", "nj", "New Jersey" and sometimes "US-NJ". Only the
 * two-letter forms are accepted: mapping fifty full names would be a lookup
 * table that silently mistranslates the fifty-first thing a provider sends,
 * and a null state is honest where a wrong state is not.
 */
export function toStateCode(value: unknown): string | null {
  const text = toText(value, 60);
  if (text === null) return null;
  const stripped = text.replace(/^US[-_]/i, "").trim();
  return /^[A-Za-z]{2}$/.test(stripped) ? stripped.toUpperCase() : null;
}

/**
 * An ISO-8601 UTC instant, or null.
 *
 * Accepts an ISO string or a Unix timestamp in SECONDS or MILLISECONDS —
 * telematics APIs use all three — and disambiguates by magnitude: anything
 * below 10^11 is seconds (that boundary is the year 5138 in seconds and 1973
 * in milliseconds, so no real timestamp is ambiguous).
 *
 * A time in the future beyond a minute of clock skew is REFUSED. A provider
 * clock running fast would otherwise pin a truck's "current" position to a
 * reading that has not happened, and 0027's newest-wins update would then
 * ignore every genuine fix that followed.
 */
export function toInstant(value: unknown, now: number = Date.now()): string | null {
  let ms: number | null = null;

  if (typeof value === "number" && Number.isFinite(value)) {
    ms = Math.abs(value) < 1e11 ? value * 1000 : value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      ms = Math.abs(n) < 1e11 ? n * 1000 : n;
    } else {
      const parsed = Date.parse(trimmed);
      ms = Number.isNaN(parsed) ? null : parsed;
    }
  }

  if (ms === null || !Number.isFinite(ms)) return null;
  // 1990-01-01 is before any telematics fleet PickLoads would contract with;
  // anything older is a zero, a sentinel or a unit error.
  if (ms < Date.UTC(1990, 0, 1)) return null;
  if (ms > now + 60_000) return null;
  return new Date(ms).toISOString();
}

/** A plain object, or `{}`. Arrays and primitives are not metadata. */
export function toRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/** Read a nested path out of an unknown payload without throwing. */
export function pick(payload: unknown, ...path: string[]): unknown {
  let cursor: unknown = payload;
  for (const key of path) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * The shared tail of every adapter's `normalize`: apply 0027's own invariants
 * before a row can be attempted, so an adapter bug becomes an explainable
 * refusal rather than a CHECK violation surfacing as a 500.
 *
 *   * coordinates come in pairs (0027 `shipment_locations_coordinate_pair`);
 *   * a reading must name a place or a position
 *     (0027 `shipment_locations_says_something`);
 *   * `recordedAt` must exist — a position with no time is not a reading.
 */
export function finalizeReading(
  draft: NormalizedReading,
): ProviderResult<NormalizedReading> {
  if (draft.recordedAt === "") {
    return providerFailure(
      "malformed_payload",
      "the provider reading carried no usable timestamp",
    );
  }
  const hasLat = draft.latitude !== null;
  const hasLon = draft.longitude !== null;
  if (hasLat !== hasLon) {
    return providerFailure(
      "malformed_payload",
      "the provider reading carried half a coordinate pair — half a fix on a map is a fake position",
    );
  }
  if (!hasLat && draft.city === null && draft.state === null) {
    return providerFailure(
      "malformed_payload",
      "the provider reading named neither a place nor a position",
    );
  }
  return providerOk(draft);
}
