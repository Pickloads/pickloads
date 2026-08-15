import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * M-93 — regression tests for the QCMobile response envelope.
 *
 * ── THE FAILURE THESE EXIST FOR ──────────────────────────────────────────
 *
 * The first live run failed with `Expected 'found' for USDOT 76830, got
 * 'not_found'`. Two candidate causes, and they are indistinguishable from the
 * outside:
 *
 *   a) the fixture USDOT does not exist;
 *   b) the parser cannot find a carrier in a response that contains one.
 *
 * (a) was the actual cause — FMCSA's own SAFER returns RECORD NOT FOUND for
 * 76830. But the investigation exposed (b) as a real latent risk: FMCSA's
 * developer site documents the response ELEMENTS and publishes no example
 * ENVELOPE, so `extractCarrier` was written against an assumed nesting. A
 * wrong assumption there produces `not_found` — the same answer as a carrier
 * that genuinely does not exist, with no way to tell them apart.
 *
 * So the parser now accepts every plausible nesting, and these tests pin each
 * one. They use fixtures rather than the network deliberately: this is about
 * OUR parser handling shapes, not about FMCSA being up. The live test covers
 * the real response.
 *
 * The `extractCarrier` function is module-private, so the shapes are asserted
 * through the exported adapter behaviour where possible and through the
 * source otherwise.
 */

const ADAPTER_SRC = readFileSync(
  "src/lib/carrier-authority/fmcsa-qcmobile.ts",
  "utf8",
);

describe("M-93 · QCMobile envelope handling", () => {
  it("identifies a carrier by its FIELDS, not by its position", () => {
    // `looksLikeCarrier` is the guard. Position is a guess; the presence of
    // dotNumber/legalName is evidence.
    expect(ADAPTER_SRC).toContain("function looksLikeCarrier");
    expect(ADAPTER_SRC).toMatch(/"dotNumber" in o \|\| "legalName" in o/);
  });

  it("handles an array envelope, scanning past unusable entries", () => {
    expect(ADAPTER_SRC).toMatch(/if \(Array\.isArray\(content\)\)/);
    expect(ADAPTER_SRC).toMatch(/for \(const entry of content\)/);
  });

  /*
   * Three assertions that used to live here matched the parser's SOURCE TEXT
   * — `if (looksLikeCarrier(carrier)) return carrier`, and so on. They broke
   * the moment `extractCarrier` returned a discriminated outcome instead of
   * `Record | null`, which is the tell: they were pinned to an implementation,
   * not to a behaviour.
   *
   * They are gone rather than rewritten. Every property they were reaching for
   * — content.carrier, inline content, array entries, a string or null content
   * never being read as a carrier — is now asserted BEHAVIOURALLY against
   * fixtures in `fmcsa-envelope-outcomes.test.ts`, which is both stricter and
   * survives a refactor.
   */
});

describe("M-93 · 200-with-no-carrier is not a provider failure", () => {
  it("distinguishes an empty result from an outage", () => {
    // Required by the brief: HTTP 200 with no carrier must be `not_found`,
    // while a 5xx must be `provider_unavailable`. Collapsing them would either
    // refuse a real carrier during an outage or hide an outage as a refusal.
    expect(ADAPTER_SRC).toMatch(
      /if \(res\.ok \|\| res\.status === 404\) return \{ status: "not_found" \}/,
    );
    expect(ADAPTER_SRC).toMatch(
      /if \(res\.status >= 500\)[\s\S]{0,120}provider_unavailable/,
    );
    expect(ADAPTER_SRC).toMatch(
      /if \(res\.status === 429\)[\s\S]{0,120}provider_unavailable/,
    );
  });

  it("treats a rejected credential as an outage, never as 'no such carrier'", () => {
    // QCMobile returns 404 for BOTH "no such carrier" and "webkey not found".
    // Reading the latter as not_found would fail every applicant the moment
    // the key expired — and would look like a data problem, not a config one.
    expect(ADAPTER_SRC).toMatch(/webkey not found/i);
    expect(ADAPTER_SRC).toMatch(/credential_rejected/);
  });

  it("treats malformed JSON as an outage, not a verdict", () => {
    expect(ADAPTER_SRC).toMatch(/malformed_json/);
  });
});

describe("M-93 · the live fixture is not stale", () => {
  const LIVE_SRC = readFileSync("tests/unit/fmcsa-live.test.ts", "utf8");

  it("no longer pins the non-existent USDOT 76830", () => {
    // FMCSA SAFER returns RECORD NOT FOUND for 76830. It was a throwaway probe
    // URL that became a fixture without anyone checking it identified anything.
    expect(LIVE_SRC).not.toMatch(/FMCSA_TEST_USDOT \?\? "76830"/);
  });

  it("pins only the number, never a mutable third-party fact", () => {
    // Company name and operating status can change without notice.
    expect(LIVE_SRC).not.toMatch(/UNITED PARCEL/i);
    expect(LIVE_SRC).not.toMatch(/toBe\("UPS"\)/);
    // What IS asserted is the normalisation contract.
    expect(LIVE_SRC).toMatch(/expect\(\[true, false, null\]\)\.toContain/);
  });

  it("the live identity check cannot pass without a live record", () => {
    // The original returned early when the lookup was not `found`, so it
    // reported PASS while asserting nothing — one of the five "passes" in the
    // first live run was hollow.
    expect(LIVE_SRC).not.toMatch(/if \(result\.status !== "found"\) return;/);
    expect(LIVE_SRC).toMatch(/identity matching needs a live record/);
  });
});

describe("M-93 · the shape diagnostic is safe to run and to paste", () => {
  const SCRIPT = readFileSync("scripts/fmcsa-shape-check.mjs", "utf8");

  it("never prints the credential or the URL that carries it", () => {
    const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, " ").replace(
      /^[ \t]*\/\/.*$/gm,
      " ",
    );
    expect(code).not.toMatch(/console\.log\([^)]*webKey/);
    expect(code).not.toMatch(/console\.log\([^)]*\$\{BASE_URL\}/);
  });

  it("prints field NAMES and TYPES, not values", () => {
    // A carrier record carries a physical address and a telephone number. A
    // shape check has no business rendering either.
    expect(SCRIPT).toMatch(/field names & types/);
    expect(SCRIPT).toMatch(
      /k === "dotNumber" \? ` = \$\{JSON\.stringify\(v\)\}` : ""/,
    );
  });

  it("reports WHERE the carrier was located, which is the diagnostic value", () => {
    expect(SCRIPT).toMatch(/carrier path/);
    expect(SCRIPT).toMatch(/content \(carrier inline\)/);
  });
});
