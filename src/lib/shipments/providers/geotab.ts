import { createAdapter } from "@/lib/shipments/providers/base";
import {
  finalizeReading,
  kphToMph,
  pick,
  toHeading,
  toInstant,
  toLatitude,
  toLongitude,
  toRecord,
  toStateCode,
  toText,
} from "@/lib/shipments/providers/normalize";
import {
  providerFailure,
  type NormalizedReading,
  type ProviderResult,
} from "@/lib/shipments/providers/types";

/**
 * §9's third named provider — Geotab.
 *
 * NOT CONNECTED. The normaliser is written against Geotab's documented
 * `DeviceStatusInfo` shape: `latitude`/`longitude`, `bearing`, `dateTime`,
 * and — the one that matters — **`speed` in KILOMETRES PER HOUR**.
 *
 * That unit difference is the reason this adapter exists as its own file
 * rather than as a shape argument to a generic one. A generic "read `speed`"
 * adapter reports a truck at 105 mph on a 105 km/h motorway, which is a wrong
 * number presented as a real one — the failure mode §30 is about. Units are
 * a per-provider fact, so they live in the per-provider normaliser.
 *
 * Geotab also authenticates with a database name as well as credentials,
 * which is why `requiredEnvVars` has three entries: `isConfigured()` must be
 * false when any one of them is missing, not just the password.
 */
export const GEOTAB_ENV_VARS = [
  "GEOTAB_DATABASE",
  "GEOTAB_USERNAME",
  "GEOTAB_PASSWORD",
] as const;

function normalizeGeotab(payload: unknown): ProviderResult<NormalizedReading> {
  const status = (pick(payload, "data") ?? payload) as unknown;

  const recordedAt =
    toInstant(pick(status, "dateTime")) ?? toInstant(pick(payload, "dateTime"));
  if (recordedAt === null) {
    return providerFailure(
      "malformed_payload",
      "Geotab reading carried no readable `dateTime`",
    );
  }

  return finalizeReading({
    externalEventId:
      toText(pick(status, "id"), 200) ??
      toText(pick(status, "device", "id"), 200),
    recordedAt,
    latitude: toLatitude(pick(status, "latitude")),
    longitude: toLongitude(pick(status, "longitude")),
    city: toText(pick(status, "city"), 120),
    state: toStateCode(pick(status, "state")),
    // KM/H → MPH. The single most consequential line in this file.
    speedMph: kphToMph(pick(status, "speed")),
    headingDegrees: toHeading(pick(status, "bearing")),
    raw: toRecord(payload),
  });
}

export const geotabAdapter = createAdapter({
  provider: "geotab",
  displayName: "Geotab",
  requiredEnvVars: GEOTAB_ENV_VARS,
  normalize: normalizeGeotab,
});
