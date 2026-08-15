import "server-only";

import { createHash } from "node:crypto";
import {
  normalizeAuthorityStatus,
  normalizeRegistrationNumber,
  toIsoDate,
  toNumberOrNull,
  toStringOrNull,
  yesNoToBoolean,
  type AuthorityLookupResult,
  type CarrierAuthorityProvider,
  type DocketLookupResult,
  type FmcsaInsuranceIndicators,
  type FmcsaSafetyIndicators,
  type NormalizedAuthorityRecord,
} from "./provider";

/**
 * M-93 Phase 2 — FMCSA QCMobile adapter.
 *
 * The agency's own service, not a reseller.
 *
 *   Base:  https://mobile.fmcsa.dot.gov/qc/services/
 *   Auth:  `webKey` query parameter (Login.gov-backed developer account)
 *   Docs:  https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi
 *          https://mobile.fmcsa.dot.gov/QCDevsite/docs/apiElements
 *
 * Verified live on 2026-08-15 rather than taken from documentation — an
 * unauthenticated probe returns `{"content":"Webkey not found", …}` with a
 * current `retrievalDate`, which proves the host, the path shape and that
 * auth is enforced.
 *
 * ── CORRECTION (2026-08-15, from the live response) ──────────────────────
 *
 * This file previously stated that QCMobile exposes no insurance data, on the
 * strength of FMCSA's published element list. **That was wrong.** The live
 * response carries `bipdInsuranceOnFile`, `bipdInsuranceRequired`,
 * `bipdRequiredAmount`, `cargoInsuranceOnFile`, `cargoInsuranceRequired`,
 * `bondInsuranceOnFile` and `bondInsuranceRequired`. The documented element
 * list is incomplete; the API returns more than it advertises.
 *
 * They are normalized, and they are labelled `insurance` under a type whose
 * name says FMCSA — because what they describe is a FEDERAL FILING, not
 * PickLoads compliance. Phase 14's separation is unchanged and now has to be
 * held deliberately rather than by the accident of having no data:
 *
 *   FMCSA filing on file   ≠   PickLoads insurance requirements met
 *
 * PickLoads compliance is still judged from the uploaded COI and
 * `carriers.insurance_expiry`. Nothing in the risk engine reads an FMCSA
 * insurance indicator as a PASS.
 *
 * ── WHAT IS DROPPED AT THIS BOUNDARY ─────────────────────────────────────
 *
 * `ein` and the full physical address. Both are in the live response; neither
 * is in the normalized model, so nothing downstream can persist or log them.
 *
 * ── FAILURE IS NEVER A VERDICT ───────────────────────────────────────────
 *
 * Timeout, 5xx, malformed JSON and an unset credential all resolve to
 * `provider_unavailable` / `not_configured`. None of them is `not_found`, and
 * none can become "verified". A carrier must never be refused because our
 * dependency was down.
 */

const BASE_URL = "https://mobile.fmcsa.dot.gov/qc/services";

/**
 * Hard ceiling on the upstream call.
 *
 * QCMobile has a public history of outages. Without a timeout a stalled
 * connection would hold a server action open until the platform killed it,
 * turning their outage into our outage.
 */
const TIMEOUT_MS = 8_000;

/** Refuse absurd bodies before parsing. */
const MAX_BODY_BYTES = 512 * 1024;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * QCMobile wraps carrier data as `{ content: { carrier: {...} } }` on success
 * and `{ content: "Webkey not found" }` on an auth failure — the same key with
 * two different shapes. Both are handled explicitly; anything else is treated
 * as unavailable rather than guessed at.
 */
function looksLikeCarrier(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return "dotNumber" in o || "legalName" in o;
}

/**
 * Three outcomes, because two of them used to be one.
 *
 * `absent` and `unrecognized` are both "we did not get a carrier", and
 * collapsing them into `not_found` is precisely the bug this type exists to
 * make impossible: an envelope we fail to parse would tell a real, operating
 * carrier that FMCSA has no record of them.
 */
export type CarrierExtraction =
  | { kind: "carrier"; carrier: Record<string, unknown> }
  /** FMCSA affirmatively returned nothing: null, empty array, empty object. */
  | { kind: "absent" }
  /** Content was present and non-trivial, and we could not understand it. */
  | { kind: "unrecognized" };

/** True when `content` carries no information at all. */
function isEmptyContent(content: unknown): boolean {
  if (content === null || content === undefined) return true;
  if (typeof content === "string") return content.trim() === "";
  if (Array.isArray(content)) return content.length === 0;
  if (typeof content === "object") {
    return Object.keys(content as Record<string, unknown>).length === 0;
  }
  return false;
}

/**
 * Classify a QCMobile response.
 *
 * ── WHY THIS IS DEFENSIVE RATHER THAN EXACT ──────────────────────────────
 *
 * FMCSA's developer site lists the response ELEMENTS and publishes no example
 * ENVELOPE for `/carriers/{dotNumber}`. The first version of this function was
 * therefore written against an assumed shape (`content.carrier`) and returned
 * `Record | null` — so a wrong assumption produced `not_found`, which is
 * indistinguishable from a carrier that genuinely does not exist. Nobody would
 * ever have found out.
 *
 * Two changes fix that. Position is no longer the test — `looksLikeCarrier`
 * is, so a carrier is recognised wherever FMCSA chooses to put it. And "we
 * could not read this" is now its own outcome rather than being folded into
 * "there is nothing here", so it can fail safe and be logged.
 *
 * `scripts/fmcsa-shape-check.mjs` reports which branch a live response takes.
 */
export function extractCarrier(body: unknown): CarrierExtraction {
  // Not even an object. We asked for JSON and got something else entirely —
  // that is a broken response, not a statement that the carrier is unknown.
  if (typeof body !== "object" || body === null)
    return { kind: "unrecognized" };

  const content = (body as { content?: unknown }).content;

  // FMCSA affirmatively said "nothing here". This is the ONLY path to
  // `not_found`, and it requires the provider to have actually said so.
  if (isEmptyContent(content)) return { kind: "absent" };

  // A non-empty string. `{"content":"Webkey not found"}` is caught upstream;
  // anything else is a message we do not understand, not an absence.
  if (typeof content === "string") return { kind: "unrecognized" };

  // { content: [ … ] } — the docket lookup, and possibly the DOT lookup.
  if (Array.isArray(content)) {
    for (const entry of content) {
      if (typeof entry !== "object" || entry === null) continue;
      const nested = (entry as { carrier?: unknown }).carrier;
      if (looksLikeCarrier(nested)) return { kind: "carrier", carrier: nested };
      if (looksLikeCarrier(entry)) return { kind: "carrier", carrier: entry };
    }
    // A populated array with nothing carrier-shaped in it. We were handed
    // something and did not understand it.
    return { kind: "unrecognized" };
  }

  if (typeof content !== "object") return { kind: "unrecognized" };

  // { content: { carrier: {...} } }
  const carrier = (content as { carrier?: unknown }).carrier;
  if (looksLikeCarrier(carrier)) return { kind: "carrier", carrier };

  // { content: {...carrier fields inline...} } — the shape the original
  // implementation did not handle.
  if (looksLikeCarrier(content)) {
    return { kind: "carrier", carrier: content as Record<string, unknown> };
  }

  // A populated object with no carrier anywhere in it. This includes the
  // malformed case — `{ content: { carrier: {} } }`, where the key exists but
  // the object carries neither dotNumber nor legalName.
  return { kind: "unrecognized" };
}

/**
 * Read a field under any of its observed spellings.
 *
 * QCMobile is not consistent across endpoints — the same fact appears as
 * `allowToOperate` on the carrier record and `allowedToOperate` elsewhere.
 * Checking one spelling and getting `undefined` would normalise to `null`,
 * which reads as "FMCSA did not say" when in fact it did.
 */
function firstPresent(
  source: Record<string, unknown>,
  ...names: string[]
): unknown {
  for (const n of names) {
    if (n in source && source[n] !== null && source[n] !== undefined) {
      return source[n];
    }
  }
  return undefined;
}

function normalize(
  carrier: Record<string, unknown>,
  rawBody: string,
  retrievalDate: unknown,
): NormalizedAuthorityRecord {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  const dot = normalizeRegistrationNumber(
    str(carrier.dotNumber) ?? String(carrier.dotNumber ?? ""),
  );

  // ── FIELDS DELIBERATELY NOT CARRIED ACROSS ─────────────────────────────
  //
  // The live response contains `ein` and the full physical address
  // (`phyStreet`, `phyCity`, `phyState`, `phyZip`) plus `telephone`. None of
  // them appears in the normalized model and none is persisted.
  //
  // EIN is a tax identifier. We already encrypt the one the carrier gives us
  // (`carriers.ein`, AES-256-GCM); silently accumulating a second plaintext
  // copy from a lookup — one nobody asked for and no decision uses — is how a
  // breach gets worse for no benefit. The address is not needed for any rule
  // in the risk engine either. Both are dropped here, at the boundary, so no
  // downstream code can persist what it never receives.

  const insurance: FmcsaInsuranceIndicators = {
    bipdOnFile: toStringOrNull(firstPresent(carrier, "bipdInsuranceOnFile")),
    bipdRequired: toStringOrNull(
      firstPresent(carrier, "bipdInsuranceRequired"),
    ),
    bipdRequiredAmount: toStringOrNull(
      firstPresent(carrier, "bipdRequiredAmount"),
    ),
    cargoOnFile: toStringOrNull(firstPresent(carrier, "cargoInsuranceOnFile")),
    cargoRequired: toStringOrNull(
      firstPresent(carrier, "cargoInsuranceRequired"),
    ),
    bondOnFile: toStringOrNull(firstPresent(carrier, "bondInsuranceOnFile")),
    bondRequired: toStringOrNull(
      firstPresent(carrier, "bondInsuranceRequired"),
    ),
  };
  const hasInsurance = Object.values(insurance).some((v) => v !== null);

  const safety: FmcsaSafetyIndicators = {
    rating: toStringOrNull(firstPresent(carrier, "safetyRating")),
    ratingDate: toIsoDate(firstPresent(carrier, "safetyRatingDate")),
    crashTotal: toNumberOrNull(firstPresent(carrier, "crashTotal")),
    vehicleOosRate: toNumberOrNull(firstPresent(carrier, "vehicleOosRate")),
    driverOosRate: toNumberOrNull(firstPresent(carrier, "driverOosRate")),
  };
  const hasSafety = Object.values(safety).some((v) => v !== null);

  return {
    providerRecordId: dot,
    legalName: str(carrier.legalName),
    dbaName: str(carrier.dbaName),
    usdotNumber: dot,
    mcNumber: normalizeRegistrationNumber(
      str(carrier.mcNumber) ?? String(carrier.mcNumber ?? ""),
    ),
    // Not retrieved by this call. `lookupDocketNumbers` fills it, and null
    // keeps "we did not ask" distinct from "there are none".
    docketNumbers: null,
    // Both spellings observed across endpoints.
    allowedToOperate: yesNoToBoolean(
      firstPresent(carrier, "allowToOperate", "allowedToOperate"),
    ),
    statusCode: toStringOrNull(firstPresent(carrier, "statusCode")),
    outOfService: yesNoToBoolean(firstPresent(carrier, "outOfService")),
    outOfServiceDate: toIsoDate(
      firstPresent(carrier, "outOfServiceDate", "oosDate"),
    ),
    commonAuthority: normalizeAuthorityStatus(
      firstPresent(carrier, "commonAuthorityStatus"),
    ),
    contractAuthority: normalizeAuthorityStatus(
      firstPresent(carrier, "contractAuthorityStatus"),
    ),
    brokerAuthority: normalizeAuthorityStatus(
      firstPresent(carrier, "brokerAuthorityStatus"),
    ),
    // null rather than an all-null object: "the response carried none of
    // these fields" is different from "it carried them and they were empty".
    insurance: hasInsurance ? insurance : null,
    safety: hasSafety ? safety : null,
    sourceRetrievedAt: typeof retrievalDate === "string" ? retrievalDate : null,
    rawResponseSha256: sha256(rawBody),
  };
}

async function request(path: string): Promise<AuthorityLookupResult> {
  const webKey = process.env.FMCSA_WEBKEY;
  if (!webKey) return { status: "not_configured" };

  const url = `${BASE_URL}${path}?webKey=${encodeURIComponent(webKey)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    // Timeout, DNS, TLS, connection reset — all the same to a caller.
    const reason = err instanceof Error ? err.name : "network_error";
    console.error(`[fmcsa] request failed: ${reason}`);
    return { status: "provider_unavailable", reason };
  }

  // 404 from this API is ambiguous — it is returned both for "no such carrier"
  // and for "webkey not found". They are distinguished by the body, because
  // treating a rejected credential as "this carrier does not exist" would
  // fail every applicant the moment a key expired.
  const rawBody = await res.text().catch(() => "");
  if (rawBody.length > MAX_BODY_BYTES) {
    return { status: "provider_unavailable", reason: "body_too_large" };
  }

  if (/webkey not found/i.test(rawBody)) {
    console.error("[fmcsa] FMCSA_WEBKEY was rejected by the provider");
    return { status: "provider_unavailable", reason: "credential_rejected" };
  }

  if (res.status === 429) {
    return { status: "provider_unavailable", reason: "rate_limited" };
  }
  if (res.status >= 500) {
    return { status: "provider_unavailable", reason: `http_${res.status}` };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // A malformed body is an outage, not a verdict.
    return { status: "provider_unavailable", reason: "malformed_json" };
  }

  const extraction = extractCarrier(body);

  if (extraction.kind === "unrecognized") {
    // ── NEVER not_found ────────────────────────────────────────────────────
    //
    // FMCSA handed us something and we could not read it. That says nothing
    // about whether the carrier exists, so reporting `not_found` would tell a
    // real, operating carrier that the federal register has no record of them
    // — on the strength of OUR parser being wrong.
    //
    // It is an outage of comprehension, and it fails the same way every other
    // outage does: provider_unavailable → MANUAL_REVIEW → a human looks.
    //
    // Logged with enough to diagnose the envelope and nothing more. Top-level
    // KEYS only — never the body, never a field value, never the URL (it
    // carries the credential).
    console.error(
      JSON.stringify({
        event: "fmcsa.unrecognized_envelope",
        provider: "fmcsa_qcmobile",
        httpStatus: res.status,
        topLevelKeys:
          typeof body === "object" && body !== null
            ? Object.keys(body as Record<string, unknown>).sort()
            : [],
        reason: "unrecognized_envelope",
        at: new Date().toISOString(),
      }),
    );
    return { status: "provider_unavailable", reason: "unrecognized_envelope" };
  }

  if (extraction.kind === "absent") {
    // FMCSA affirmatively returned nothing. This is the only path to
    // not_found, and it requires the provider to have actually said so.
    if (res.ok || res.status === 404) return { status: "not_found" };
    return { status: "provider_unavailable", reason: `http_${res.status}` };
  }

  const retrievalDate =
    typeof body === "object" && body !== null
      ? (body as { retrievalDate?: unknown }).retrievalDate
      : null;

  return {
    status: "found",
    record: normalize(extraction.carrier, rawBody, retrievalDate),
  };
}

/**
 * Every docket number FMCSA associates with a USDOT.
 *
 * GET /carriers/{dotNumber}/docket-numbers
 *
 * ── WHY THIS IS A SEPARATE CALL ──────────────────────────────────────────
 *
 * The carrier record carries at most ONE `mcNumber`, and a carrier may hold
 * several dockets. Verifying a submitted MC against that single field would
 * reject a legitimate carrier whose second docket is the one they gave us —
 * and, worse, would pass a submitted MC that happens to equal the one field
 * while belonging to a different registration.
 *
 * A failure here is `provider_unavailable`, never an empty list. "We could not
 * check" and "they have no dockets" are different findings and only one of
 * them is about the carrier.
 */
async function fetchDocketNumbers(usdot: string): Promise<DocketLookupResult> {
  const webKey = process.env.FMCSA_WEBKEY;
  if (!webKey) return { status: "not_configured" };

  const n = normalizeRegistrationNumber(usdot);
  if (!n) return { status: "not_found" };

  let res: Response;
  try {
    res = await fetch(
      `${BASE_URL}/carriers/${encodeURIComponent(n)}/docket-numbers?webKey=${encodeURIComponent(webKey)}`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "application/json" },
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.name : "network_error";
    console.error(`[fmcsa] docket request failed: ${reason}`);
    return { status: "provider_unavailable", reason };
  }

  const rawBody = await res.text().catch(() => "");
  if (rawBody.length > MAX_BODY_BYTES) {
    return { status: "provider_unavailable", reason: "body_too_large" };
  }
  if (/webkey not found/i.test(rawBody)) {
    console.error("[fmcsa] FMCSA_WEBKEY was rejected by the provider");
    return { status: "provider_unavailable", reason: "credential_rejected" };
  }
  if (res.status === 429) {
    return { status: "provider_unavailable", reason: "rate_limited" };
  }
  if (res.status >= 500) {
    return { status: "provider_unavailable", reason: `http_${res.status}` };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: "provider_unavailable", reason: "malformed_json" };
  }

  const content =
    typeof body === "object" && body !== null
      ? (body as { content?: unknown }).content
      : undefined;

  // Affirmatively nothing. A carrier can legitimately hold no docket (an
  // intrastate or exempt operation), so this is a real answer, not a failure.
  if (content === null || content === undefined) {
    return { status: "found", docketNumbers: [] };
  }
  if (!Array.isArray(content)) {
    // Populated and unreadable — same doctrine as the carrier envelope.
    return { status: "provider_unavailable", reason: "unrecognized_envelope" };
  }

  const numbers: string[] = [];
  for (const entry of content) {
    if (typeof entry === "string" || typeof entry === "number") {
      const v = normalizeRegistrationNumber(String(entry));
      if (v) numbers.push(v);
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const o = entry as Record<string, unknown>;
    // Observed spellings; also handles a nested { docketNumber: … } wrapper.
    const raw =
      o.docketNumber ?? o.docket_number ?? o.docket ?? o.mcNumber ?? null;
    const v = normalizeRegistrationNumber(
      raw === null || raw === undefined ? null : String(raw),
    );
    if (v) numbers.push(v);
  }

  return { status: "found", docketNumbers: [...new Set(numbers)] };
}

export const fmcsaQcMobileProvider: CarrierAuthorityProvider = {
  name: "fmcsa_qcmobile",

  isConfigured(): boolean {
    return Boolean(process.env.FMCSA_WEBKEY);
  },

  lookupDocketNumbers(usdot: string): Promise<DocketLookupResult> {
    return fetchDocketNumbers(usdot);
  },

  async lookupByUsdot(usdot: string): Promise<AuthorityLookupResult> {
    const n = normalizeRegistrationNumber(usdot);
    if (!n) return { status: "not_found" };
    return request(`/carriers/${encodeURIComponent(n)}`);
  },

  async lookupByDocket(docket: string): Promise<AuthorityLookupResult> {
    const n = normalizeRegistrationNumber(docket);
    if (!n) return { status: "not_found" };
    return request(`/carriers/docket-number/${encodeURIComponent(n)}`);
  },
};
