import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * M-73 — the §4 SECONDARY VERIFICATION credential.
 *
 * `docs/DIRECTIVE-tracking.md` §4: a public tracking visitor enters "tracking
 * number" AND "secure access code, recipient ZIP or another secondary
 * verification value", and the directive is explicit that tracking by shipment
 * number alone is not allowed. §5 says the same thing from the other side: a
 * `PL-YYYY-######` number is an IDENTIFIER, and "non-sequential public
 * guessing should be mitigated with secure secondary verification" — the
 * number is not the secret, this value is.
 *
 * M-71 stores `shipments.public_access_hash` and M-70's DTO layer serializes
 * it for NO audience, staff included. This module owns the two operations
 * around it: producing the hash (M-75's dispatcher surface, when it sets a
 * code) and verifying a submitted value against it (the /track lookup).
 *
 * ── WHY HMAC AND NOT A PLAIN DIGEST ───────────────────────────────────────
 *
 * The credential space is TINY. A US recipient ZIP has ~41 000 live values; a
 * short access code is not much better. `sha256(zip)` is therefore a lookup
 * table an attacker builds in under a second, so a leaked database dump would
 * hand over every shipment's second factor — which is to say, all of them,
 * since the first factor is a 14-character identifier printed on paperwork.
 *
 * HMAC-SHA-256 under a key held in the ENVIRONMENT (`TRACKING_ACCESS_SECRET`)
 * removes that: a dump without the key is not brute-forceable, because the
 * attacker cannot compute a candidate digest at all. This is the same
 * reasoning `src/lib/crypto.ts` applies to `carriers.ein` — the difference is
 * that a ZIP must be *comparable* rather than recoverable, so a keyed one-way
 * function is the right primitive where AES-GCM is the right one there.
 *
 * A per-row salt would be marginally better still, and is deliberately NOT
 * used: it would need a second column on `shipments`, and M-71's schema is
 * shipped. The env key already defeats the precomputation attack that matters,
 * and a rotation path exists (see `TRACKING_ACCESS_HASH_VERSION` below).
 *
 * ── FAIL CLOSED ───────────────────────────────────────────────────────────
 *
 * Most of this repo degrades gracefully without secrets (M-14's idiom: warn,
 * skip, keep the form walkable). This module does the OPPOSITE and returns
 * `false` when the key is unset, because "we cannot verify the credential" and
 * "the credential is correct" are not the same sentence. A secretless preview
 * environment therefore refuses every lookup — which is honest, and which is
 * also harmless, since a secretless environment has no service-role key and
 * hence no shipments to look up.
 */

/**
 * Stored-hash format prefix. Rotation path, stated so it exists before it is
 * needed: a `v2:` writer lands alongside a verifier that accepts both, live
 * traffic re-hashes on successful verify, and `v1:` support is dropped in a
 * later release. Nothing about the column type changes.
 */
export const TRACKING_ACCESS_HASH_VERSION = "v1";

/** Hex length of an HMAC-SHA-256 digest — 32 bytes. */
const DIGEST_HEX_LENGTH = 64;

/**
 * A stable, well-formed hash of a value that no shipment uses.
 *
 * The "no such tracking number" branch of a lookup compares the submitted
 * value against THIS instead of skipping the comparison, so that branch
 * performs the identical HMAC + `timingSafeEqual` work as the "wrong secondary
 * value" branch. §19 requires enumeration to be prevented, and a lookup that
 * returns 3 ms faster when the number is unknown is an enumeration oracle
 * regardless of what the response body says.
 *
 * Generated once per process from the CSPRNG rather than hard-coded: a
 * constant in source is a value an attacker can submit to detect the decoy
 * path (it would be the one input that "matches" a non-existent shipment,
 * which is only observable if it is guessable).
 */
const DECOY_DIGEST = randomBytes(32).toString("hex");
export const DECOY_ACCESS_HASH = `${TRACKING_ACCESS_HASH_VERSION}:${DECOY_DIGEST}`;

function secret(): string | null {
  const value = process.env.TRACKING_ACCESS_SECRET;
  return value && value.trim() !== "" ? value : null;
}

/** True when this environment can verify a secondary value at all. */
export function isTrackingAccessConfigured(): boolean {
  return secret() !== null;
}

/**
 * Canonical form of a submitted secondary value.
 *
 * Uppercased, with every non-alphanumeric character removed. That covers the
 * realistic input noise for both accepted kinds without a per-kind branch:
 *
 *   "07111"        → "07111"      (recipient ZIP)
 *   " 07111 "      → "07111"      (paste whitespace, incl. NBSP)
 *   "07111-1234"   → "071111234"  (ZIP+4 — see `secondaryCandidates`)
 *   "pl-a7k2"      → "PLA7K2"     (access code, case- and dash-insensitive)
 *
 * The tolerance is deliberate and mirrors `normalizeTrackingNumber`: a
 * customer reading a value off a printed BOL must not fail verification over
 * typography. It is NOT a weakening — the value space is unchanged, because
 * the same normalisation is applied when the hash is written.
 */
export function normalizeSecondaryValue(raw: string): string {
  return raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Every form of the submitted value that may legitimately match the stored
 * hash.
 *
 * Exactly one alternative exists: a nine-digit input is a ZIP+4, whose first
 * five digits are the ZIP a dispatcher would have recorded. Accepting both
 * costs one extra HMAC and removes the single most likely honest failure
 * ("I typed the ZIP off the label, which has the +4 on it").
 *
 * The list is always evaluated in full by `verifySecondaryValue` — no early
 * exit — so the number of candidates never varies the response time for a
 * given input length.
 */
export function secondaryCandidates(raw: string): string[] {
  const normalized = normalizeSecondaryValue(raw);
  if (normalized === "") return [];
  const candidates = [normalized];
  if (/^[0-9]{9}$/.test(normalized)) candidates.push(normalized.slice(0, 5));
  return candidates;
}

/**
 * Hash a secondary value for storage in `shipments.public_access_hash`.
 *
 * Returns null when `TRACKING_ACCESS_SECRET` is unset — callers must store
 * NULL rather than a plaintext or unkeyed fallback, exactly as `encryptPII`
 * requires. A shipment whose `public_access_hash` is null cannot be tracked
 * publicly at all, which is the correct outcome: no credential, no access.
 */
export function hashSecondaryValue(raw: string): string | null {
  const key = secret();
  if (key === null) {
    console.warn(
      "[tracking-access] TRACKING_ACCESS_SECRET unset — refusing to store a tracking credential",
    );
    return null;
  }
  const normalized = normalizeSecondaryValue(raw);
  if (normalized === "") return null;
  return `${TRACKING_ACCESS_HASH_VERSION}:${digest(key, normalized)}`;
}

function digest(key: string, normalized: string): string {
  return createHmac("sha256", key).update(normalized, "utf8").digest("hex");
}

/**
 * Constant-time-ish verification of a submitted value against a stored hash.
 *
 * "-ish" is honest rather than modest, and the limits are worth writing down
 * because a comment claiming "constant time" that is not would be worse than
 * none:
 *
 *   * Every candidate is compared with `timingSafeEqual` over equal-length
 *     hex digests, and the loop does NOT break on a match — so a correct value
 *     and an incorrect one of the same shape do the same work.
 *   * A malformed or unparseable `stored` is compared against the decoy rather
 *     than short-circuiting, so "this shipment has no code set" is not
 *     distinguishable from "wrong code".
 *   * What is NOT equalised: the cost of the HMAC itself varies slightly with
 *     input LENGTH (one SHA-256 block boundary at 64 bytes), and the number of
 *     candidates varies with input shape. Neither leaks anything about the
 *     STORED value — both are functions of what the attacker already typed.
 *   * The caller (`public-lookup.ts`) additionally holds every response to a
 *     fixed minimum duration, which is what actually flattens the end-to-end
 *     profile across the database round trip.
 */
export function verifySecondaryValue(
  raw: string,
  stored: string | null,
): boolean {
  const key = secret();
  if (key === null) return false;

  const target = parseStoredDigest(stored) ?? DECOY_DIGEST;
  const targetBuffer = Buffer.from(target, "hex");

  const candidates = secondaryCandidates(raw);
  // No candidates still performs one comparison: an empty submission must not
  // be the fast path either. Zod rejects it earlier in practice; this is the
  // belt to that braces.
  const inputs = candidates.length > 0 ? candidates : [""];

  let matched = false;
  for (const candidate of inputs) {
    const computed = Buffer.from(digest(key, candidate), "hex");
    const equal =
      computed.length === targetBuffer.length &&
      timingSafeEqual(computed, targetBuffer);
    // Bitwise-style accumulation, no `break`: every candidate is evaluated.
    matched = matched || equal;
  }
  // A decoy target can never legitimately match, but say so explicitly rather
  // than relying on the CSPRNG's word for it.
  return matched && parseStoredDigest(stored) !== null;
}

/** `v1:<64 hex>` → the digest, or null for anything else (including null). */
function parseStoredDigest(stored: string | null): string | null {
  if (stored === null) return null;
  const prefix = `${TRACKING_ACCESS_HASH_VERSION}:`;
  if (!stored.startsWith(prefix)) return null;
  const hex = stored.slice(prefix.length);
  if (hex.length !== DIGEST_HEX_LENGTH || !/^[0-9a-f]+$/.test(hex)) return null;
  return hex;
}
