import "server-only";

import { createHash } from "node:crypto";
import {
  normalizeRegistrationNumber,
  toIsoDate,
  yesNoToBoolean,
  type AuthorityLookupResult,
  type CarrierAuthorityProvider,
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
 * ── WHAT THIS SOURCE DOES NOT PROVIDE ────────────────────────────────────
 *
 * Insurance and filing status. Those live in FMCSA's separate L&I system,
 * which has no equivalent public JSON API. There is deliberately no insurance
 * field in the normalized model: owner decision (2026-08-15) is that FMCSA
 * insurance status reads NOT AVAILABLE and PickLoads insurance requirements
 * are judged from the uploaded COI and `carriers.insurance_expiry` alone.
 * Phase 14 requires the two be shown independently; the cleanest way to
 * guarantee that is for this adapter to have nothing to say about insurance.
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
function extractCarrier(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  const content = (body as { content?: unknown }).content;
  if (typeof content !== "object" || content === null) return null;

  // Single lookup: { content: { carrier: {...} } }
  const carrier = (content as { carrier?: unknown }).carrier;
  if (typeof carrier === "object" && carrier !== null) {
    return carrier as Record<string, unknown>;
  }
  // Docket lookup returns a list; take the first entry.
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (typeof first === "object" && first !== null) {
      const nested = (first as { carrier?: unknown }).carrier;
      if (typeof nested === "object" && nested !== null) {
        return nested as Record<string, unknown>;
      }
      return first as Record<string, unknown>;
    }
  }
  return null;
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

  return {
    providerRecordId: dot,
    legalName: str(carrier.legalName),
    dbaName: str(carrier.dbaName),
    usdotNumber: dot,
    mcNumber: normalizeRegistrationNumber(
      str(carrier.mcNumber) ?? String(carrier.mcNumber ?? ""),
    ),
    allowedToOperate: yesNoToBoolean(carrier.allowToOperate),
    outOfService: yesNoToBoolean(carrier.outOfService),
    outOfServiceDate: toIsoDate(carrier.outOfServiceDate),
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

  const carrier = extractCarrier(body);
  if (!carrier) {
    // Well-formed response, no carrier in it → genuinely not found.
    if (res.ok || res.status === 404) return { status: "not_found" };
    return { status: "provider_unavailable", reason: `http_${res.status}` };
  }

  const retrievalDate =
    typeof body === "object" && body !== null
      ? (body as { retrievalDate?: unknown }).retrievalDate
      : null;

  return {
    status: "found",
    record: normalize(carrier, rawBody, retrievalDate),
  };
}

export const fmcsaQcMobileProvider: CarrierAuthorityProvider = {
  name: "fmcsa_qcmobile",

  isConfigured(): boolean {
    return Boolean(process.env.FMCSA_WEBKEY);
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
