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
/**
 * A single FMCSA authority grant.
 *
 * `null` is "the response did not say", which is NOT "none". Conflating them
 * would let a missing field read as an absent authority and refuse a carrier
 * for a gap in the data rather than a gap in their registration.
 */
export type AuthorityStatus = "active" | "inactive" | "none" | null;

/**
 * FMCSA FILING indicators. **Not** PickLoads insurance compliance.
 *
 * These say what is on file with the federal government. They say nothing
 * about whether the carrier meets PickLoads' commercial requirements, which
 * are judged from the uploaded COI and `carriers.insurance_expiry`. Phase 14
 * requires the two be shown independently and never merged, which is why they
 * live in their own shape with their own name.
 *
 * Every value stays a STRING as reported. FMCSA uses these fields
 * inconsistently — some accounts see `Y`/`N`, others a dollar figure in
 * thousands — and inventing a boolean from a value we have not verified is
 * exactly the inference this module is not allowed to make. Callers that need
 * a yes/no use `yesNoToBoolean`, which returns null when the value is not one.
 */
export interface FmcsaInsuranceIndicators {
  bipdOnFile: string | null;
  bipdRequired: string | null;
  bipdRequiredAmount: string | null;
  cargoOnFile: string | null;
  cargoRequired: string | null;
  bondOnFile: string | null;
  bondRequired: string | null;
}

/** Safety signals as reported. No PickLoads score is derived from these. */
export interface FmcsaSafetyIndicators {
  /** e.g. "S" (satisfactory), "C" (conditional), "U" (unsatisfactory). */
  rating: string | null;
  ratingDate: string | null;
  crashTotal: number | null;
  vehicleOosRate: number | null;
  driverOosRate: number | null;
}

export interface NormalizedAuthorityRecord {
  /** The authority's own identifier — USDOT as returned. */
  providerRecordId: string | null;
  legalName: string | null;
  dbaName: string | null;
  usdotNumber: string | null;
  /**
   * The MC on the carrier record, when the response carries one.
   *
   * NOT sufficient to verify a submitted MC: a carrier may hold several
   * dockets, and this field shows at most one. `docketNumbers` is the
   * authoritative set — see `lookupDocketNumbers`.
   */
  mcNumber: string | null;
  /**
   * Every docket (MC/FF/MX) number FMCSA associates with this USDOT.
   *
   * `null` means "not retrieved" — the docket endpoint was not called or
   * failed. An empty ARRAY means "retrieved, and there are none". The
   * difference decides between MANUAL_REVIEW and a real finding, so the two
   * are never collapsed.
   */
  docketNumbers: string[] | null;
  /** FMCSA `allowToOperate` — Y/N mapped to boolean, null when absent. */
  allowedToOperate: boolean | null;
  /**
   * FMCSA `statusCode`. Reported verbatim (typically "A" or "I") rather than
   * interpreted: the code set is not fully documented and guessing at an
   * undocumented value is how a live carrier gets refused.
   */
  statusCode: string | null;
  /** FMCSA `outOfService`. */
  outOfService: boolean | null;
  /** ISO date (YYYY-MM-DD), null when not out of service or not reported. */
  outOfServiceDate: string | null;
  /**
   * Authority grants, kept SEPARATE.
   *
   * Broker authority is not carrier authority. A broker-only entity holds
   * `broker: "active"` and no common or contract grant, and treating that as
   * permission to haul freight would onboard a company that cannot legally
   * carry a load.
   */
  commonAuthority: AuthorityStatus;
  contractAuthority: AuthorityStatus;
  brokerAuthority: AuthorityStatus;
  /** FMCSA filing indicators — never PickLoads COI compliance. */
  insurance: FmcsaInsuranceIndicators | null;
  safety: FmcsaSafetyIndicators | null;
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

/**
 * Docket lookup, kept separate from the carrier lookup.
 *
 * `not_retrieved` exists because a failed docket call must not read as "this
 * carrier has no dockets". One is a gap in our data; the other is a finding
 * against the carrier.
 */
export type DocketLookupResult =
  | { status: "found"; docketNumbers: string[] }
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
  /**
   * Every docket number FMCSA associates with a USDOT.
   *
   * Required to answer "does the submitted MC actually belong to the submitted
   * USDOT?" — the carrier record carries at most one MC, and a carrier may
   * hold several.
   */
  lookupDocketNumbers(usdot: string): Promise<DocketLookupResult>;
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

/**
 * FMCSA authority-status token → our three states.
 *
 * Accepts the letter codes and the spelled-out forms, because the same field
 * appears both ways across QCMobile endpoints. **Anything unrecognised
 * returns null**, never "none": an unknown token is a gap in our mapping, and
 * treating it as an absent authority would refuse a carrier over our own
 * incompleteness.
 */
export function normalizeAuthorityStatus(raw: unknown): AuthorityStatus {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (v === "") return null;
  if (v === "A" || v === "ACTIVE") return "active";
  if (v === "I" || v === "INACTIVE") return "inactive";
  if (v === "N" || v === "NONE" || v === "NOT AUTHORIZED") return "none";
  return null;
}

/**
 * A number FMCSA reported, or null.
 *
 * Empty strings, non-numerics and NaN all become null. `0` is preserved — a
 * carrier with zero crashes is a fact, and coercing it to null would lose it.
 */
export function toNumberOrNull(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** A reported string, trimmed, or null when absent/blank. */
export function toStringOrNull(raw: unknown): string | null {
  if (typeof raw === "number") return String(raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
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
