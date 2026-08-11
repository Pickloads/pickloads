import type { TrackingProvider } from "@/lib/shipments/types";
import type { TrackingProviderAdapter } from "@/lib/shipments/providers/types";
import { motiveAdapter } from "@/lib/shipments/providers/motive";
import { samsaraAdapter } from "@/lib/shipments/providers/samsara";
import { geotabAdapter } from "@/lib/shipments/providers/geotab";
import { verizonConnectAdapter } from "@/lib/shipments/providers/verizon-connect";
import { otherProviderAdapter } from "@/lib/shipments/providers/other";

export * from "@/lib/shipments/providers/types";

/**
 * M-80 — the provider registry (§9 Mode C).
 *
 * A FULL `Record<TrackingProvider, …>`, not a lookup with a fallback: adding
 * a sixth value to M-70's `TrackingProvider` enum is then a COMPILE ERROR
 * until an adapter exists for it. That is the same technique M-72 used for
 * its transition graph and M-77 for its document matrix, and it is the reason
 * "adding a provider needs no rewrite of the shipment system" is a checkable
 * claim rather than an aspiration: the compiler names the one file to write.
 *
 * NO PROVIDER IS CONNECTED. Every adapter here refuses every fetch — see
 * `base.ts`. `anyProviderConfigured()` returns false in every PickLoads
 * environment today, and the map surfaces read it to choose §30's honest
 * label rather than guessing from the absence of data.
 */
export const PROVIDER_ADAPTERS: Record<
  TrackingProvider,
  TrackingProviderAdapter
> = {
  motive: motiveAdapter,
  samsara: samsaraAdapter,
  geotab: geotabAdapter,
  verizon_connect: verizonConnectAdapter,
  other: otherProviderAdapter,
};

export function getProviderAdapter(
  provider: TrackingProvider,
): TrackingProviderAdapter {
  return PROVIDER_ADAPTERS[provider];
}

/**
 * True only if some named provider has every one of its credentials present.
 *
 * Read by the dispatcher screen and by `honestLocationLabel` — NOT as a claim
 * that tracking works (it does not: no transport is implemented), but as the
 * difference between "nobody has configured anything" and "credentials exist
 * and the integration is half-built", which are different things to tell an
 * operator.
 */
export function anyProviderConfigured(): boolean {
  return Object.values(PROVIDER_ADAPTERS).some((a) => a.isConfigured());
}

/** The contract table the module doc and the dispatcher screen both render. */
export interface ProviderStatus {
  provider: TrackingProvider;
  displayName: string;
  requiredEnvVars: readonly string[];
  configured: boolean;
  /** Always false in M-80. There is no transport for any provider. */
  connected: false;
}

export function providerStatuses(): ProviderStatus[] {
  return Object.values(PROVIDER_ADAPTERS).map((adapter) => ({
    provider: adapter.provider,
    displayName: adapter.displayName,
    requiredEnvVars: adapter.requiredEnvVars,
    configured: adapter.isConfigured(),
    connected: false as const,
  }));
}
