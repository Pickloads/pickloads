import { beforeEach, afterEach, describe, expect, it } from "vitest";

/**
 * M-76 — the §13 driver token: minting, hashing, expiry, revocation, consent
 * and the non-enumerability property §13 states in its own words.
 *
 * ── WHY THE MODULE IS RE-IMPORTED PER SUITE ──────────────────────────────
 *
 * `driver-token.ts` reads `DRIVER_TOKEN_SECRET` on every call rather than at
 * module load, so a plain `import` would be fine — except for one thing worth
 * proving: that the module FAILS CLOSED with no key. Setting and unsetting the
 * variable around a static import is enough for that, and it is what the
 * "unconfigured" block does. `vi.resetModules()` is deliberately NOT used, so
 * these tests exercise the same module instance the server would.
 */

const KEY = "m76-test-driver-secret";

async function tokenModule() {
  return import("@/lib/shipments/driver-token");
}

async function stateModule() {
  return import("@/lib/shipments/driver-token-state");
}

const ORIGINAL_SECRET = process.env.DRIVER_TOKEN_SECRET;
const ORIGINAL_TTL = process.env.DRIVER_TOKEN_TTL_HOURS;

beforeEach(() => {
  process.env.DRIVER_TOKEN_SECRET = KEY;
  delete process.env.DRIVER_TOKEN_TTL_HOURS;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.DRIVER_TOKEN_SECRET;
  else process.env.DRIVER_TOKEN_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_TTL === undefined) delete process.env.DRIVER_TOKEN_TTL_HOURS;
  else process.env.DRIVER_TOKEN_TTL_HOURS = ORIGINAL_TTL;
});

/* ================================================================== *
 * Generation
 * ================================================================== */

describe("§13 token generation", () => {
  it("mints a 43-character base64url string (32 bytes of CSPRNG)", async () => {
    const { mintDriverToken } = await tokenModule();
    const token = mintDriverToken();
    expect(token).not.toBeNull();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("mints a DIFFERENT token every time — 1000 mints, 1000 distinct values", async () => {
    const { mintDriverToken } = await tokenModule();
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(mintDriverToken() ?? "");
    expect(seen.size).toBe(1000);
    expect(seen.has("")).toBe(false);
  });

  /**
   * §13 verbatim: *"Do not expose internal shipment IDs in predictable URLs."*
   *
   * This is the assertion that makes that sentence a property rather than an
   * intention: across a thousand mints, no token contains any fragment of the
   * shipment id, the carrier id or the tracking number it will be scoped to.
   * It cannot, because nothing derives it from them — but a future "helpful"
   * change that prefixed a token with a shipment fragment would fail here.
   */
  it("contains NO fragment of the shipment id, carrier id or tracking number", async () => {
    const { mintDriverToken } = await tokenModule();
    const shipmentId = "6f1d4a2e-9c3b-4f77-8a11-2b3c4d5e6f70";
    const carrierId = "11111111-1111-4111-8111-111111111111";
    const trackingNumber = "PL-2026-000458";
    /*
     * ≥ 6 characters, not ≥ 4 — a correction M-77's gate runs surfaced.
     *
     * The PROPERTY this test asserts is that a token is not DERIVED from an
     * identifier. A four-hex-character coincidence inside a 43-character
     * random string is not evidence of derivation: over ~40 start positions in
     * a 36-symbol lowered alphabet it is ~2.4e-5 per token per fragment, and
     * with ten such fragments × 1000 mints the suite failed roughly one run in
     * five. That is a flaky gate, not a security signal.
     *
     * At six characters the same coincidence is ~1.8e-8 per token-fragment
     * (~1e-4 over the whole loop), which is small enough that a hit really
     * would mean the generator had started copying something. The
     * identifiers, the tracking number and every UUID group of six or more
     * are all still covered; what is dropped is exactly the four-character
     * hex groups whose collision rate WAS the flake.
     */
    const fragments = [
      shipmentId,
      carrierId,
      ...shipmentId.split("-"),
      ...carrierId.split("-"),
      trackingNumber,
      trackingNumber.replace(/-/g, ""),
      "000458",
    ].filter((f) => f.length >= 6);

    for (let i = 0; i < 1000; i++) {
      const token = mintDriverToken() ?? "";
      for (const fragment of fragments) {
        expect(token.toLowerCase()).not.toContain(fragment.toLowerCase());
      }
    }
  });

  it("is not sequential: no two consecutive mints share a 6-character prefix", async () => {
    const { mintDriverToken } = await tokenModule();
    let previous = mintDriverToken() ?? "";
    for (let i = 0; i < 200; i++) {
      const next = mintDriverToken() ?? "";
      expect(next.slice(0, 6)).not.toBe(previous.slice(0, 6));
      previous = next;
    }
  });

  it("REFUSES to mint with no DRIVER_TOKEN_SECRET (fails closed)", async () => {
    delete process.env.DRIVER_TOKEN_SECRET;
    const { mintDriverToken, isDriverTokenConfigured } = await tokenModule();
    expect(isDriverTokenConfigured()).toBe(false);
    expect(mintDriverToken()).toBeNull();
  });
});

/* ================================================================== *
 * Hashing
 * ================================================================== */

describe("§13 token hashing", () => {
  it("stores `v1:<64 hex>` and never the token", async () => {
    const { mintDriverToken, hashDriverToken } = await tokenModule();
    const token = mintDriverToken() ?? "";
    const hash = hashDriverToken(token) ?? "";
    expect(hash).toMatch(/^v1:[0-9a-f]{64}$/);
    // The stored value must not contain the credential, in any casing.
    expect(hash).not.toContain(token);
    expect(hash.toLowerCase()).not.toContain(token.toLowerCase());
  });

  it("matches 0023's CHECK constraint on `token_hash`", async () => {
    const { mintDriverToken, hashDriverToken } = await tokenModule();
    // The regex is copied from the migration; a divergence here means an
    // insert that the database refuses at runtime.
    const CHECK = /^v[0-9]+:[0-9a-f]{64}$/;
    for (let i = 0; i < 50; i++) {
      expect(hashDriverToken(mintDriverToken() ?? "") ?? "").toMatch(CHECK);
    }
  });

  it("is deterministic for one key and DIFFERENT under another", async () => {
    const { mintDriverToken, hashDriverToken } = await tokenModule();
    const token = mintDriverToken() ?? "";
    const a = hashDriverToken(token);
    const b = hashDriverToken(token);
    expect(a).toBe(b);
    process.env.DRIVER_TOKEN_SECRET = "a-different-key";
    expect(hashDriverToken(token)).not.toBe(a);
  });

  it("REFUSES to hash with no secret — a caller cannot fall back to a digest", async () => {
    delete process.env.DRIVER_TOKEN_SECRET;
    const { hashDriverToken } = await tokenModule();
    expect(hashDriverToken("x".repeat(43))).toBeNull();
  });

  it("normalises tolerantly enough for a copied URL and no further", async () => {
    const { mintDriverToken, normalizeDriverToken } = await tokenModule();
    const token = mintDriverToken() ?? "";
    expect(normalizeDriverToken(` ${token} `)).toBe(token);
    expect(normalizeDriverToken(encodeURIComponent(token))).toBe(token);
    // Everything that is NOT a well-formed token is refused outright, so a
    // near-miss never reaches the hashing path.
    for (const bad of [
      "",
      "   ",
      token.slice(0, 42),
      `${token}x`,
      `${token}!`,
      "../../etc/passwd",
      "%%%",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(normalizeDriverToken(bad)).toBeNull();
    }
  });

  it("verifies in constant time and refuses a malformed or absent stored hash", async () => {
    const { mintDriverToken, hashDriverToken, verifyDriverToken } =
      await tokenModule();
    const token = mintDriverToken() ?? "";
    const other = mintDriverToken() ?? "";
    const hash = hashDriverToken(token);
    expect(verifyDriverToken(token, hash)).toBe(true);
    expect(verifyDriverToken(other, hash)).toBe(false);
    expect(verifyDriverToken(token, null)).toBe(false);
    expect(verifyDriverToken(token, "not-a-hash")).toBe(false);
    expect(verifyDriverToken(token, "v1:zz")).toBe(false);
    expect(verifyDriverToken(token, `v2:${"a".repeat(64)}`)).toBe(false);
  });

  it("MASKS a token completely — no prefix, no suffix, no length hint", async () => {
    const { mintDriverToken, maskDriverToken } = await tokenModule();
    const token = mintDriverToken() ?? "";
    const masked = maskDriverToken();
    for (let start = 0; start + 4 <= token.length; start++) {
      expect(masked).not.toContain(token.slice(start, start + 4));
    }
  });
});

/* ================================================================== *
 * Expiry (§13 "short-lived")
 * ================================================================== */

describe("§13 expiry", () => {
  it("defaults to 24 hours", async () => {
    const { driverTokenTtlHours, DRIVER_TOKEN_DEFAULT_TTL_HOURS } =
      await tokenModule();
    expect(driverTokenTtlHours()).toBe(DRIVER_TOKEN_DEFAULT_TTL_HOURS);
    expect(DRIVER_TOKEN_DEFAULT_TTL_HOURS).toBe(24);
  });

  it("CLAMPS the env override to [1, 168] rather than trusting it", async () => {
    const { driverTokenTtlHours } = await tokenModule();
    for (const [input, expected] of [
      ["4", 4],
      ["1", 1],
      ["168", 168],
      // An operator reaching for "a year" gets a week, not a year.
      ["8760", 168],
      ["0", 24],
      ["-5", 24],
      ["abc", 24],
      ["", 24],
      ["2.9", 2],
    ] as const) {
      process.env.DRIVER_TOKEN_TTL_HOURS = input;
      expect(driverTokenTtlHours(), `TTL=${input}`).toBe(expected);
    }
  });

  it("produces an expiry strictly in the future — 0023's CHECK requires it", async () => {
    const { driverTokenExpiry } = await tokenModule();
    const now = new Date("2026-08-05T12:00:00.000Z");
    const expiry = driverTokenExpiry(now);
    expect(Date.parse(expiry)).toBeGreaterThan(now.getTime());
    expect(expiry).toBe("2026-08-06T12:00:00.000Z");
  });

  it("classifies an expired link as `expired` and counts zero minutes left", async () => {
    const { driverTokenState, driverTokenMinutesRemaining, isDriverTokenUsable } =
      await stateModule();
    const now = new Date("2026-08-05T12:00:00.000Z");
    const token = { revoked_at: null, expires_at: "2026-08-05T11:59:59.000Z" };
    expect(driverTokenState(token, now)).toBe("expired");
    expect(isDriverTokenUsable(token, now)).toBe(false);
    expect(driverTokenMinutesRemaining(token, now)).toBe(0);
  });

  it("treats expiry as INCLUSIVE of the boundary — expires_at === now is expired", async () => {
    const { driverTokenState } = await stateModule();
    const now = new Date("2026-08-05T12:00:00.000Z");
    // 0023 uses `expires_at <= now()`; the TS side must agree or a link would
    // be drawn as active on a page that the database then refuses.
    expect(
      driverTokenState({ revoked_at: null, expires_at: now.toISOString() }, now),
    ).toBe("expired");
  });

  it("classifies a live link as `active` with the right minutes remaining", async () => {
    const { driverTokenState, driverTokenMinutesRemaining, isDriverTokenUsable } =
      await stateModule();
    const now = new Date("2026-08-05T12:00:00.000Z");
    const token = { revoked_at: null, expires_at: "2026-08-05T14:30:00.000Z" };
    expect(driverTokenState(token, now)).toBe("active");
    expect(isDriverTokenUsable(token, now)).toBe(true);
    expect(driverTokenMinutesRemaining(token, now)).toBe(150);
  });
});

/* ================================================================== *
 * Revocation (§13 "revocable")
 * ================================================================== */

describe("§13 revocation", () => {
  it("REVOKED outranks EXPIRED — the two are different operational stories", async () => {
    const { driverTokenState } = await stateModule();
    const now = new Date("2026-08-05T12:00:00.000Z");
    // Both true at once. 0023's `redeem_…` checks revocation first, and this
    // asserts the TypeScript side agrees, so a dispatcher's list and the
    // database never tell different stories about the same row.
    expect(
      driverTokenState(
        { revoked_at: "2026-08-04T09:00:00.000Z", expires_at: "2026-08-05T11:00:00.000Z" },
        now,
      ),
    ).toBe("revoked");
  });

  it("a revoked link is never usable, even inside its window", async () => {
    const { driverTokenState, isDriverTokenUsable, driverTokenMinutesRemaining } =
      await stateModule();
    const now = new Date("2026-08-05T12:00:00.000Z");
    const token = {
      revoked_at: "2026-08-05T11:00:00.000Z",
      expires_at: "2026-08-06T12:00:00.000Z",
    };
    expect(driverTokenState(token, now)).toBe("revoked");
    expect(isDriverTokenUsable(token, now)).toBe(false);
    // Zero, not "24 hours" — a revoked link has no life left whatever the
    // column says, and a countdown beside "Revoked" would read as a bug.
    expect(driverTokenMinutesRemaining(token, now)).toBe(0);
  });
});

/* ================================================================== *
 * The URL (§13 non-enumerable)
 * ================================================================== */

describe("§13 the URL", () => {
  it("is /driver/update/<token> with no id, no origin and no query", async () => {
    const { mintDriverToken, driverUpdatePath } = await tokenModule();
    const token = mintDriverToken() ?? "";
    const path = driverUpdatePath(token);
    expect(path).toBe(`/driver/update/${token}`);
    expect(path.startsWith("http")).toBe(false);
    expect(path).not.toContain("?");
  });

  it("labels a link by its ROW id, never by its token", async () => {
    const { driverTokenLabel } = await stateModule();
    const label = driverTokenLabel({ id: "6f1d4a2e-9c3b-4f77-8a11-2b3c4d5e6f70" });
    expect(label).toBe("6f1d4a2e");
    expect(label.length).toBeLessThan(12);
  });
});
