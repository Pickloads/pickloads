import type { TrackingProvider } from "@/lib/shipments/types";
import {
  providerFailure,
  type EtaInputs,
  type NormalizedReading,
  type ProviderResult,
  type TrackingProviderAdapter,
} from "@/lib/shipments/providers/types";

/**
 * M-80 — the honest "no connection" half of every named adapter.
 *
 * ── WHY EVERY ADAPTER REFUSES, AND WHY THAT IS THE DELIVERABLE ───────────
 *
 * §9: *"Do not implement a fake connection."* §30: *"Do not display fake GPS
 * positions."* PickLoads holds no Motive, Samsara, Geotab or Verizon Connect
 * contract, no API credentials and no ELD consent from any carrier. An
 * adapter that returned plausible coordinates would violate both sentences at
 * once, and an adapter that quietly returned `null` would violate them more
 * subtly: the surfaces would show "no data" rather than "not connected", and
 * nobody would ever notice the integration had never been built.
 *
 * So the refusal is EXPLICIT and it is TYPED:
 *
 *   * no credentials in the environment → `not_configured`, naming the exact
 *     variables a future implementer must set;
 *   * credentials present but no transport → `not_implemented`, which is the
 *     honest answer for this module and the state that tells an operator the
 *     integration is half-done rather than misbehaving.
 *
 * The second branch matters. Setting `MOTIVE_API_KEY` in Vercel does not make
 * tracking work, and a system that silently pretended otherwise would be a
 * trap laid for whoever ships M-80's successor.
 *
 * ── WHAT IS REAL HERE ────────────────────────────────────────────────────
 *
 * `isConfigured()`, `requiredEnvVars`, `normalize()` and `dedupeKey()`.
 * Normalisation is per-provider and implemented against each vendor's
 * documented payload shape, which is the piece that makes the interface load
 * bearing: when a transport is added, the shipment system consumes exactly
 * what it consumes today.
 */

export interface AdapterConfig {
  provider: TrackingProvider;
  displayName: string;
  requiredEnvVars: readonly string[];
  normalize(payload: unknown): ProviderResult<NormalizedReading>;
}

/** §15: credentials come from the environment, never from a database column. */
export function envConfigured(vars: readonly string[]): boolean {
  if (vars.length === 0) return false;
  return vars.every((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.trim() !== "";
  });
}

/**
 * The single refusal every `fetch*` returns, so the four methods cannot drift
 * apart and so a future implementer replaces one function rather than four
 * copies of the same message.
 */
function refuse(config: AdapterConfig) {
  if (!envConfigured(config.requiredEnvVars)) {
    return providerFailure(
      "not_configured",
      `${config.displayName} is not configured. No PickLoads environment sets ${config.requiredEnvVars.join(", ")}, and no telematics contract exists — location tracking is milestone-only.`,
    );
  }
  return providerFailure(
    "not_implemented",
    `${config.displayName} credentials are present but M-80 ships the adapter INTERFACE only — no HTTP transport is implemented, and no fake connection is permitted (DIRECTIVE-tracking §9, §30). Implement fetchCurrentLocation/fetchLastUpdateAt/fetchVehicleSpeed/fetchEtaInputs against ${config.displayName}'s API; normalize() and dedupeKey() already work.`,
  );
}

export function createAdapter(config: AdapterConfig): TrackingProviderAdapter {
  return {
    provider: config.provider,
    displayName: config.displayName,
    requiredEnvVars: config.requiredEnvVars,

    isConfigured(): boolean {
      return envConfigured(config.requiredEnvVars);
    },

    // The `ctx` parameter is declared on the interface and deliberately not
    // destructured here: there is nothing to ask a provider about until a
    // transport exists, and a parameter named-but-ignored is noise.
    async fetchCurrentLocation(): Promise<
      ProviderResult<NormalizedReading | null>
    > {
      return refuse(config);
    },

    async fetchLastUpdateAt(): Promise<ProviderResult<string | null>> {
      return refuse(config);
    },

    async fetchVehicleSpeed(): Promise<ProviderResult<number | null>> {
      return refuse(config);
    },

    async fetchEtaInputs(): Promise<ProviderResult<EtaInputs | null>> {
      return refuse(config);
    },

    normalize(payload: unknown): ProviderResult<NormalizedReading> {
      return config.normalize(payload);
    },

    /**
     * §9 "prevent duplicate events".
     *
     * NAMESPACED BY PROVIDER, because two vendors can and do mint the same
     * opaque id, and 0027's unique index spans `(shipment_id, provider,
     * external_event_id)` — the prefix keeps the stored value self-describing
     * when it is read back on a dispatcher screen.
     *
     * Returns `null` rather than a fabricated key when the provider gave
     * nothing stable: a synthesised key (say, a hash of the coordinates and
     * the time) would silently DROP a genuine second reading that happened to
     * repeat, which is worse than storing a duplicate.
     */
    dedupeKey(reading: NormalizedReading): string | null {
      if (reading.externalEventId === null) return null;
      const trimmed = reading.externalEventId.trim();
      if (trimmed === "") return null;
      const key = `${config.provider}:${trimmed}`;
      // 0027 bounds the column at 200 characters.
      return key.length > 200 ? key.slice(0, 200) : key;
    },
  };
}
