import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_FIELD_API_IDS,
  buildAgreementFields,
} from "@/lib/agreements/send";
import {
  ACTIVE_SIGNATURE_STATUSES,
  EVENT_TO_STATUS,
  isTerminal,
  SIGNATURE_STATUSES,
  STATUS_LABEL,
  statusForSignedEvent,
  STATUS_TIMESTAMP_COLUMN,
} from "@/lib/agreements/status";
import { SIGNWELL_PLACEHOLDERS } from "@/lib/signwell";

/**
 * M-92 — SignWell send side.
 *
 * The network call is not exercised here; the two things worth pinning are
 * the REQUEST WE BUILD (a wrong `api_id` or a missing `test_mode` is silent at
 * runtime — SignWell accepts the request and the field simply stays empty) and
 * the AUTHORIZATION SHAPE (which is structural and can be asserted from
 * source without standing up a database).
 */

function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

const SEND_LIB = "src/lib/agreements/send.ts";
const ACTION = "src/app/actions/agreements.ts";
const CLIENT = "src/lib/signwell.ts";

describe("M-92 · the request we send to SignWell", () => {
  it("uses test_mode: true", () => {
    // Owner instruction for this phase. A test-mode document is not legally
    // executed, so flipping this is a business decision, not a cleanup.
    expect(code(CLIENT)).toMatch(/test_mode:\s*true/);
  });

  it("targets the documented create-from-template endpoint", () => {
    expect(code(CLIENT)).toContain("/document_templates/documents");
    expect(code(CLIENT)).toContain('"X-Api-Key"');
  });

  it("preserves signing order — carrier first, PickLoads second", () => {
    const src = code(CLIENT);
    expect(src).toMatch(/apply_signing_order:\s*true/);
    const carrierAt = src.indexOf(SIGNWELL_PLACEHOLDERS.carrier);
    const pickloadsAt = src.indexOf(SIGNWELL_PLACEHOLDERS.pickloads);
    expect(carrierAt).toBeGreaterThan(-1);
    expect(pickloadsAt).toBeGreaterThan(-1);
    // Recipient "1" is declared before recipient "2", and the carrier is 1.
    expect(carrierAt).toBeLessThan(pickloadsAt);
  });

  it("asks SignWell to actually email both recipients", () => {
    // send_email defaults to FALSE. A signature request nobody is told about
    // is indistinguishable from one that was never sent.
    const sends = code(CLIENT).match(/send_email:\s*true/g) ?? [];
    expect(sends.length).toBe(2);
  });

  it("carries metadata.carrier_id and agreement_type", () => {
    const src = code(CLIENT);
    expect(src).toMatch(/carrier_id:\s*args\.carrierId/);
    expect(src).toMatch(/agreement_type:\s*"dispatch_agreement"/);
  });

  it("never sends a blank value for a field it has no data for", () => {
    // An empty string stamps the contract with "answered: nothing". Omitting
    // the field leaves the signer something to fill in.
    const fields = buildAgreementFields({
      companyName: "Acme Trucking LLC",
      dba: null,
      mcNumber: null,
      dotNumber: null,
      repName: null,
      repTitle: null,
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
      phone: null,
      email: null,
      dispatchFeePct: null,
      effectiveDate: "2026-08-14",
    });
    expect(fields.carrier_legal_name).toBe("Acme Trucking LLC");
    expect(fields.carrier_dba).toBe("");
    expect(fields.dispatch_fee_pct).toBe("");
    expect(code(CLIENT)).toMatch(
      /\.filter\(\(\[, value\]\) => value\.trim\(\) !== ""\)/,
    );
  });

  it("formats the dispatch fee as a percentage", () => {
    const fields = buildAgreementFields({
      companyName: "X",
      dba: null,
      mcNumber: "MC-123",
      dotNumber: "DOT-9",
      repName: "Jane",
      repTitle: "Owner",
      addressLine1: "1 Main St",
      city: "Newark",
      state: "NJ",
      postalCode: "07111",
      phone: "555",
      email: "a@b.c",
      dispatchFeePct: 5,
      effectiveDate: "2026-08-14",
    });
    expect(fields.dispatch_fee_pct).toBe("5%");
    expect(fields.carrier_mc_number).toBe("MC-123");
    expect(fields.carrier_usdot_number).toBe("DOT-9");
    expect(fields.carrier_email).toBe("a@b.c");
  });

  it("covers all 14 required prefill fields", () => {
    // The requirement list, verbatim. If the template gains a field this is
    // where the omission surfaces.
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
      "dispatch_fee_pct",
      "effective_date",
    ]);
  });
});

describe("M-92 · authorization shape", () => {
  it("a non-staff caller cannot name a carrier — there is no parameter", () => {
    const src = code(ACTION);
    // Exactly one formData read for a carrier id, and it is inside the staff
    // branch. Carrier A cannot send for Carrier B because the request has
    // nowhere to put B.
    const reads = src.match(/formData\.get\("carrier_id"\)/g) ?? [];
    expect(reads.length).toBe(1);
    const staffBranch = src.indexOf("if (staff)");
    const elseBranch = src.indexOf("} else {");
    const readAt = src.indexOf('formData.get("carrier_id")');
    expect(staffBranch).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(staffBranch);
    expect(readAt).toBeLessThan(elseBranch);
  });

  it("the non-staff path resolves the carrier from the session", () => {
    expect(code(ACTION)).toContain("getMyCarrierId(supabase)");
  });

  it("the staff branch is gated on a server-read role", () => {
    const src = code(ACTION);
    expect(src).toContain("getSessionProfile()");
    expect(src).toContain("isStaffRole(profile.role)");
  });

  it("returns fixed messages and never the provider's reason", () => {
    const src = code(ACTION);
    // The reason is logged, not returned.
    expect(src).toMatch(/console\.error\([^)]*result\.reason/);
    expect(src).not.toMatch(/message:\s*result\.reason/);
    expect(src).not.toMatch(/message:\s*`[^`]*\$\{result\.reason\}/);
  });

  it("the send library disclaims being an authorization boundary", () => {
    // It is called with an already-authorized id. Saying so in the source is
    // what stops the next caller assuming it checks.
    expect(readFileSync(SEND_LIB, "utf8")).toMatch(
      /performs no permission check of its own/,
    );
  });

  it("rate-limits per actor, not per IP", () => {
    expect(code(ACTION)).toMatch(
      /checkRateLimit\("agreement-send",\s*profile\.userId/,
    );
  });
});

describe("M-92 · duplicate sends", () => {
  it("returns the existing request instead of creating a second", () => {
    const src = code(SEND_LIB);
    expect(src).toContain("created: false");
    expect(src).toMatch(
      /\.in\("status", \[\.\.\.ACTIVE_SIGNATURE_STATUSES\]\)/,
    );
  });

  it("a lost race is handled, not ignored", () => {
    // 23505 = unique_violation from the partial index. The loser must return
    // the winner rather than surfacing a database error.
    const src = code(SEND_LIB);
    expect(src).toContain('insertError.code === "23505"');
  });

  it("the database — not the check — is what guarantees uniqueness", () => {
    const migration = readFileSync(
      "supabase/migrations/0031_signature_requests.sql",
      "utf8",
    );
    expect(migration).toContain(
      "create unique index signature_requests_one_active_per_carrier",
    );
    // Terminal states excluded, so a declined/expired request can be superseded.
    expect(migration).toMatch(
      /where status in \(\s*'sent', 'viewed', 'carrier_signed', 'awaiting_countersignature'\s*\)/,
    );
  });

  it("the active list in code matches the partial index exactly", () => {
    // These two drifting apart is how the guarantee quietly stops holding:
    // the code would check four statuses while the index enforced three.
    const migration = readFileSync(
      "supabase/migrations/0031_signature_requests.sql",
      "utf8",
    );
    for (const status of ACTIVE_SIGNATURE_STATUSES) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(ACTIVE_SIGNATURE_STATUSES).toHaveLength(4);
  });

  it("refuses to re-send once the agreement is signed", () => {
    expect(code(SEND_LIB)).toContain('reason: "already_signed"');
  });
});

describe("M-92 · carrier activation is untouched", () => {
  it("the send path never writes carriers.active", () => {
    for (const file of [SEND_LIB, ACTION]) {
      expect(code(file)).not.toMatch(/active:\s*true/);
      expect(code(file)).not.toMatch(/\.update\(\{[^}]*active/);
    }
  });

  it("the send path never stamps agreement_signed_at", () => {
    // Only the webhook may do that, and only on a real completion.
    expect(code(SEND_LIB)).not.toMatch(/agreement_signed_at:\s*new Date/);
  });

  it("writes an audit entry for the send", () => {
    const src = code(SEND_LIB);
    expect(src).toContain('action: "agreement.send"');
    expect(src).toContain("recordAuditEvent");
  });
});

describe("M-92 · status lifecycle", () => {
  it("exposes all eight portal states", () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(
      [
        "awaiting_countersignature",
        "carrier_signed",
        "completed",
        "declined",
        "expired",
        "not_sent",
        "sent",
        "viewed",
      ].sort(),
    );
  });

  it("not_sent is never a stored status", () => {
    expect(SIGNATURE_STATUSES).not.toContain("not_sent");
    const migration = readFileSync(
      "supabase/migrations/0031_signature_requests.sql",
      "utf8",
    );
    expect(migration).not.toMatch(/'not_sent'/);
  });

  it("maps SignWell events to statuses", () => {
    expect(EVENT_TO_STATUS.document_sent).toBe("sent");
    expect(EVENT_TO_STATUS.document_viewed).toBe("viewed");
    expect(EVENT_TO_STATUS.document_completed).toBe("completed");
    expect(EVENT_TO_STATUS.document_declined).toBe("declined");
    expect(EVENT_TO_STATUS.document_expired).toBe("expired");
    // document_signed is per-signer and resolved separately.
    expect(EVENT_TO_STATUS.document_signed).toBeUndefined();
  });

  it("a carrier signing means awaiting countersignature", () => {
    expect(
      statusForSignedEvent({
        signerEmail: "Owner@Carrier.com",
        carrierEmail: "owner@carrier.com",
      }),
    ).toBe("awaiting_countersignature");
  });

  it("a non-carrier signer is recorded as carrier_signed, not guessed away", () => {
    expect(
      statusForSignedEvent({
        signerEmail: "rep@pickloads.com",
        carrierEmail: "owner@carrier.com",
      }),
    ).toBe("carrier_signed");
    // Unknown signer must not be silently treated as the carrier.
    expect(
      statusForSignedEvent({ signerEmail: null, carrierEmail: "a@b.c" }),
    ).toBe("carrier_signed");
  });

  it("terminal statuses are terminal", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("declined")).toBe(true);
    expect(isTerminal("expired")).toBe(true);
    expect(isTerminal("sent")).toBe(false);
    expect(isTerminal("awaiting_countersignature")).toBe(false);
  });

  it("the webhook refuses to move a terminal request backwards", () => {
    // Webhook ordering is not guaranteed and SignWell retries. A late
    // document_viewed must not un-complete a signed agreement.
    const route = code("src/app/api/signwell/webhook/route.ts");
    expect(route).toContain("if (isTerminal(current)) return;");
  });

  it("every non-sent status stamps a timestamp column", () => {
    for (const status of SIGNATURE_STATUSES) {
      if (status === "sent") continue; // sent_at defaults on insert
      expect(STATUS_TIMESTAMP_COLUMN[status]).toBeTruthy();
    }
  });
});

describe("M-92 · secrets", () => {
  it("the send client is server-only", () => {
    expect(
      readFileSync(CLIENT, "utf8").startsWith('import "server-only";'),
    ).toBe(true);
    expect(
      readFileSync(SEND_LIB, "utf8").startsWith('import "server-only";'),
    ).toBe(true);
  });

  it("the API key is read in one place and never returned", () => {
    const src = code(CLIENT);
    // Read per-call from the environment; never stored, never logged.
    expect(src).not.toMatch(/console\.(log|error|warn)\([^)]*apiKey/);
    expect(src).not.toMatch(/reason:\s*apiKey/);
  });

  it("provider error text is logged, never returned to a caller", () => {
    const src = code(CLIENT);
    expect(src).toMatch(/console\.error\(/);
    // The failure surface is a fixed reason code, not the provider's body.
    expect(src).toMatch(/reason: `create_http_\$\{res\.status\}`/);
  });
});
