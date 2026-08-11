import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * M-76 — the §13 DRIVER UPDATE TOKEN: minting, hashing, expiry and state.
 *
 * `docs/DIRECTIVE-tracking.md` §13 lists nine requirements for
 * `/driver/update/[secureToken]`. This module owns four of them outright —
 * *short-lived*, *shipment-scoped*, *non-enumerable*, and the half of
 * *revocable* that is a question about a row's state — and it owns them as
 * pure functions so they can be tested without a database and reasoned about
 * without a request.
 *
 * The other five (rate limited · audit logged · only assigned shipment · no
 * financial data · no access to other carrier records) live in
 * `driver-access.ts` and migration 0023, because they are properties of a
 * transaction rather than of a string.
 *
 * ── "DO NOT EXPOSE INTERNAL SHIPMENT IDS IN PREDICTABLE URLS" ─────────────
 *
 * §13's own sentence, and it constrains the token's CONSTRUCTION rather than
 * its handling. So the token is 32 bytes from the CSPRNG, base64url, and it
 * is not derived from anything: not the shipment id, not the carrier id, not
 * the tracking number, not a counter, not a timestamp. There is no encoding
 * to reverse and no sequence to walk. `tests/unit/shipment-driver-token.test.ts`
 * asserts that property directly — a token minted for a known shipment
 * contains no substring of that shipment's id, tracking number or carrier id,
 * across a thousand mints.
 *
 * A JWT was considered and rejected. A signed payload would put the shipment
 * id INSIDE the URL in a base64 segment anybody can decode — §13's sentence
 * says "do not expose", not "do not expose in cleartext" — and it would make
 * revocation a denylist problem, when §13 asks for revocation outright. An
 * opaque random string with a server-side row is the shape where "revoked"
 * is a fact rather than a cache.
 *
 * ── WHY HMAC AND NOT A PLAIN DIGEST, AND WHY IT MATTERS LESS HERE ────────
 *
 * M-73's `access-code.ts` uses HMAC because a recipient ZIP has ~41 000 live
 * values and a plain `sha256(zip)` is a lookup table. A 256-bit random token
 * is not brute-forceable at all, so the keyed digest buys something narrower
 * but still real: a database dump alone cannot be used to VERIFY a token
 * somebody separately obtained (from a shoulder-surfed phone, a forwarded
 * text, a proxy log), because computing the candidate digest needs the env
 * key. It also keeps this module's storage format identical to the one the
 * repo already reviewed, which is worth more than a marginally cheaper hash.
 *
 * ── FAIL CLOSED ───────────────────────────────────────────────────────────
 *
 * Without `DRIVER_TOKEN_SECRET` this module refuses to mint and refuses to
 * verify. Most of the repo degrades gracefully without secrets (M-14's
 * idiom); a credential module does the opposite, for the reason
 * `access-code.ts` states: "we cannot verify" and "verified" are not the same
 * sentence. A secretless preview therefore has no working driver links, which
 * is honest and harmless — it has no service-role key and hence no shipments.
 */

/**
 * Stored-hash format prefix. Rotation path, stated before it is needed: a
 * `v2:` writer lands alongside a verifier that accepts both, live traffic
 * re-hashes on successful redemption, `v1:` support is dropped a release
 * later. 0023's CHECK constraint is `^v[0-9]+:[0-9a-f]{64}$`, so the column
 * already accepts the successor.
 */
export const DRIVER_TOKEN_HASH_VERSION = "v1";

/** Hex length of an HMAC-SHA-256 digest — 32 bytes. */
const DIGEST_HEX_LENGTH = 64;

/**
 * Token entropy, in bytes. 32 → 256 bits → 43 base64url characters.
 *
 * Sized against the threat §13 actually describes rather than a round number:
 * the token travels by SMS to a phone in a truck, so it is guessable only if
 * the space is small, and 2^256 is not small. It is short enough to survive a
 * text message unwrapped and long enough that nobody will try to type it —
 * which is the point, because a typeable token is a guessable one.
 */
const TOKEN_BYTES = 32;

/** Exactly what a base64url encoding of `TOKEN_BYTES` looks like. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * §13 "short-lived". Default 24 hours, overridable by `DRIVER_TOKEN_TTL_HOURS`.
 *
 * 24 is a shift, not a convenience: a driver receives the link at dispatch and
 * uses it through one pickup and one delivery window. A 15-minute token would
 * be re-issued so often that dispatchers would start issuing week-long ones
 * "to be safe", which is how short expiry dies in practice. A week-long
 * default would make a forwarded text a week-long credential.
 *
 * The ceiling is a WEEK and the floor is an HOUR, both clamped rather than
 * validated, because an operator who sets `DRIVER_TOKEN_TTL_HOURS=8760`
 * should get a week-long link and a warning, not a year-long one.
 */
export const DRIVER_TOKEN_DEFAULT_TTL_HOURS = 24;
export const DRIVER_TOKEN_MIN_TTL_HOURS = 1;
export const DRIVER_TOKEN_MAX_TTL_HOURS = 168;

function secret(): string | null {
  const value = process.env.DRIVER_TOKEN_SECRET;
  return value && value.trim() !== "" ? value : null;
}

/** True when this environment can mint or verify a driver link at all. */
export function isDriverTokenConfigured(): boolean {
  return secret() !== null;
}

/** The configured TTL in hours, clamped to [1, 168]. */
export function driverTokenTtlHours(): number {
  const raw = Number(process.env.DRIVER_TOKEN_TTL_HOURS);
  if (!Number.isFinite(raw) || raw <= 0) return DRIVER_TOKEN_DEFAULT_TTL_HOURS;
  return Math.min(
    DRIVER_TOKEN_MAX_TTL_HOURS,
    Math.max(DRIVER_TOKEN_MIN_TTL_HOURS, Math.floor(raw)),
  );
}

/** The expiry instant a link minted `now` would carry. */
export function driverTokenExpiry(now: Date = new Date()): string {
  return new Date(
    now.getTime() + driverTokenTtlHours() * 60 * 60 * 1000,
  ).toISOString();
}

/**
 * Mint a token. Returns null when unconfigured — the caller must NOT invent a
 * fallback, because a token nobody can verify is a link that never works and
 * a row that claims otherwise.
 */
export function mintDriverToken(): string | null {
  if (secret() === null) {
    console.warn(
      "[driver-token] DRIVER_TOKEN_SECRET unset — refusing to mint a driver link",
    );
    return null;
  }
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Canonical form of a token read out of a URL.
 *
 * Deliberately STRICT, unlike `normalizeSecondaryValue` in M-73. That one is
 * tolerant because a human reads a ZIP off a printed label and typos are the
 * expected failure; this one is never typed — it is tapped in a text message
 * — so the only realistic noise is surrounding whitespace and a stray
 * URL-encoding, and accepting anything looser would mean accepting
 * near-misses as candidates for a constant-time comparison that is supposed
 * to be exact.
 */
export function normalizeDriverToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (value === "") return null;
  // A token pasted out of a copied URL can arrive percent-encoded once.
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return TOKEN_PATTERN.test(value) ? value : null;
}

function digest(key: string, token: string): string {
  return createHmac("sha256", key).update(token, "utf8").digest("hex");
}

/**
 * Hash a token for storage in `shipment_driver_tokens.token_hash`.
 *
 * Returns null when unconfigured or when the token is malformed. A caller
 * that stored a plaintext or unkeyed fallback would defeat the whole model,
 * which is why this returns null rather than something usable — the same
 * contract `hashSecondaryValue` and `encryptPII` have.
 */
export function hashDriverToken(raw: unknown): string | null {
  const key = secret();
  if (key === null) {
    console.warn(
      "[driver-token] DRIVER_TOKEN_SECRET unset — refusing to hash a driver link",
    );
    return null;
  }
  const token = normalizeDriverToken(raw);
  if (token === null) return null;
  return `${DRIVER_TOKEN_HASH_VERSION}:${digest(key, token)}`;
}

/** `v1:<64 hex>` → the digest, or null for anything else (including null). */
function parseStoredDigest(stored: string | null): string | null {
  if (stored === null) return null;
  const prefix = `${DRIVER_TOKEN_HASH_VERSION}:`;
  if (!stored.startsWith(prefix)) return null;
  const hex = stored.slice(prefix.length);
  if (hex.length !== DIGEST_HEX_LENGTH || !/^[0-9a-f]+$/.test(hex)) return null;
  return hex;
}

/**
 * Constant-time comparison of a token against a stored hash.
 *
 * The live lookup does NOT use this — 0023 matches on `token_hash` with a
 * unique index, which is a single equality on a value an attacker cannot
 * produce without the key, and is not a timing oracle about any secret the
 * attacker does not already hold. This exists for the places where a hash is
 * already in hand (tests, and a future rotation that re-hashes on redemption)
 * and it is written properly so that nobody later writes `a === b`.
 */
export function verifyDriverToken(raw: unknown, stored: string | null): boolean {
  const key = secret();
  if (key === null) return false;
  const token = normalizeDriverToken(raw);
  const target = parseStoredDigest(stored);
  if (target === null) return false;
  const targetBuffer = Buffer.from(target, "hex");
  const computed = Buffer.from(digest(key, token ?? ""), "hex");
  return (
    computed.length === targetBuffer.length &&
    timingSafeEqual(computed, targetBuffer)
  );
}

/* ------------------------------------------------------------------ *
 * Lifecycle state
 * ------------------------------------------------------------------ */

/**
 * `driverTokenState`, `isDriverTokenUsable`, `driverTokenMinutesRemaining`,
 * `driverUpdatePath`, `maskDriverToken` and `driverTokenLabel` live in
 * `driver-token-state.ts`, a PLAIN module, and are re-exported here so
 * callers have one import.
 *
 * WHY THE SPLIT. This file carries `server-only` because it reads
 * `DRIVER_TOKEN_SECRET` and mints credentials — a client bundle must never be
 * able to import it, and `server-only` is what makes that a build error rather
 * than a review question. But the carrier portal and the dispatcher board both
 * render a list of links with "Active / Expired / Revoked" beside each one,
 * and both are client components. Duplicating the precedence rule into JSX is
 * exactly the drift that would eventually disagree with 0023's `redeem_…`, so
 * the pure half moved out and the secret half stayed in.
 */
export {
  driverTokenState,
  isDriverTokenUsable,
  driverTokenMinutesRemaining,
  driverUpdatePath,
  maskDriverToken,
  driverTokenLabel,
  type DriverTokenState,
  type DriverTokenLifecycle,
} from "@/lib/shipments/driver-token-state";
