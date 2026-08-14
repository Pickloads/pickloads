import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_FIELD_API_IDS,
  buildAgreementFields,
} from "@/lib/agreements/send";
import { MUST_NOT_BE_CARRIER_EDITABLE } from "@/lib/signwell";

/**
 * M-92 final — exactly ONE active Dispatch Agreement provider.
 *
 * ── WHAT THIS PREVENTS ───────────────────────────────────────────────────
 *
 * Onboarding used to auto-send a Dropbox Sign agreement on account creation.
 * SignWell is now the single provider, and its send is explicit. If the
 * Dropbox call comes back — or a SignWell auto-send is added alongside it —
 * a carrier who finishes onboarding and then presses "Send me the agreement"
 * receives TWO dispatch agreements from two vendors, both presented as the
 * agreement, both racing to stamp `carriers.agreement_signed_at`.
 *
 * Whichever landed first would win and the other would silently no-op, so the
 * carrier's executed contract would be decided by email delivery timing. That
 * is the failure this file exists to make impossible to reintroduce quietly.
 *
 * These are source-shape assertions. The alternative — running the onboarding
 * action against a live database and two mocked vendors — would test the
 * mocks. What matters is that the CALL is not there.
 */

const ONBOARDING = "src/app/actions/onboarding.tsx";

function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

describe("M-92 · onboarding cannot generate two agreements", () => {
  it("onboarding never calls the Dropbox Sign send", () => {
    const src = code(ONBOARDING);
    expect(src).not.toContain("sendAgreementSignatureRequest");
    // Not even imported — an unused import is an invitation.
    expect(src).not.toMatch(/from "@\/lib\/esign"/);
  });

  it("onboarding never calls the SignWell send either", () => {
    // Per M-92 §8 the SignWell send stays EXPLICIT until the workflow is
    // owner-approved. Auto-sending a contract as a side effect of account
    // creation is not a default to restore without that decision.
    const src = code(ONBOARDING);
    expect(src).not.toContain("sendDispatchAgreement");
    expect(src).not.toMatch(/from "@\/lib\/agreements\/send"/);
  });

  it("onboarding does not tell the carrier an agreement was sent", () => {
    // The email said "your agreement is on its way". Nothing is on its way.
    const src = code(ONBOARDING);
    expect(src).not.toContain("buildAgreementSentEmail");
  });

  it("exactly one module creates a Dispatch Agreement", () => {
    const files = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    const dropboxSenders = files.filter(
      (f) =>
        f !== "src/lib/esign.ts" &&
        code(f).includes("sendAgreementSignatureRequest"),
    );
    const signwellSenders = files.filter(
      (f) =>
        f !== "src/lib/signwell.ts" &&
        f !== "src/lib/agreements/send.ts" &&
        code(f).includes("createAgreementFromTemplate"),
    );

    // Dropbox Sign retains exactly ONE caller — the carrier-portal re-send for
    // an agreement that ALREADY went out through it. That is servicing history,
    // not creating a competing agreement.
    expect(dropboxSenders).toEqual(["src/app/actions/carrier-portal.ts"]);
    // SignWell's creator is reached only through sendDispatchAgreement().
    expect(signwellSenders).toEqual([]);
  });

  it("the Dropbox Sign integration is still present and still processes events", () => {
    // Disabled ≠ deleted. Requirement: do not remove the integration, do not
    // touch historical records. An in-flight Dropbox request signed tomorrow
    // must still complete.
    expect(() => readFileSync("src/lib/esign.ts", "utf8")).not.toThrow();
    expect(() =>
      readFileSync("src/app/api/esign/webhook/route.ts", "utf8"),
    ).not.toThrow();
    const webhook = code("src/app/api/esign/webhook/route.ts");
    expect(webhook).toContain("agreement_signed_at");
  });
});

describe("M-92 · endpoint is the full path, never truncated", () => {
  it("resolves to the documented create-from-template URL", () => {
    const src = readFileSync("src/lib/signwell.ts", "utf8");
    expect(src).toContain('const API_BASE = "https://www.signwell.com/api/v1"');
    expect(src).toContain("`${API_BASE}/document_templates/documents`");
  });

  it("no source or doc references a truncated form", () => {
    const files = [
      ...execSync('git ls-files "src/**/*.ts" "docs/**/*.md"', {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      // `/document_templates/{id}/documents` and a bare `/document_templates/`
      // used as THE send endpoint are both wrong.
      if (/document_templates\/\{id\}\/documents/.test(text)) {
        offenders.push(`${f}: /document_templates/{id}/documents`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("M-92 · countersigner fails closed in production", () => {
  const SEND = "src/lib/agreements/send.ts";

  it("requires BOTH variables when running in production", () => {
    const src = code(SEND);
    expect(src).toContain("SIGNWELL_COUNTERSIGNER_EMAIL");
    expect(src).toContain("SIGNWELL_COUNTERSIGNER_NAME");
    expect(src).toMatch(/if \(isProduction\(\)\)/);
    expect(src).toMatch(/if \(!email \|\| !name\)/);
  });

  it("does not fall back to EMAIL_INTERNAL_TO in production", () => {
    const src = code(SEND);
    const prodBranch = src.slice(
      src.indexOf("if (isProduction())"),
      src.indexOf("const fallbackEmail"),
    );
    expect(prodBranch.length).toBeGreaterThan(0);
    expect(prodBranch).not.toContain("EMAIL_INTERNAL_TO");
  });

  it("never hardcodes a person's name or address", () => {
    const src = readFileSync(SEND, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(src).not.toMatch(/Emmanuel/i);
    expect(src).not.toMatch(/@pickloads\.com/);
  });

  it("logs the variable NAMES, never the values", () => {
    const src = code(SEND);
    expect(src).not.toMatch(/console\.error\([^)]*\$\{email\}/);
    expect(src).not.toMatch(/console\.error\([^)]*\$\{name\}/);
  });
});

describe("M-92 · template api_id contract", () => {
  it("matches the owner's checklist exactly, including dispatch_fee", () => {
    // The checklist says `dispatch_fee`, not `dispatch_fee_pct`. A mismatched
    // api_id is silent: SignWell accepts the request and leaves it blank.
    expect(AGREEMENT_FIELD_API_IDS).toEqual([
      "carrier_legal_name",
      "carrier_dba",
      "carrier_mc_number",
      "carrier_usdot_number",
      "carrier_rep_name",
      "carrier_rep_title",
      "carrier_address",
      "carrier_city",
      "carrier_state",
      "carrier_zip",
      "carrier_phone",
      "carrier_email",
      "dispatch_fee",
      "effective_date",
    ]);
  });

  it("the diagnostic script checks the same list the code sends", () => {
    // Two hand-maintained lists that drift would make the check pass while
    // the send is wrong — the exact failure it exists to catch.
    const script = readFileSync("scripts/signwell-template-check.mjs", "utf8");
    for (const id of AGREEMENT_FIELD_API_IDS) {
      expect(script).toContain(`"${id}"`);
    }
    for (const id of MUST_NOT_BE_CARRIER_EDITABLE) {
      expect(script).toContain(`"${id}"`);
    }
  });

  it("carrier_state reads home_state — the only state actually collected", () => {
    const fields = buildAgreementFields({
      companyName: "Acme",
      dba: null,
      mcNumber: null,
      dotNumber: null,
      repName: null,
      repTitle: null,
      addressLine1: null,
      city: null,
      homeState: "NJ",
      postalCode: null,
      phone: null,
      email: null,
      dispatchFeePct: 5,
      effectiveDate: "2026-08-14",
    });
    expect(fields.carrier_state).toBe("NJ");
    expect(fields.dispatch_fee).toBe("5%");
  });

  it("no duplicate mailing_state column was created", () => {
    // home_state already exists and is populated. A second state column would
    // be a duplicate nothing ever writes.
    const migration = readFileSync(
      "supabase/migrations/0031_signature_requests.sql",
      "utf8",
    );
    expect(migration).not.toMatch(/add column mailing_state/);
  });

  it("the address fields that ARE new have no equivalent in the schema", () => {
    // Audited: the only other city/state columns belong to shipment stops.
    const send = code("src/lib/agreements/send.ts");
    expect(send).toContain("address_line1");
    expect(send).toContain("postal_code");
  });
});
