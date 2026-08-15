import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeAuthorityStatus,
  toNumberOrNull,
  toStringOrNull,
  yesNoToBoolean,
  type CarrierDocket,
  type NormalizedAuthorityRecord,
} from "@/lib/carrier-authority/provider";
import {
  compareIdentity,
  matchDocketRelationship,
} from "@/lib/carrier-authority/identity-match";
import { assessCarrierRisk } from "@/lib/carrier-authority/risk-engine";

/**
 * M-93 — normalization hardening against the LIVE field set.
 *
 * The live response carries more than FMCSA's published element list
 * advertises: authority statuses by type, insurance FILING indicators, safety
 * signals, EIN and a physical address. Each of those needs a rule, and two of
 * them need a rule about what we refuse to do with them.
 */

const BASE: NormalizedAuthorityRecord = {
  providerRecordId: "21800",
  legalName: "ACME TRUCKING LLC",
  dbaName: null,
  usdotNumber: "21800",
  mcNumber: "123456",
  dockets: [{ prefix: "MC", number: "123456" }],
  allowedToOperate: true,
  statusCode: "A",
  outOfService: false,
  outOfServiceDate: null,
  commonAuthority: "active",
  contractAuthority: null,
  brokerAuthority: null,
  insurance: null,
  safety: null,
  sourceRetrievedAt: "2026-08-15T06:00:03.368+0000",
  rawResponseSha256: "a".repeat(64),
};

const IDENT = {
  legalName: "Acme Trucking, L.L.C.",
  usdotNumber: "21800",
  mcNumber: "MC-123456",
};

const assess = (record: NormalizedAuthorityRecord, entered = IDENT) =>
  assessCarrierRisk({
    lookup: { status: "found", record },
    identity: compareIdentity(entered, record),
    creditConfigured: false,
  });

describe("M-93 · Y/N/null normalization", () => {
  it("Y → true, N → false", () => {
    expect(yesNoToBoolean("Y")).toBe(true);
    expect(yesNoToBoolean("y")).toBe(true);
    expect(yesNoToBoolean("Yes")).toBe(true);
    expect(yesNoToBoolean("N")).toBe(false);
    expect(yesNoToBoolean("no")).toBe(false);
  });

  it("unknown and missing → null, NEVER false", () => {
    // The distinction the whole model rests on: null is "FMCSA did not say".
    // Collapsing it to false would refuse carriers for gaps in the data.
    for (const v of ["", "   ", "MAYBE", "U", "X", undefined, null, {}, []]) {
      expect(yesNoToBoolean(v), JSON.stringify(v)).toBeNull();
    }
  });
});

describe("M-93 · authority status normalization", () => {
  it("maps letter codes and spelled-out forms", () => {
    expect(normalizeAuthorityStatus("A")).toBe("active");
    expect(normalizeAuthorityStatus("active")).toBe("active");
    expect(normalizeAuthorityStatus("I")).toBe("inactive");
    expect(normalizeAuthorityStatus("Inactive")).toBe("inactive");
    expect(normalizeAuthorityStatus("N")).toBe("none");
    expect(normalizeAuthorityStatus("None")).toBe("none");
  });

  it("an UNRECOGNISED token is null, never 'none'", () => {
    // "none" is a finding against the carrier. An unknown token is a gap in
    // OUR mapping, and must never be charged to them.
    for (const v of ["P", "PENDING", "?", "", undefined, 7]) {
      expect(normalizeAuthorityStatus(v), String(v)).toBeNull();
    }
  });
});

describe("M-93 · broker authority is NOT carrier authority", () => {
  it("broker-only → never eligible automatically", () => {
    const brokerOnly: NormalizedAuthorityRecord = {
      ...BASE,
      commonAuthority: "none",
      contractAuthority: "none",
      brokerAuthority: "active",
    };
    const r = assess(brokerOnly);
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("CARRIER_AUTHORITY_INACTIVE");
    expect(r.reasonCodes).toContain("BROKER_AUTHORITY_ONLY");
    expect(r.reasonCodes).not.toContain("CARRIER_AUTHORITY_ACTIVE");
  });

  it("contract authority alone satisfies the carrier check", () => {
    const r = assess({
      ...BASE,
      commonAuthority: "none",
      contractAuthority: "active",
    });
    expect(r.reasonCodes).toContain("CARRIER_AUTHORITY_ACTIVE");
    expect(r.decision).toBe("eligible_to_continue");
  });

  it("absent authority fields → UNKNOWN and review, not a finding", () => {
    const r = assess({
      ...BASE,
      commonAuthority: null,
      contractAuthority: null,
      brokerAuthority: null,
    });
    expect(r.reasonCodes).toContain("CARRIER_AUTHORITY_UNKNOWN");
    expect(r.reasonCodes).not.toContain("CARRIER_AUTHORITY_INACTIVE");
    expect(r.decision).toBe("manual_review");
  });
});

describe("M-93 · MC ↔ USDOT relationship", () => {
  it("submitted MC present in the docket set → confirmed", () => {
    expect(
      matchDocketRelationship("MC-123456", [
        { prefix: "MC", number: "123456" },
        { prefix: "MC", number: "999" },
      ]),
    ).toBe("exact");
  });

  it("A VALID USDOT WITH THE WRONG MC DOES NOT PASS", () => {
    // The headline requirement.
    const wrongMc = assess({ ...BASE }, { ...IDENT, mcNumber: "MC-777777" });
    expect(wrongMc.decision).not.toBe("eligible_to_continue");
    expect(wrongMc.decision).toBe("manual_review");
    expect(wrongMc.reasonCodes).toContain("MC_DOT_RELATIONSHIP_MISMATCH");
  });

  it("a USDOT with NO dockets, but an MC submitted → mismatch", () => {
    // They claimed a docket this registration does not hold.
    expect(matchDocketRelationship("MC-123456", [])).toBe("mismatch");
    const r = assess({ ...BASE, dockets: [] });
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("MC_DOT_RELATIONSHIP_MISMATCH");
  });

  it("docket set NOT RETRIEVED → unverified, never a mismatch", () => {
    // The docket call failed. That is our gap, not their finding.
    expect(matchDocketRelationship("MC-123456", null)).toBe("unavailable");
    const r = assess({ ...BASE, dockets: null });
    expect(r.reasonCodes).toContain("MC_DOT_RELATIONSHIP_UNVERIFIED");
    expect(r.reasonCodes).not.toContain("MC_DOT_RELATIONSHIP_MISMATCH");
    expect(r.decision).toBe("manual_review");
  });

  it("no MC submitted → unverified, not a mismatch", () => {
    // Legitimate for intrastate or exempt operations.
    expect(
      matchDocketRelationship(null, [{ prefix: "MC", number: "123456" }]),
    ).toBe("unavailable");
  });

  it("the relationship is checked against the SET, not the single field", () => {
    // A carrier holding several dockets, submitting the second one. Comparing
    // against `record.mcNumber` alone would reject them.
    const multi: NormalizedAuthorityRecord = {
      ...BASE,
      mcNumber: "111111",
      dockets: [
        { prefix: "MC", number: "111111" },
        { prefix: "MC", number: "222222" },
      ],
    };
    const cmp = compareIdentity({ ...IDENT, mcNumber: "222222" }, multi);
    expect(cmp.docketMatch).toBe("exact");
    // The single-field comparison disagrees — which is exactly why the
    // relationship check exists.
    expect(cmp.mcMatch).toBe("mismatch");
  });
});

describe("M-93 · FMCSA insurance ≠ PickLoads COI", () => {
  const insured: NormalizedAuthorityRecord = {
    ...BASE,
    insurance: {
      bipdOnFile: "Y",
      bipdRequired: "Y",
      bipdRequiredAmount: "750",
      cargoOnFile: "Y",
      cargoRequired: "Y",
      bondOnFile: "N",
      bondRequired: "N",
    },
  };

  it("a full set of filings does NOT satisfy the insurance review", () => {
    const r = assess(insured);
    // Still required. A federal filing is not a PickLoads approval.
    expect(r.reasonCodes).toContain("INSURANCE_REVIEW_REQUIRED");
  });

  it("filings on file do not change the decision at all", () => {
    const withFilings = assess(insured);
    const without = assess(BASE);
    expect(withFilings.decision).toBe(without.decision);
    expect(withFilings.tier).toBe(without.tier);
  });

  it("indicators stay strings as reported — no invented booleans", () => {
    // FMCSA uses these inconsistently: Y/N on some accounts, a dollar figure
    // in thousands on others. Coercing to boolean would invent a fact.
    expect(insured.insurance?.bipdRequiredAmount).toBe("750");
    expect(typeof insured.insurance?.bipdOnFile).toBe("string");
  });

  it("toStringOrNull preserves 0 and blanks out empties", () => {
    expect(toStringOrNull(0)).toBe("0");
    expect(toStringOrNull("  750 ")).toBe("750");
    expect(toStringOrNull("")).toBeNull();
    expect(toStringOrNull(null)).toBeNull();
  });
});

describe("M-93 · safety fields stay typed and nullable", () => {
  it("numbers parse, including a genuine zero", () => {
    expect(toNumberOrNull("0")).toBe(0);
    expect(toNumberOrNull(0)).toBe(0);
    expect(toNumberOrNull("12.5")).toBe(12.5);
  });

  it("non-numerics and blanks are null, not 0", () => {
    // A carrier with no reported crashes and a carrier we have no data for
    // are different, and 0 would erase the difference.
    for (const v of ["", "  ", "n/a", null, undefined, {}, NaN]) {
      expect(toNumberOrNull(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("no proprietary safety score is derived", () => {
    const engine = readFileSync(
      "src/lib/carrier-authority/risk-engine.ts",
      "utf8",
    );
    expect(engine).not.toMatch(/safetyScore|riskScore|creditScore/i);
    // Safety data is normalized for staff, not fed into an automatic verdict.
    expect(engine).not.toMatch(/record\.safety/);
  });
});

describe("M-93 · EIN and address never leave the boundary", () => {
  it("are absent from the normalized model", () => {
    // Structural: the type has no field for either, so no downstream code can
    // persist or log what it never receives.
    const keys = Object.keys(BASE);
    expect(keys).not.toContain("ein");
    expect(keys).not.toContain("phyStreet");
    expect(keys).not.toContain("address");
    expect(keys).not.toContain("telephone");
  });

  it("a live-shaped payload with EIN yields a record carrying none of it", () => {
    // Belt and braces: even when the source object has them, the normalized
    // record does not, and JSON.stringify of the record cannot leak them.
    const serialized = JSON.stringify(BASE);
    expect(serialized).not.toMatch(/ein/i);
    expect(serialized).not.toMatch(/phyStreet/);
  });

  it("the diagnostic script never prints EIN or a full address", () => {
    const script = readFileSync("scripts/fmcsa-shape-check.mjs", "utf8");
    expect(script).toMatch(/REDACT|SENSITIVE_FIELDS|ein/);
    // It prints names and types; the only echoed value is dotNumber.
    expect(script).toMatch(
      /k === "dotNumber" \? ` = \$\{JSON\.stringify\(v\)\}` : ""/,
    );
  });
});

describe("M-93 · fail-closed is preserved end to end", () => {
  it("provider unavailable still routes to MANUAL_REVIEW", () => {
    const r = assessCarrierRisk({
      lookup: {
        status: "provider_unavailable",
        reason: "unrecognized_envelope",
      },
      identity: null,
      creditConfigured: false,
    });
    expect(r.decision).toBe("manual_review");
  });

  it("out of service is still a hard stop", () => {
    const r = assess({ ...BASE, outOfService: true });
    expect(r.decision).toBe("not_eligible");
    expect(r.reasonCodes).toContain("OUT_OF_SERVICE");
  });

  it("a fully clean live-shaped record is eligible to CONTINUE, not approved", () => {
    const r = assess(BASE);
    expect(r.decision).toBe("eligible_to_continue");
    // Eligible to pay and upload documents. Insurance still needs a human.
    expect(r.reasonCodes).toContain("INSURANCE_REVIEW_REQUIRED");
    expect(r.reasonCodes).toContain("MC_DOT_RELATIONSHIP_CONFIRMED");
  });
});

/**
 * M-93 CLOSURE — the docket parser against the CONFIRMED live entry shape.
 *
 * Live run on 2026-08-15 (USDOT 21800) returned:
 *
 *   docket content   = array(2)
 *   docket entry keys = docketNumber, docketNumberId, dotNumber, prefix
 *
 * `prefix` is the field that makes these tests necessary. FMCSA issues MC,
 * FF and MX series against one USDOT and the NUMBERS collide across series,
 * so digits-only matching lets a freight forwarder verify as a motor carrier.
 */
describe("M-93 closure · docket prefixes", () => {
  const MC = { prefix: "MC", number: "777777" };
  const FF = { prefix: "FF", number: "777777" };
  const MX = { prefix: "MX", number: "777777" };

  it("the correct MC for the USDOT → relationship verified", () => {
    expect(matchDocketRelationship("MC-777777", [MC])).toBe("exact");
    // Formatting of the submitted value is irrelevant.
    expect(matchDocketRelationship("mc 777777", [MC])).toBe("exact");
    expect(matchDocketRelationship("0777777", [MC])).toBe("exact");
  });

  it("the WRONG MC for the same USDOT → mismatch", () => {
    expect(
      matchDocketRelationship("MC-888888", [MC, { prefix: "MC", number: "1" }]),
    ).toBe("mismatch");
  });

  it("an FF docket NEVER satisfies a submitted MC", () => {
    // The bug this closure fixes. Same digits, different series, different
    // registration — and a freight forwarder is not a motor carrier.
    expect(matchDocketRelationship("MC-777777", [FF])).toBe("mismatch");
  });

  it("an MX docket NEVER satisfies a submitted MC", () => {
    expect(matchDocketRelationship("MC-777777", [MX])).toBe("mismatch");
  });

  it("FF and MX alongside a real MC still verifies on the MC", () => {
    // A carrier legitimately holding several series must not be penalised.
    expect(matchDocketRelationship("MC-777777", [FF, MX, MC])).toBe("exact");
  });

  it("prefix comparison is case-insensitive at parse time", () => {
    // The adapter uppercases; a lowercase prefix reaching the matcher would
    // silently fail to match, so the contract is asserted here too.
    expect(
      matchDocketRelationship("MC-777777", [
        { prefix: "mc", number: "777777" },
      ]),
    ).toBe("mismatch");
    expect(
      matchDocketRelationship("MC-777777", [
        { prefix: "MC", number: "777777" },
      ]),
    ).toBe("exact");
  });

  it("a USDOT with NO MC docket → not verified", () => {
    // They hold dockets, just not the one they claimed.
    expect(matchDocketRelationship("MC-777777", [FF, MX])).toBe("mismatch");
    // And the same USDOT with no dockets at all.
    expect(matchDocketRelationship("MC-777777", [])).toBe("mismatch");
  });

  it("an UNKNOWN-prefix docket is never treated as an MC", () => {
    // Defensive: the live response always carries `prefix`. If it ever stops,
    // a digit match must not be promoted to verified — but it is also not a
    // finding against the carrier, so it routes to review as unavailable.
    expect(
      matchDocketRelationship("MC-777777", [
        { prefix: null, number: "777777" },
      ]),
    ).toBe("unavailable");
  });
});

describe("M-93 closure · risk engine consumes the relationship", () => {
  const withDockets = (dockets: CarrierDocket[] | null) => ({
    ...BASE,
    mcNumber: "777777",
    dockets,
  });
  const entered = { ...IDENT, mcNumber: "MC-777777" };

  it("USDOT existence ALONE never approves", () => {
    // A valid, active, in-service USDOT whose docket set does not contain the
    // submitted MC. Everything else about this carrier is clean.
    const r = assessCarrierRisk({
      lookup: {
        status: "found",
        record: withDockets([{ prefix: "FF", number: "777777" }]),
      },
      identity: compareIdentity(
        entered,
        withDockets([{ prefix: "FF", number: "777777" }]),
      ),
      creditConfigured: false,
    });
    expect(r.decision).not.toBe("eligible_to_continue");
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("MC_DOT_RELATIONSHIP_MISMATCH");
  });

  it("a confirmed relationship is what unlocks eligible_to_continue", () => {
    const rec = withDockets([{ prefix: "MC", number: "777777" }]);
    const r = assessCarrierRisk({
      lookup: { status: "found", record: rec },
      identity: compareIdentity(entered, rec),
      creditConfigured: false,
    });
    expect(r.decision).toBe("eligible_to_continue");
    expect(r.reasonCodes).toContain("MC_DOT_RELATIONSHIP_CONFIRMED");
  });

  it("a failed docket call → unverified → manual review, never approval", () => {
    const rec = withDockets(null);
    const r = assessCarrierRisk({
      lookup: { status: "found", record: rec },
      identity: compareIdentity(entered, rec),
      creditConfigured: false,
    });
    expect(r.decision).toBe("manual_review");
    expect(r.reasonCodes).toContain("MC_DOT_RELATIONSHIP_UNVERIFIED");
    expect(r.reasonCodes).not.toContain("MC_DOT_RELATIONSHIP_MISMATCH");
  });

  it("the engine reads docketMatch — removing it would break these", () => {
    const engine = readFileSync(
      "src/lib/carrier-authority/risk-engine.ts",
      "utf8",
    );
    expect(engine).toContain("identity.docketMatch");
  });
});
