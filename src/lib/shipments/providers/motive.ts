import { createAdapter } from "@/lib/shipments/providers/base";
import {
  finalizeReading,
  pick,
  toHeading,
  toInstant,
  toLatitude,
  toLongitude,
  toRecord,
  toSpeedMph,
  toStateCode,
  toText,
} from "@/lib/shipments/providers/normalize";
import {
  providerFailure,
  type ProviderResult,
  type NormalizedReading,
} from "@/lib/shipments/providers/types";

/**
 * §9's first named provider — Motive (formerly KeepTruckin).
 *
 * NOT CONNECTED. See `base.ts`: every `fetch*` refuses. What is real is the
 * normaliser below, written against Motive's documented vehicle-locations
 * shape — imperial units, a nested `current_location` object, `located_at` as
 * an ISO-8601 instant, `bearing` in degrees.
 *
 * The adapter is written against the ENVELOPE Motive returns as well as the
 * bare object, because the difference between `{"vehicle": {...}}` and
 * `{...}` is the first thing a real integration trips over and it costs one
 * `??` to absorb.
 */
export const MOTIVE_ENV_VARS = ["MOTIVE_API_KEY"] as const;

function normalizeMotive(payload: unknown): ProviderResult<NormalizedReading> {
  const vehicle = (pick(payload, "vehicle") ?? payload) as unknown;
  const loc = pick(vehicle, "current_location") ?? vehicle;

  const recordedAt =
    toInstant(pick(loc, "located_at")) ??
    toInstant(pick(vehicle, "located_at")) ??
    toInstant(pick(payload, "located_at"));

  if (recordedAt === null) {
    return providerFailure(
      "malformed_payload",
      "Motive reading carried no readable `located_at`",
    );
  }

  return finalizeReading({
    externalEventId:
      toText(pick(payload, "id"), 200) ?? toText(pick(vehicle, "id"), 200),
    recordedAt,
    latitude: toLatitude(pick(loc, "lat")),
    longitude: toLongitude(pick(loc, "lon")),
    city: toText(pick(loc, "description"), 120) ?? toText(pick(loc, "city"), 120),
    state: toStateCode(pick(loc, "state")),
    // Motive reports imperial: `speed` is already mph.
    speedMph: toSpeedMph(pick(loc, "speed")),
    headingDegrees: toHeading(pick(loc, "bearing")),
    raw: toRecord(payload),
  });
}

export const motiveAdapter = createAdapter({
  provider: "motive",
  displayName: "Motive",
  requiredEnvVars: MOTIVE_ENV_VARS,
  normalize: normalizeMotive,
});
