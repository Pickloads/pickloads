/**
 * M-93 Phase 2 — the carrier authority provider interface.
 *
 * Plain module (no `server-only`): the normalized model and its types are
 * imported by the risk engine and by tests. The ADAPTERS are server-only —
 * they hold the credential.
 *
 * ── WHY AN INTERFACE ─────────────────────────────────────────────────────
 *
 * FMCSA QCMobile is the source today. It has a documented history of outages,
 * it does not expose insurance data, and a commercial reseller may later be
 * necessary for the fields it lacks. Onboarding must not have to be rebuilt
 * when that happens, so nothing above this file knows the provider's name.
 */

/**
 * Outcome of an authority lookup.
 *
 * `provider_unavailable` is a first-class result, not an exception. Phase 20:
 * FMCSA being unreachable must never collapse into VERIFIED (dangerous) or
 * NOT_VERIFIED (defames a legitimate carrier for our outage).
 */
export type AuthorityLookupStatus =
  "found" | "not_found" | "provider_unavailable" | "not_configured";

/**
 * The normalized carrier record.
 *
 * Every field is nullable because every field is genuinely optional in the
 * upstream response, and a default here would be an invention. `null` means
 * "the authority did not tell us", never "no" — the risk engine distinguishes
 * the two and it can only do that if this model does.
 */
export interface NormalizedAuthorityRecord {
  /** The authority's own identifier — USDOT as returned. */
  providerRecordId: string | null;
  legalName: string | null;
  dbaName: string | null;
  usdotNumber: string | null;
  mcNumber: string | null;
  /** FMCSA `allowToOperate` — Y/N mapped to boolean, null when absent. */
  allowedToOperate: boolean | null;
  /** FMCSA `outOfService`. */
  outOfService: boolean | null;
  /** ISO date (YYYY-MM-DD), null when not out of service or not reported. */
  outOfServiceDate: string | null;
  /**
   * The provider's own freshness stamp, distinct from when we asked.
   * QCMobile returns `retrievalDate`.
   */
  sourceRetrievedAt: string | null;
  /**
   * SHA-256 of the raw response body.
   *
   * The raw payload is deliberately NOT retained (Phase 2: "do NOT store an
   * unrestricted raw provider payload"; Phase 21: data minimisation). A digest
   * still proves two checks saw the same upstream record and cannot leak an
   * address or a phone number we never decided to keep.
   */
  rawResponseSha256: string | null;
}

export type AuthorityLookupResult =
  | { status: "found"; record: NormalizedAuthorityRecord }
  | { status: "not_found" }
  | { status: "provider_unavailable"; reason: string }
  | { status: "not_configured" };

export interface CarrierAuthorityProvider {
  /** Stable identifier stored on `carrier_verifications.provider`. */
  readonly name: string;
  /** False when the credential is absent — callers must not treat this as a failure. */
  isConfigured(): boolean;
  lookupByUsdot(usdot: string): Promise<AuthorityLookupResult>;
  lookupByDocket(docket: string): Promise<AuthorityLookupResult>;
}

/* ── Normalisation helpers, shared by adapters and tests ────────────────── */

/**
 * Digits only.
 *
 * USDOT and MC numbers arrive as "MC-123456", "mc 123456", "0123456". They are
 * the same number. Leading zeros are stripped because FMCSA returns the
 * integer form, and a string compare of "0123456" against "123456" would
 * report a mismatch on two identical registrations.
 */
export function normalizeRegistrationNumber(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "").replace(/^0+/, "");
  return digits === "" ? null : digits;
}

/** FMCSA's Y/N strings. Anything else is "not told", i.e. null. */
export function yesNoToBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (v === "Y" || v === "YES" || v === "TRUE") return true;
  if (v === "N" || v === "NO" || v === "FALSE") return false;
  return null;
}

/** MM/DD/YYYY (FMCSA) → YYYY-MM-DD. Returns null on anything unparseable. */
export function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}
