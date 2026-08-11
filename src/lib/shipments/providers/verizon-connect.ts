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
  type NormalizedReading,
  type ProviderResult,
} from "@/lib/shipments/providers/types";

/**
 * §9's fourth named provider — Verizon Connect (Reveal).
 *
 * NOT CONNECTED. The normaliser is written against Reveal's documented
 * vehicle-location shape: an `address` object carrying `city`/`state`, a
 * `location` object carrying `latitude`/`longitude`, `speed` in mph,
 * `direction` in degrees, and `updateUtc` — a UTC instant WITHOUT a zone
 * designator (`"2026-08-04T13:05:00"`), which `Date.parse` would otherwise
 * read in the server's local zone.
 *
 * That is why `normalizeVerizonInstant` exists: a naive parse puts a truck
 * four hours in the past or the future depending on where the container
 * happens to run, and "four hours ago" on a tracking page is a wrong answer
 * presented as a real one.
 */
export const VERIZON_ENV_VARS = [
  "VERIZON_CONNECT_APP_ID",
  "VERIZON_CONNECT_USERNAME",
  "VERIZON_CONNECT_PASSWORD",
] as const;

/** Append `Z` to a zone-less ISO instant before parsing. */
export function normalizeVerizonInstant(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
      return toInstant(`${trimmed.replace(" ", "T")}Z`);
    }
  }
  return toInstant(value);
}

function normalizeVerizon(payload: unknown): ProviderResult<NormalizedReading> {
  const loc = pick(payload, "location") ?? payload;
  const address = pick(payload, "address") ?? loc;

  const recordedAt =
    normalizeVerizonInstant(pick(payload, "updateUtc")) ??
    normalizeVerizonInstant(pick(loc, "updateUtc"));
  if (recordedAt === null) {
    return providerFailure(
      "malformed_payload",
      "Verizon Connect reading carried no readable `updateUtc`",
    );
  }

  return finalizeReading({
    externalEventId:
      toText(pick(payload, "eventId"), 200) ??
      toText(pick(payload, "vehicleNumber"), 200),
    recordedAt,
    latitude: toLatitude(pick(loc, "latitude")),
    longitude: toLongitude(pick(loc, "longitude")),
    city: toText(pick(address, "city"), 120),
    state: toStateCode(pick(address, "state")),
    speedMph: toSpeedMph(pick(payload, "speed") ?? pick(loc, "speed")),
    headingDegrees: toHeading(
      pick(payload, "direction") ?? pick(loc, "direction"),
    ),
    raw: toRecord(payload),
  });
}

export const verizonConnectAdapter = createAdapter({
  provider: "verizon_connect",
  displayName: "Verizon Connect",
  requiredEnvVars: VERIZON_ENV_VARS,
  normalize: normalizeVerizon,
});
