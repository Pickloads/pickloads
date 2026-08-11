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
 * §9's second named provider — Samsara.
 *
 * NOT CONNECTED. The normaliser is written against Samsara's documented
 * `vehicles/stats` shape: a `gps` object carrying `latitude`/`longitude`,
 * `headingDegrees`, `speedMilesPerHour`, `time` as RFC-3339, and a
 * `reverseGeo.formattedLocation` string that reads `"Richmond, VA"`.
 *
 * That formatted string is the one thing worth splitting rather than storing
 * whole: it is the only city Samsara gives, and a `city` column holding
 * `"Richmond, VA"` renders as `"Richmond, VA, VA"` on the tracking page.
 * The split is conservative — exactly one comma and a two-letter tail, or the
 * whole string becomes the city and the state stays null.
 */
export const SAMSARA_ENV_VARS = ["SAMSARA_API_TOKEN"] as const;

export function splitFormattedLocation(value: unknown): {
  city: string | null;
  state: string | null;
} {
  const text = toText(value, 200);
  if (text === null) return { city: null, state: null };
  const parts = text.split(",").map((p) => p.trim());
  const tail = parts.length === 2 ? (parts[1] ?? "") : "";
  if (parts.length === 2 && /^[A-Za-z]{2}$/.test(tail)) {
    return { city: toText(parts[0] ?? "", 120), state: tail.toUpperCase() };
  }
  return { city: toText(text, 120), state: null };
}

function normalizeSamsara(payload: unknown): ProviderResult<NormalizedReading> {
  const gps = pick(payload, "gps") ?? payload;

  const recordedAt =
    toInstant(pick(gps, "time")) ?? toInstant(pick(payload, "time"));
  if (recordedAt === null) {
    return providerFailure(
      "malformed_payload",
      "Samsara reading carried no readable `gps.time`",
    );
  }

  const geo = splitFormattedLocation(
    pick(gps, "reverseGeo", "formattedLocation"),
  );

  return finalizeReading({
    externalEventId:
      toText(pick(payload, "id"), 200) ?? toText(pick(gps, "id"), 200),
    recordedAt,
    latitude: toLatitude(pick(gps, "latitude")),
    longitude: toLongitude(pick(gps, "longitude")),
    city: geo.city,
    state: geo.state ?? toStateCode(pick(gps, "reverseGeo", "state")),
    speedMph: toSpeedMph(pick(gps, "speedMilesPerHour")),
    headingDegrees: toHeading(pick(gps, "headingDegrees")),
    raw: toRecord(payload),
  });
}

export const samsaraAdapter = createAdapter({
  provider: "samsara",
  displayName: "Samsara",
  requiredEnvVars: SAMSARA_ENV_VARS,
  normalize: normalizeSamsara,
});
