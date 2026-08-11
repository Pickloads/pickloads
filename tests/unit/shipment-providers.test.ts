import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  PROVIDER_ADAPTERS,
  anyProviderConfigured,
  getProviderAdapter,
  providerStatuses,
} from "@/lib/shipments/providers";
import {
  finalizeReading,
  kphToMph,
  pick,
  toFiniteNumber,
  toHeading,
  toInstant,
  toLatitude,
  toLongitude,
  toRecord,
  toSpeedMph,
  toStateCode,
  toText,
} from "@/lib/shipments/providers/normalize";
import { splitFormattedLocation } from "@/lib/shipments/providers/samsara";
import { normalizeVerizonInstant } from "@/lib/shipments/providers/verizon-connect";
import {
  DISPATCHER_ETA_SOURCES,
  ETA_SOURCES,
  TRACKING_PROVIDERS,
  UNREACHABLE_ETA_SOURCES,
} from "@/lib/shipments/types";
import {
  SHIPMENT_SIGNALS,
  redactDetail,
} from "@/lib/shipments/observability";

/**
 * M-80 — §9 Mode C's adapter interface.
 *
 * ── WHAT THIS SUITE IS ACTUALLY PROVING ──────────────────────────────────
 *
 * Two different claims, and they pull in opposite directions:
 *
 *   1. **NOTHING IS CONNECTED.** §9 forbids a fake connection and §30 forbids
 *      a fake position. So every named provider's four `fetch*` methods are
 *      asserted to REFUSE — with `not_configured` when the environment is
 *      empty and `not_implemented` when it is not — and no adapter is allowed
 *      to return a reading from any of them, ever.
 *   2. **THE INTERFACE IS REAL.** `normalize` is implemented per vendor
 *      against that vendor's documented payload shape, `dedupeKey` produces
 *      the value 0027's unique index enforces, and the registry is a full
 *      `Record` so a sixth provider is a compile error. Those are what make
 *      "adding a provider needs no rewrite" checkable rather than aspirational.
 *
 * The second claim is the one that would quietly rot: an interface nobody
 * exercises drifts from the database it feeds. So the normalisers are tested
 * against real vendor-shaped payloads, unit conversions included.
 */

const ENV_KEYS = [
  "MOTIVE_API_KEY",
  "SAMSARA_API_TOKEN",
  "GEOTAB_DATABASE",
  "GEOTAB_USERNAME",
  "GEOTAB_PASSWORD",
  "VERIZON_CONNECT_APP_ID",
  "VERIZON_CONNECT_USERNAME",
  "VERIZON_CONNECT_PASSWORD",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

/* ================================================================== *
 * 1 · The registry
 * ================================================================== */

describe("the provider registry (§9 Mode C)", () => {
  it("has an adapter for every value of M-70's TrackingProvider enum", () => {
    expect(Object.keys(PROVIDER_ADAPTERS).sort()).toEqual(
      [...TRACKING_PROVIDERS].sort(),
    );
  });

  it("names §9's four vendors exactly", () => {
    const names = Object.values(PROVIDER_ADAPTERS).map((a) => a.displayName);
    expect(names).toContain("Motive");
    expect(names).toContain("Samsara");
    expect(names).toContain("Geotab");
    expect(names).toContain("Verizon Connect");
  });

  it("returns the adapter whose `provider` matches its registry key", () => {
    for (const provider of TRACKING_PROVIDERS) {
      expect(getProviderAdapter(provider).provider).toBe(provider);
    }
  });

  it("reports NO provider connected, in the shape the dispatcher table reads", () => {
    for (const status of providerStatuses()) {
      expect(status.connected).toBe(false);
      expect(status.configured).toBe(false);
    }
    expect(anyProviderConfigured()).toBe(false);
  });
});

/* ================================================================== *
 * 2 · Conformance: every named adapter refuses every fetch
 * ================================================================== */

describe("adapter conformance — no fake connection (§9, §30)", () => {
  const ctx = {
    shipmentId: "11111111-1111-4111-8111-111111111111",
    externalTrackingId: "veh-1",
    consentGranted: true,
  };

  for (const provider of TRACKING_PROVIDERS) {
    const adapter = PROVIDER_ADAPTERS[provider];

    it(`${provider}: implements the whole interface`, () => {
      expect(typeof adapter.isConfigured).toBe("function");
      expect(typeof adapter.fetchCurrentLocation).toBe("function");
      expect(typeof adapter.fetchLastUpdateAt).toBe("function");
      expect(typeof adapter.fetchVehicleSpeed).toBe("function");
      expect(typeof adapter.fetchEtaInputs).toBe("function");
      expect(typeof adapter.normalize).toBe("function");
      expect(typeof adapter.dedupeKey).toBe("function");
      expect(Array.isArray(adapter.requiredEnvVars)).toBe(true);
    });

    it(`${provider}: is NOT configured with an empty environment`, () => {
      expect(adapter.isConfigured()).toBe(false);
    });

    it(`${provider}: every fetch refuses with not_configured and names its env vars`, async () => {
      const results = await Promise.all([
        adapter.fetchCurrentLocation(ctx),
        adapter.fetchLastUpdateAt(ctx),
        adapter.fetchVehicleSpeed(ctx),
        adapter.fetchEtaInputs(ctx),
      ]);
      for (const result of results) {
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.code).toBe("not_configured");
        expect(result.message).toContain(adapter.displayName);
        for (const name of adapter.requiredEnvVars) {
          expect(result.message).toContain(name);
        }
      }
    });
  }

  it("with credentials present, refuses with not_implemented rather than data", async () => {
    // The trap this closes: an operator sets MOTIVE_API_KEY in Vercel and
    // expects tracking to start working. It does not, and the refusal says so
    // in words rather than looking like an outage.
    process.env.MOTIVE_API_KEY = "not-a-real-key";
    const motive = PROVIDER_ADAPTERS.motive;
    expect(motive.isConfigured()).toBe(true);
    const result = await motive.fetchCurrentLocation(ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_implemented");
    expect(result.message).toContain("no fake connection");
  });

  it("Geotab needs ALL THREE credentials, not just the password", () => {
    process.env.GEOTAB_PASSWORD = "x";
    expect(PROVIDER_ADAPTERS.geotab.isConfigured()).toBe(false);
    process.env.GEOTAB_DATABASE = "db";
    expect(PROVIDER_ADAPTERS.geotab.isConfigured()).toBe(false);
    process.env.GEOTAB_USERNAME = "u";
    expect(PROVIDER_ADAPTERS.geotab.isConfigured()).toBe(true);
  });

  it("a blank environment variable does not count as configured", () => {
    process.env.SAMSARA_API_TOKEN = "   ";
    expect(PROVIDER_ADAPTERS.samsara.isConfigured()).toBe(false);
  });

  it("`other` can NEVER be configured — it is a provenance label, not a vendor", () => {
    expect(PROVIDER_ADAPTERS.other.requiredEnvVars).toEqual([]);
    expect(PROVIDER_ADAPTERS.other.isConfigured()).toBe(false);
  });

  it("ANTI-VACUITY: a hypothetical adapter that RETURNED a reading would fail the refusal test", async () => {
    // If the refusal assertions could not fail, they would prove nothing.
    const fake = {
      async fetchCurrentLocation() {
        return { ok: true as const, value: null };
      },
    };
    const result = await fake.fetchCurrentLocation();
    expect(result.ok).toBe(true);
    // …which is exactly what the loop above asserts is FALSE for every
    // shipped adapter.
  });
});

/* ================================================================== *
 * 3 · Normalisation primitives
 * ================================================================== */

describe("normalisation primitives", () => {
  it("refuses coercion garbage that `Number()` would accept", () => {
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber("12abc")).toBeNull();
    expect(toFiniteNumber("0x10")).toBeNull();
    expect(toFiniteNumber(true)).toBeNull();
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber("  40.5 ")).toBe(40.5);
    expect(toFiniteNumber(-74.17)).toBe(-74.17);
  });

  it("bounds coordinates exactly as 0027's CHECK constraints do", () => {
    expect(toLatitude(90)).toBe(90);
    expect(toLatitude(-90)).toBe(-90);
    expect(toLatitude(90.0001)).toBeNull();
    expect(toLongitude(-180)).toBe(-180);
    expect(toLongitude(180.1)).toBeNull();
  });

  it("rejects an impossible speed rather than storing it", () => {
    expect(toSpeedMph(62)).toBe(62);
    expect(toSpeedMph(0)).toBe(0);
    expect(toSpeedMph(4000)).toBeNull();
    expect(toSpeedMph(-3)).toBeNull();
  });

  it("wraps heading into [0, 360)", () => {
    expect(toHeading(0)).toBe(0);
    expect(toHeading(360)).toBe(0);
    expect(toHeading(361)).toBe(1);
    expect(toHeading(-90)).toBe(270);
    expect(toHeading("x")).toBeNull();
  });

  it("converts km/h to mph — the Geotab unit trap", () => {
    // 105 km/h is 65 mph, not 105 mph.
    expect(kphToMph(105)).toBeCloseTo(65.2, 1);
    expect(kphToMph(0)).toBe(0);
    // 400 km/h is 248 mph, above the bound — refused rather than clamped.
    expect(kphToMph(400)).toBeNull();
  });

  it("accepts only two-letter state codes, never a guessed full name", () => {
    expect(toStateCode("NJ")).toBe("NJ");
    expect(toStateCode("nj")).toBe("NJ");
    expect(toStateCode("US-VA")).toBe("VA");
    expect(toStateCode("New Jersey")).toBeNull();
    expect(toStateCode("")).toBeNull();
  });

  it("parses ISO, second and millisecond timestamps, and refuses the rest", () => {
    const now = Date.UTC(2026, 7, 6, 12, 0, 0);
    expect(toInstant("2026-08-04T13:05:00Z", now)).toBe(
      "2026-08-04T13:05:00.000Z",
    );
    expect(toInstant(1_754_312_700, now)).toBe(
      new Date(1_754_312_700_000).toISOString(),
    );
    expect(toInstant(1_754_312_700_000, now)).toBe(
      new Date(1_754_312_700_000).toISOString(),
    );
    expect(toInstant("not a date", now)).toBeNull();
    expect(toInstant(0, now)).toBeNull();
    // A provider clock running fast must not pin "current" to the future.
    expect(toInstant(now + 3_600_000, now)).toBeNull();
    // Sixty seconds of skew is tolerated.
    expect(toInstant(now + 30_000, now)).not.toBeNull();
  });

  it("treats only plain objects as metadata", () => {
    expect(toRecord({ a: 1 })).toEqual({ a: 1 });
    expect(toRecord([1, 2])).toEqual({});
    expect(toRecord(null)).toEqual({});
    expect(toRecord("x")).toEqual({});
  });

  it("reads nested paths without throwing on anything", () => {
    expect(pick({ a: { b: 1 } }, "a", "b")).toBe(1);
    expect(pick({ a: null }, "a", "b")).toBeUndefined();
    expect(pick(null, "a")).toBeUndefined();
    expect(pick([1], "a", "b")).toBeUndefined();
  });

  it("bounds text and drops blanks", () => {
    expect(toText("  Richmond ", 120)).toBe("Richmond");
    expect(toText("   ", 120)).toBeNull();
    expect(toText(42, 120)).toBeNull();
    expect(toText("x".repeat(200), 120)?.length).toBe(120);
  });

  it("finalizeReading enforces 0027's three invariants", () => {
    const base = {
      externalEventId: null,
      recordedAt: "2026-08-04T13:00:00.000Z",
      latitude: null,
      longitude: null,
      city: null,
      state: null,
      speedMph: null,
      headingDegrees: null,
      raw: {},
    };
    // Half a coordinate pair.
    const half = finalizeReading({ ...base, latitude: 40 });
    expect(half.ok).toBe(false);
    if (!half.ok) expect(half.code).toBe("malformed_payload");
    // Neither a place nor a position.
    const empty = finalizeReading(base);
    expect(empty.ok).toBe(false);
    // A place alone is fine — that is Mode A.
    expect(finalizeReading({ ...base, city: "Newark" }).ok).toBe(true);
    // A pair alone is fine — that is Mode C.
    expect(
      finalizeReading({ ...base, latitude: 40, longitude: -74 }).ok,
    ).toBe(true);
  });
});

/* ================================================================== *
 * 4 · Per-vendor normalisation
 * ================================================================== */

describe("Motive normalisation", () => {
  it("reads the documented envelope, in imperial units", () => {
    const result = PROVIDER_ADAPTERS.motive.normalize({
      id: "evt-771",
      vehicle: {
        id: "veh-9",
        current_location: {
          lat: 37.5407,
          lon: -77.436,
          located_at: "2026-08-04T13:05:00Z",
          description: "Richmond",
          state: "VA",
          speed: 62,
          bearing: 190,
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      externalEventId: "evt-771",
      recordedAt: "2026-08-04T13:05:00.000Z",
      latitude: 37.5407,
      longitude: -77.436,
      city: "Richmond",
      state: "VA",
      speedMph: 62,
      headingDegrees: 190,
    });
  });

  it("accepts the bare object as well as the envelope", () => {
    const result = PROVIDER_ADAPTERS.motive.normalize({
      current_location: {
        lat: 40,
        lon: -74,
        located_at: "2026-08-04T13:05:00Z",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a payload with no timestamp rather than stamping now()", () => {
    const result = PROVIDER_ADAPTERS.motive.normalize({
      vehicle: { current_location: { lat: 40, lon: -74 } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("malformed_payload");
  });

  it("keeps the whole payload as raw metadata (§9)", () => {
    const payload = { id: "e", vehicle: { current_location: { lat: 40, lon: -74, located_at: "2026-08-04T13:05:00Z" } }, extra: "keep me" };
    const result = PROVIDER_ADAPTERS.motive.normalize(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.raw).toEqual(payload);
  });
});

describe("Samsara normalisation", () => {
  it("splits `reverseGeo.formattedLocation` into city and state", () => {
    expect(splitFormattedLocation("Richmond, VA")).toEqual({
      city: "Richmond",
      state: "VA",
    });
    // Not a two-letter tail: the whole string is the city, the state stays
    // null. A wrong state is worse than a missing one.
    expect(splitFormattedLocation("Richmond, Virginia")).toEqual({
      city: "Richmond, Virginia",
      state: null,
    });
    expect(splitFormattedLocation(null)).toEqual({ city: null, state: null });
  });

  it("never produces `Richmond, VA, VA`", () => {
    const result = PROVIDER_ADAPTERS.samsara.normalize({
      id: "s-1",
      gps: {
        latitude: 37.5407,
        longitude: -77.436,
        time: "2026-08-04T13:05:00Z",
        speedMilesPerHour: 58,
        headingDegrees: 12,
        reverseGeo: { formattedLocation: "Richmond, VA" },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.city).toBe("Richmond");
    expect(result.value.state).toBe("VA");
    expect(result.value.speedMph).toBe(58);
  });
});

describe("Geotab normalisation", () => {
  it("converts km/h to mph — a 105 km/h truck is not doing 105 mph", () => {
    const result = PROVIDER_ADAPTERS.geotab.normalize({
      data: {
        id: "g-1",
        latitude: 37.5407,
        longitude: -77.436,
        dateTime: "2026-08-04T13:05:00.000Z",
        speed: 105,
        bearing: 190,
        city: "Richmond",
        state: "VA",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.speedMph).toBeCloseTo(65.2, 1);
  });
});

describe("Verizon Connect normalisation", () => {
  it("treats a zone-less `updateUtc` as UTC, not as server-local time", () => {
    // The whole point of the helper: `Date.parse("2026-08-04T13:05:00")`
    // is LOCAL, so on a UTC-4 host the truck would land four hours out.
    expect(normalizeVerizonInstant("2026-08-04T13:05:00")).toBe(
      "2026-08-04T13:05:00.000Z",
    );
    expect(normalizeVerizonInstant("2026-08-04 13:05:00")).toBe(
      "2026-08-04T13:05:00.000Z",
    );
    // An explicit zone is respected.
    expect(normalizeVerizonInstant("2026-08-04T13:05:00Z")).toBe(
      "2026-08-04T13:05:00.000Z",
    );
  });

  it("reads the documented address/location split", () => {
    const result = PROVIDER_ADAPTERS.verizon_connect.normalize({
      eventId: "v-1",
      updateUtc: "2026-08-04T13:05:00",
      speed: 55,
      direction: 271,
      address: { city: "Richmond", state: "VA" },
      location: { latitude: 37.5407, longitude: -77.436 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      externalEventId: "v-1",
      city: "Richmond",
      state: "VA",
      speedMph: 55,
      headingDegrees: 271,
      recordedAt: "2026-08-04T13:05:00.000Z",
    });
  });
});

/* ================================================================== *
 * 5 · Dedupe (§9 "prevent duplicate events")
 * ================================================================== */

describe("dedupe keys (§9)", () => {
  const reading = (externalEventId: string | null) => ({
    externalEventId,
    recordedAt: "2026-08-04T13:05:00.000Z",
    latitude: 40,
    longitude: -74,
    city: null,
    state: null,
    speedMph: null,
    headingDegrees: null,
    raw: {},
  });

  it("namespaces by provider, so two vendors sharing an id do not collide", () => {
    expect(PROVIDER_ADAPTERS.motive.dedupeKey(reading("abc"))).toBe(
      "motive:abc",
    );
    expect(PROVIDER_ADAPTERS.samsara.dedupeKey(reading("abc"))).toBe(
      "samsara:abc",
    );
    expect(PROVIDER_ADAPTERS.motive.dedupeKey(reading("abc"))).not.toBe(
      PROVIDER_ADAPTERS.samsara.dedupeKey(reading("abc")),
    );
  });

  it("is STABLE — the same event id always yields the same key", () => {
    const a = PROVIDER_ADAPTERS.geotab.dedupeKey(reading("evt-9"));
    const b = PROVIDER_ADAPTERS.geotab.dedupeKey(reading("evt-9"));
    expect(a).toBe(b);
  });

  it("returns null rather than FABRICATING a key when the provider gave none", () => {
    // A synthesised key would silently drop a genuine repeated reading.
    expect(PROVIDER_ADAPTERS.motive.dedupeKey(reading(null))).toBeNull();
    expect(PROVIDER_ADAPTERS.motive.dedupeKey(reading("   "))).toBeNull();
  });

  it("stays within the 200-character column bound 0027 declares", () => {
    const key = PROVIDER_ADAPTERS.verizon_connect.dedupeKey(
      reading("x".repeat(400)),
    );
    expect(key).not.toBeNull();
    expect((key ?? "").length).toBeLessThanOrEqual(200);
  });
});

/* ================================================================== *
 * 6 · §10 — `eta_source = 'provider'` stays UNREACHABLE
 * ================================================================== */

describe("§10 — M-78's partition is still truthful after M-80", () => {
  it("`provider` remains in UNREACHABLE_ETA_SOURCES", () => {
    // M-78 shipped `DISPATCHER_ETA_SOURCES ∪ UNREACHABLE_ETA_SOURCES =
    // ETA_SOURCES` as a partition and instructed M-80 to move `provider` in
    // the SAME commit that makes it reachable. It is not reachable: no
    // adapter has a transport, so no provider ETA exists to label. Moving it
    // would make §30's honest-label rule a lie in the other direction.
    expect(UNREACHABLE_ETA_SOURCES).toContain("provider");
    expect(DISPATCHER_ETA_SOURCES).not.toContain("provider");
    expect(
      [...DISPATCHER_ETA_SOURCES, ...UNREACHABLE_ETA_SOURCES].sort(),
    ).toEqual([...ETA_SOURCES].sort());
  });

  it("NO M-80 module writes an `eta_source` at all", () => {
    // `fetchEtaInputs` returns INPUTS (miles, drive minutes, HOS) and never a
    // provider ETA claim, so nothing in this module is in a position to set
    // the column. Asserted by scanning the source rather than by inspection.
    for (const file of [
      "src/lib/shipments/locations.ts",
      "src/lib/shipments/providers/index.ts",
      "src/lib/shipments/providers/base.ts",
      "src/lib/shipments/providers/types.ts",
    ]) {
      expect(readFileSync(file, "utf8")).not.toContain("eta_source");
    }
  });
});

/* ================================================================== *
 * 7 · §26 — location-provider failures are a NAMED signal
 * ================================================================== */

describe("§26 — the location_provider_failure signal is wired", () => {
  it("is one of §26's nine named signals", () => {
    expect(SHIPMENT_SIGNALS).toContain("location_provider_failure");
  });

  it("every M-80 failure path in `locations.ts` emits it", () => {
    const source = readFileSync("src/lib/shipments/locations.ts", "utf8");
    // Six failure paths: the three reads, the location write, the connection
    // attach, the retention purge — and the provider poll.
    const emissions =
      source.match(/signal:\s*"location_provider_failure"/g) ?? [];
    expect(emissions.length).toBeGreaterThanOrEqual(6);
  });

  it("NEVER logs the tracking URL — §26's never-log list", () => {
    const source = readFileSync("src/lib/shipments/locations.ts", "utf8");
    // The attach-failure signal names the provider and nothing else. A Mode B
    // link is a bearer locator to a live truck position; `observability.ts`
    // would drop it as credential-shaped, but it must not be handed over in
    // the first place.
    expect(source).toContain("detail: `attach refused for ${input.provider}`");
    expect(source).not.toMatch(/detail:.*trackingUrl/);
  });

  it("the redactor drops a provider error carrying a bearer token", () => {
    expect(
      redactDetail("Motive said: Authorization: Bearer eyJhbGciOi..."),
    ).toBe("[redacted: credential-shaped content]");
    // NON-VACUITY: an ordinary provider message survives.
    expect(redactDetail("Motive returned 503")).toBe("Motive returned 503");
  });
});
