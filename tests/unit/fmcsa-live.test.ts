import { describe, expect, it } from "vitest";
import { fmcsaQcMobileProvider } from "@/lib/carrier-authority/fmcsa-qcmobile";
import { compareIdentity } from "@/lib/carrier-authority/identity-match";
import { assessCarrierRisk } from "@/lib/carrier-authority/risk-engine";

/**
 * M-93 — LIVE FMCSA validation.
 *
 * Exercises the REAL adapter against the REAL QCMobile API. It is not a mock:
 * a mock would prove our own fixtures parse, which is not the question. The
 * question is whether FMCSA's actual response shape survives our
 * normalisation, and only a live call answers it.
 *
 * ── HOW TO RUN ───────────────────────────────────────────────────────────
 *
 *   FMCSA_WEBKEY=… npx vitest run tests/unit/fmcsa-live.test.ts
 *
 * Optionally pin the carrier under test:
 *
 *   FMCSA_TEST_USDOT=76830 FMCSA_WEBKEY=… npx vitest run …
 *
 * Without `FMCSA_WEBKEY` every live case SKIPS — loudly, via the guard test
 * below, so a green run can never be mistaken for a passing live validation.
 * A suite that silently skips its only real assertions is worse than no suite.
 *
 * ── WHAT IT ASSERTS, AND WHY NOT MORE ────────────────────────────────────
 *
 * SHAPE, not content. Asserting `legalName === "FEDEX FREIGHT"` would pin a
 * fact about a third party that can change without notice and that this repo
 * has no business asserting. What must hold is that the USDOT we asked for is
 * the USDOT we got back, that booleans are boolean-or-null rather than the
 * string "Y", and that dates are ISO — the normalisation contract.
 *
 * ── THE CREDENTIAL ───────────────────────────────────────────────────────
 *
 * Never printed. Nothing here logs the key, the URL that carries it, or the
 * raw response body. Failures report the STATUS and the normalised record,
 * both of which are safe.
 */

const WEBKEY_PRESENT = Boolean(process.env.FMCSA_WEBKEY);

/**
 * LIVE FIXTURE — USDOT 21800.
 *
 * The previous value, 76830, was never a real carrier. It was picked as a
 * throwaway probe URL when checking that the QCMobile host answered at all,
 * and then reused here as a fixture without anyone verifying it identified
 * anything. FMCSA's own public SAFER lookup returns RECORD NOT FOUND for it.
 *
 * 21800 was verified against SAFER before being pinned: a real, long-
 * established interstate carrier that also carries a DBA, so it exercises the
 * populated path rather than the sparse one.
 *
 * Only the NUMBER is pinned. The company name, its operating status and its MC
 * number are third-party facts that can change without notice, and this repo
 * has no business asserting them — see the shape-only assertions below.
 */
const TEST_USDOT = process.env.FMCSA_TEST_USDOT ?? "21800";

describe("M-93 · FMCSA live validation", () => {
  it("reports whether the credential is available to this runtime", () => {
    // Always runs. This is the test that stops a skipped live suite from
    // reading as a passing one.
    if (!WEBKEY_PRESENT) {
      console.warn(
        "[fmcsa-live] FMCSA_WEBKEY is NOT set in this runtime — every live " +
          "case below is SKIPPED. This run does NOT validate the FMCSA " +
          "integration. Vercel environment variables are not present in a " +
          "local shell; use `vercel env pull` or pass the key inline.",
      );
    }
    // Name only. The value is never read into an assertion or a message.
    expect(typeof WEBKEY_PRESENT).toBe("boolean");
  });

  it("isConfigured() agrees with the environment", () => {
    expect(fmcsaQcMobileProvider.isConfigured()).toBe(WEBKEY_PRESENT);
  });

  it.skipIf(!WEBKEY_PRESENT)(
    "retrieves and normalises a real carrier by USDOT",
    async () => {
      const result = await fmcsaQcMobileProvider.lookupByUsdot(TEST_USDOT);

      if (result.status !== "found") {
        throw new Error(
          `Expected 'found' for USDOT ${TEST_USDOT}, got '${result.status}'` +
            (result.status === "provider_unavailable"
              ? ` (reason: ${result.reason})`
              : ""),
        );
      }

      const r = result.record;
      // Safe to print: normalised public registration data, no credential.
      console.info("[fmcsa-live] normalised record:", {
        usdotNumber: r.usdotNumber,
        mcNumber: r.mcNumber,
        legalName: r.legalName,
        dbaName: r.dbaName,
        allowedToOperate: r.allowedToOperate,
        outOfService: r.outOfService,
        outOfServiceDate: r.outOfServiceDate,
        sourceRetrievedAt: r.sourceRetrievedAt,
        rawResponseSha256: `${r.rawResponseSha256?.slice(0, 12)}…`,
      });

      // The record we got is the record we asked for.
      expect(r.usdotNumber).toBe(
        TEST_USDOT.replace(/\D+/g, "").replace(/^0+/, ""),
      );
      expect(r.providerRecordId).toBe(r.usdotNumber);

      // Normalisation contract.
      expect(typeof r.legalName).toBe("string");
      expect(r.legalName!.length).toBeGreaterThan(0);
      expect([true, false, null]).toContain(r.allowedToOperate);
      expect([true, false, null]).toContain(r.outOfService);
      if (r.mcNumber !== null) expect(r.mcNumber).toMatch(/^\d+$/);
      if (r.dbaName !== null) expect(typeof r.dbaName).toBe("string");
      if (r.outOfServiceDate !== null) {
        expect(r.outOfServiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      // Freshness and provenance.
      expect(typeof r.sourceRetrievedAt).toBe("string");
      expect(r.rawResponseSha256).toMatch(/^[a-f0-9]{64}$/);
    },
    30_000,
  );

  it.skipIf(!WEBKEY_PRESENT)(
    "an unknown carrier is NOT_FOUND and never becomes verified",
    async () => {
      // A USDOT far outside the issued range.
      const result = await fmcsaQcMobileProvider.lookupByUsdot("999999999");
      expect(["not_found", "provider_unavailable"]).toContain(result.status);
      expect(result.status).not.toBe("found");

      const risk = assessCarrierRisk({
        lookup: result,
        identity: null,
        creditConfigured: false,
      });
      // Whichever it was, it must never be an approval.
      expect(risk.decision).not.toBe("eligible_to_continue");
    },
    30_000,
  );

  it.skipIf(!WEBKEY_PRESENT)(
    "identity matching runs against the live record",
    async () => {
      const result = await fmcsaQcMobileProvider.lookupByUsdot(TEST_USDOT);
      // NO early return. The previous version did `if (status !== "found")
      // return;`, so when the fixture USDOT turned out not to exist this test
      // reported PASS while asserting nothing at all — 5 of 6 green, and one
      // of the five was hollow. A live check that silently succeeds when the
      // lookup failed is worse than no live check.
      if (result.status !== "found") {
        throw new Error(
          `identity matching needs a live record; lookup returned '${result.status}'`,
        );
      }

      const authoritativeName = result.record.legalName ?? "";

      // Same name, differently punctuated → matches.
      const same = compareIdentity(
        {
          legalName: `${authoritativeName.toLowerCase()}, l.l.c.`.replace(
            /\bllc\b,?\s*l\.l\.c\./i,
            "l.l.c.",
          ),
          usdotNumber: TEST_USDOT,
          mcNumber: result.record.mcNumber,
        },
        result.record,
      );
      expect(["exact", "normalized"]).toContain(same.dotMatch);

      // A materially different business → mismatch, and never an approval.
      const different = compareIdentity(
        {
          legalName: "Completely Unrelated Freight Systems LLC",
          usdotNumber: TEST_USDOT,
          mcNumber: result.record.mcNumber,
        },
        result.record,
      );
      expect(different.nameMatch).toBe("mismatch");

      const risk = assessCarrierRisk({
        lookup: result,
        identity: different,
        creditConfigured: false,
      });
      expect(risk.decision).toBe("manual_review");
      expect(risk.reasonCodes).toContain("LEGAL_NAME_MISMATCH");
    },
    30_000,
  );

  it.skipIf(!WEBKEY_PRESENT)(
    "malformed input fails safely without reaching the provider",
    async () => {
      for (const bad of ["", "abc", "0", "---", "MC-"]) {
        const r = await fmcsaQcMobileProvider.lookupByUsdot(bad);
        expect(r.status).toBe("not_found");
        expect(r.status).not.toBe("found");
      }
    },
    30_000,
  );
});
