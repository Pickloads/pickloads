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
 * §9's fifth enum value — *"other approved telematics providers"*.
 *
 * NOT CONNECTED, and additionally NOT CONFIGURABLE: `requiredEnvVars` is
 * empty, so `isConfigured()` is permanently false. That is deliberate rather
 * than an omission. `other` is the value 0027's `mirror_shipment_event_
 * location` writes when an event arrives from an `eld`/`gps` source whose
 * vendor the ledger did not record — a provenance label, not a vendor.
 * Giving it credentials would mean an unnamed provider could be switched on
 * from the environment, which is the opposite of §15's "approved providers".
 *
 * Its normaliser accepts the FLAT, unambiguous shape a future named provider
 * (or an operator's own gateway) would be asked to post: `lat`, `lon`,
 * `city`, `state`, `speed_mph`, `heading`, `recorded_at`, `event_id`. No
 * envelope guessing, no unit conversion — because with no documented vendor
 * behind it, guessing would be exactly the fabrication §30 forbids.
 */
export const OTHER_ENV_VARS: readonly string[] = [];

function normalizeOther(payload: unknown): ProviderResult<NormalizedReading> {
  const recordedAt = toInstant(pick(payload, "recorded_at"));
  if (recordedAt === null) {
    return providerFailure(
      "malformed_payload",
      "reading carried no readable `recorded_at`",
    );
  }
  return finalizeReading({
    externalEventId: toText(pick(payload, "event_id"), 200),
    recordedAt,
    latitude: toLatitude(pick(payload, "lat")),
    longitude: toLongitude(pick(payload, "lon")),
    city: toText(pick(payload, "city"), 120),
    state: toStateCode(pick(payload, "state")),
    speedMph: toSpeedMph(pick(payload, "speed_mph")),
    headingDegrees: toHeading(pick(payload, "heading")),
    raw: toRecord(payload),
  });
}

export const otherProviderAdapter = createAdapter({
  provider: "other",
  displayName: "Other approved provider",
  requiredEnvVars: OTHER_ENV_VARS,
  normalize: normalizeOther,
});
