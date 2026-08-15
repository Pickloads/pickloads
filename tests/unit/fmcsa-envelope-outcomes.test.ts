import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractCarrier } from "@/lib/carrier-authority/fmcsa-qcmobile";
import { assessCarrierRisk } from "@/lib/carrier-authority/risk-engine";
import type { AuthorityLookupResult } from "@/lib/carrier-authority/provider";

/**
 * M-93 — absence vs. incomprehension.
 *
 * ── THE BUG THIS CLOSES ──────────────────────────────────────────────────
 *
 * `extractCarrier` used to return `Record | null`, and the caller turned every
 * `null` on a 2xx into `not_found`. Two very different situations collapsed
 * into one answer:
 *
 *   a) FMCSA said "no such carrier"          → not_found is CORRECT
 *   b) FMCSA sent a carrier we failed to parse → not_found is a LIE
 *
 * (b) is the dangerous one. A parser that does not recognise an envelope would
 * tell a real, operating carrier that the federal register has no record of
 * them — and it would look identical to a genuine absence, so nobody would
 * ever find out. The whole point of the three-way outcome is that (b) is now
 * loud and routes to a human.
 *
 * These tests are pure fixtures. They are about OUR parser's classification,
 * not about FMCSA being reachable.
 */

const CARRIER = { dotNumber: "21800", legalName: "SOME CARRIER INC" };

describe("M-93 · genuine absence → absent (the only path to NOT_FOUND)", () => {
  it("content: null", () => {
    expect(extractCarrier({ content: null, retrievalDate: "x" })).toEqual({
      kind: "absent",
    });
  });

  it("content missing entirely", () => {
    expect(extractCarrier({ retrievalDate: "x" })).toEqual({ kind: "absent" });
  });

  it("content: [] — an empty result set", () => {
    expect(extractCarrier({ content: [] })).toEqual({ kind: "absent" });
  });

  it("content: {} — an empty object", () => {
    expect(extractCarrier({ content: {} })).toEqual({ kind: "absent" });
  });

  it("content: '' — an empty string", () => {
    expect(extractCarrier({ content: "   " })).toEqual({ kind: "absent" });
  });
});

describe("M-93 · recognised envelopes → carrier", () => {
  it("content.carrier — the documented-ish shape", () => {
    const r = extractCarrier({ content: { carrier: CARRIER } });
    expect(r.kind).toBe("carrier");
    if (r.kind === "carrier") expect(r.carrier.dotNumber).toBe("21800");
  });

  it("content inline — the shape the original parser missed", () => {
    const r = extractCarrier({ content: CARRIER });
    expect(r.kind).toBe("carrier");
  });

  it("content[0].carrier — the docket list", () => {
    const r = extractCarrier({ content: [{ carrier: CARRIER }] });
    expect(r.kind).toBe("carrier");
  });

  it("content[0] — a bare list entry", () => {
    const r = extractCarrier({ content: [CARRIER] });
    expect(r.kind).toBe("carrier");
  });

  it("scans past unusable entries to a real one", () => {
    const r = extractCarrier({ content: [null, { junk: 1 }, CARRIER] });
    expect(r.kind).toBe("carrier");
  });

  it("legalName alone is enough to recognise a carrier", () => {
    // A record may omit dotNumber in some responses; either field identifies it.
    expect(extractCarrier({ content: { legalName: "X" } }).kind).toBe(
      "carrier",
    );
  });
});

describe("M-93 · populated but unreadable → unrecognized, NEVER not_found", () => {
  it("an object with keys but nothing carrier-shaped", () => {
    expect(extractCarrier({ content: { somethingNew: { a: 1 } } })).toEqual({
      kind: "unrecognized",
    });
  });

  it("a MALFORMED carrier object — key present, fields absent", () => {
    // `{ content: { carrier: {} } }`. The wrapper is right and the payload is
    // empty; that is a broken response, not an absent carrier.
    expect(extractCarrier({ content: { carrier: {} } })).toEqual({
      kind: "unrecognized",
    });
  });

  it("a populated array with no carrier in it", () => {
    expect(extractCarrier({ content: [{ nope: true }, 42] })).toEqual({
      kind: "unrecognized",
    });
  });

  it("a non-empty string we do not understand", () => {
    // e.g. a future "Rate limit exceeded" body. Not an absence.
    expect(
      extractCarrier({ content: "Service temporarily unavailable" }),
    ).toEqual({ kind: "unrecognized" });
  });

  it("a body that is not an object at all", () => {
    expect(extractCarrier("<html>gateway error</html>")).toEqual({
      kind: "unrecognized",
    });
    expect(extractCarrier(null)).toEqual({ kind: "unrecognized" });
    expect(extractCarrier(42)).toEqual({ kind: "unrecognized" });
  });

  it("NONE of the unrecognized cases is ever classified as absent", () => {
    const unreadable: unknown[] = [
      { content: { somethingNew: 1 } },
      { content: { carrier: {} } },
      { content: [{ nope: true }] },
      { content: "Service temporarily unavailable" },
      "<html/>",
      null,
      42,
    ];
    for (const body of unreadable) {
      expect(extractCarrier(body).kind, JSON.stringify(body)).toBe(
        "unrecognized",
      );
    }
  });
});

describe("M-93 · an unrecognized envelope reaches MANUAL_REVIEW", () => {
  const unrecognized: AuthorityLookupResult = {
    status: "provider_unavailable",
    reason: "unrecognized_envelope",
  };

  it("never becomes VERIFIED", () => {
    const r = assessCarrierRisk({
      lookup: unrecognized,
      identity: null,
      creditConfigured: false,
    });
    expect(r.decision).not.toBe("eligible_to_continue");
  });

  it("never becomes NOT_ELIGIBLE automatically", () => {
    // The carrier did nothing wrong. Our parser did.
    const r = assessCarrierRisk({
      lookup: unrecognized,
      identity: null,
      creditConfigured: false,
    });
    expect(r.decision).not.toBe("not_eligible");
  });

  it("routes to MANUAL_REVIEW with PROVIDER_UNAVAILABLE", () => {
    const r = assessCarrierRisk({
      lookup: unrecognized,
      identity: null,
      creditConfigured: false,
    });
    expect(r.decision).toBe("manual_review");
    expect(r.manualReviewRequired).toBe(true);
    expect(r.reasonCodes).toContain("PROVIDER_UNAVAILABLE");
  });
});

describe("M-93 · the adapter wires the outcomes correctly", () => {
  const SRC = readFileSync(
    "src/lib/carrier-authority/fmcsa-qcmobile.ts",
    "utf8",
  );
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(
    /^[ \t]*\/\/.*$/gm,
    " ",
  );

  it("unrecognized returns provider_unavailable with the reason code", () => {
    expect(code).toMatch(
      /status: "provider_unavailable", reason: "unrecognized_envelope"/,
    );
  });

  it("not_found is reachable ONLY from the absent branch", () => {
    // If `not_found` ever appears outside an `absent` guard again, the
    // ambiguity is back.
    const notFoundSites = code.match(/status: "not_found"/g) ?? [];
    // One in lookupByUsdot/lookupByDocket guard clauses (malformed input) ×2,
    // and exactly one in the response path.
    expect(notFoundSites.length).toBe(3);
    const absentBlock = code.slice(
      code.indexOf('extraction.kind === "absent"'),
      code.indexOf("const retrievalDate"),
    );
    expect(absentBlock).toContain('status: "not_found"');
  });

  it("logs only safe diagnostics on an unrecognized envelope", () => {
    const log = code.slice(
      code.indexOf("fmcsa.unrecognized_envelope"),
      code.indexOf(
        'return { status: "provider_unavailable", reason: "unrecognized_envelope" }',
      ),
    );
    // Allowed.
    expect(log).toContain("provider");
    expect(log).toContain("httpStatus");
    expect(log).toContain("topLevelKeys");
    expect(log).toContain("reason");
    expect(log).toContain("at:");
    // Forbidden: the body, any field value, the URL (it carries the key).
    expect(log).not.toMatch(/rawBody/);
    expect(log).not.toMatch(/\burl\b/);
    expect(log).not.toMatch(/webKey/);
    expect(log).not.toMatch(/JSON\.stringify\(body\)/);
    expect(log).not.toMatch(/carrier\./);
  });

  it("never logs the credential anywhere in the module", () => {
    expect(code).not.toMatch(/console\.[a-z]+\([^)]*\$\{webKey\}/);
    expect(code).not.toMatch(/console\.[a-z]+\([^)]*process\.env/);
    expect(code).not.toMatch(/console\.[a-z]+\([^)]*\burl\b/);
  });
});
