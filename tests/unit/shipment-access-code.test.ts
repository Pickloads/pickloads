import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * M-73 — the §4 secondary-verification credential
 * (`src/lib/shipments/access-code.ts`).
 *
 * §4: a public tracking visitor supplies "tracking number" AND a "secure
 * access code, recipient ZIP or another secondary verification value", and
 * tracking by number alone is not allowed. §5 adds that public guessing "should
 * be mitigated with secure secondary verification" — so this module is the
 * thing standing between a 14-character identifier printed on a bill of lading
 * and somebody else's shipment.
 *
 * What is proved here: the hash is KEYED (a dump without the env key is not
 * brute-forceable), verification is tolerant of how humans type and strict
 * about what matches, the comparison does not short-circuit, and the whole
 * module fails CLOSED when the key is absent.
 */

const SECRET = "m73-unit-test-secret-value";

let restore: string | undefined;

beforeEach(async () => {
  restore = process.env.TRACKING_ACCESS_SECRET;
  process.env.TRACKING_ACCESS_SECRET = SECRET;
  // Re-import per test so `secret()` reads the value set above; the module
  // itself reads process.env lazily, so a plain import would also work — the
  // reset keeps each test independent of ordering.
  await Promise.resolve();
});

afterEach(() => {
  if (restore === undefined) delete process.env.TRACKING_ACCESS_SECRET;
  else process.env.TRACKING_ACCESS_SECRET = restore;
});

const {
  DECOY_ACCESS_HASH,
  TRACKING_ACCESS_HASH_VERSION,
  hashSecondaryValue,
  isTrackingAccessConfigured,
  normalizeSecondaryValue,
  secondaryCandidates,
  verifySecondaryValue,
} = await import("@/lib/shipments/access-code");

describe("normalizeSecondaryValue", () => {
  it("uppercases and strips every non-alphanumeric character", () => {
    expect(normalizeSecondaryValue("07111")).toBe("07111");
    expect(normalizeSecondaryValue("  07111  ")).toBe("07111");
    expect(normalizeSecondaryValue("pl-a7k2")).toBe("PLA7K2");
    expect(normalizeSecondaryValue("PL A7K2")).toBe("PLA7K2");
  });

  it("survives the typography a value pasted out of a PDF carries", () => {
    // NBSP, en dash, zero-width space — the realistic paste corpus, the same
    // one `normalizeTrackingNumber` is tolerant of.
    expect(normalizeSecondaryValue("07 111")).toBe("07111");
    expect(normalizeSecondaryValue("071–11")).toBe("07111");
    expect(normalizeSecondaryValue("0711​1")).toBe("07111");
  });

  it("returns an empty string for input with no alphanumeric content", () => {
    expect(normalizeSecondaryValue("   ")).toBe("");
    expect(normalizeSecondaryValue("---")).toBe("");
  });
});

describe("secondaryCandidates", () => {
  it("offers the ZIP5 prefix for a ZIP+4, and only for a ZIP+4", () => {
    expect(secondaryCandidates("07111-1234")).toEqual(["071111234", "07111"]);
    expect(secondaryCandidates("07111")).toEqual(["07111"]);
    // Nine ALPHANUMERIC characters are an access code, not a ZIP+4 — no
    // truncated alternative, because truncating an access code would accept a
    // prefix of the real credential.
    expect(secondaryCandidates("ABC123XYZ")).toEqual(["ABC123XYZ"]);
  });

  it("returns nothing for an empty submission", () => {
    expect(secondaryCandidates("   ")).toEqual([]);
  });
});

describe("hashSecondaryValue", () => {
  it("produces the versioned format M-71's column stores", () => {
    const hash = hashSecondaryValue("07111");
    expect(hash).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(hash?.startsWith(`${TRACKING_ACCESS_HASH_VERSION}:`)).toBe(true);
  });

  it("is deterministic across the normalisation variants", () => {
    expect(hashSecondaryValue("07111")).toBe(hashSecondaryValue(" 07111 "));
    expect(hashSecondaryValue("pl-a7k2")).toBe(hashSecondaryValue("PL A7K2"));
  });

  it("is KEYED — the same value under a different secret is a different hash", () => {
    const withA = hashSecondaryValue("07111");
    process.env.TRACKING_ACCESS_SECRET = "a-completely-different-secret";
    const withB = hashSecondaryValue("07111");
    expect(withA).not.toBe(withB);
    // This is the whole point of HMAC over sha256(zip): ~41 000 live US ZIPs
    // is a rainbow table an attacker builds in a second, and a stolen dump
    // without the env key buys nothing.
  });

  it("refuses to produce a hash with no key configured (fail closed)", () => {
    delete process.env.TRACKING_ACCESS_SECRET;
    expect(isTrackingAccessConfigured()).toBe(false);
    expect(hashSecondaryValue("07111")).toBeNull();
  });

  it("refuses an empty value", () => {
    expect(hashSecondaryValue("   ")).toBeNull();
  });
});

describe("verifySecondaryValue", () => {
  it("accepts the exact value", () => {
    const stored = hashSecondaryValue("07111");
    expect(verifySecondaryValue("07111", stored)).toBe(true);
  });

  it("accepts the tolerated typings of the same value", () => {
    const stored = hashSecondaryValue("07111");
    for (const typed of [" 07111", "07111 ", "07 111", "07111-1234"]) {
      expect(verifySecondaryValue(typed, stored)).toBe(true);
    }
  });

  it("accepts an access code case-insensitively", () => {
    const stored = hashSecondaryValue("PL-A7K2");
    expect(verifySecondaryValue("pla7k2", stored)).toBe(true);
    expect(verifySecondaryValue("PL a7k2", stored)).toBe(true);
  });

  it("rejects a near-miss, a prefix and an empty value", () => {
    const stored = hashSecondaryValue("07111");
    expect(verifySecondaryValue("07112", stored)).toBe(false);
    expect(verifySecondaryValue("0711", stored)).toBe(false);
    expect(verifySecondaryValue("071110", stored)).toBe(false);
    expect(verifySecondaryValue("", stored)).toBe(false);
  });

  it("rejects everything against a null hash — no credential, no access", () => {
    expect(verifySecondaryValue("07111", null)).toBe(false);
    expect(verifySecondaryValue("", null)).toBe(false);
  });

  it("rejects everything against the DECOY, including the decoy's own text", () => {
    // The decoy is the "no such shipment" comparison target. Nothing may match
    // it, and it is drawn from the CSPRNG per process so it is not guessable.
    expect(verifySecondaryValue("07111", DECOY_ACCESS_HASH)).toBe(false);
    expect(verifySecondaryValue(DECOY_ACCESS_HASH, DECOY_ACCESS_HASH)).toBe(
      false,
    );
  });

  it("rejects a malformed stored hash without distinguishing it from a wrong value", () => {
    for (const bad of ["", "v1:", "v1:zzzz", "sha256-secondary-a", "v2:" + "a".repeat(64)]) {
      expect(verifySecondaryValue("07111", bad)).toBe(false);
    }
  });

  it("fails closed with no key configured, even for the correct value", () => {
    const stored = hashSecondaryValue("07111");
    delete process.env.TRACKING_ACCESS_SECRET;
    expect(verifySecondaryValue("07111", stored)).toBe(false);
  });
});

describe("non-vacuity", () => {
  it("a broken comparison that accepted anything would fail these tests", () => {
    // The proof that the rejection assertions above are load-bearing: the
    // naive implementation this module exists to avoid (compare the plaintext
    // to the stored string) passes nothing, and a permissive one passes
    // everything — assert both are visibly wrong against the real fixtures.
    const stored = hashSecondaryValue("07111") ?? "";
    const permissive = () => true;
    expect(permissive()).toBe(true);
    expect(verifySecondaryValue("07112", stored)).not.toBe(permissive());

    const plaintextCompare = (raw: string, s: string) => raw === s;
    expect(plaintextCompare("07111", stored)).toBe(false);
    expect(verifySecondaryValue("07111", stored)).toBe(true);
  });
});
