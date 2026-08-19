import { describe, expect, it } from "vitest";
import {
  actionLabel,
  actionTone,
  formatAuditEvent,
  humanizeKey,
  humanizeValue,
  isSensitiveKey,
  redactedDetailJson,
  resolveActionFilter,
  type AuditEventRow,
} from "@/lib/audit/format";

/**
 * M-101 — the audit formatter.
 *
 * The security-relevant assertions are the redaction ones. `detail` is a
 * free-form `Record<string, unknown>` written by ~30 call sites; the old page
 * rendered it with `JSON.stringify`, so whatever a future call site put in
 * there would have appeared on screen. These tests hold the allowlist and the
 * redactor in place.
 */

const row = (over: Partial<AuditEventRow> = {}): AuditEventRow => ({
  id: "e1",
  actor_id: null,
  action: "document.download",
  target_table: "documents",
  target_id: "035983ba-1111-2222-3333-444444444444",
  detail: { ttl_seconds: 300 },
  ip: "203.0.113.7",
  created_at: "2026-08-19T06:57:00.000Z",
  ...over,
});

describe("action labels", () => {
  it("reads as English, not as a constant", () => {
    expect(actionLabel("document.download")).toBe("Document downloaded");
    expect(actionLabel("staff.mfa_enrolled")).toBe("MFA enabled");
    expect(actionLabel("pre_registration_staff_review")).toBe("Staff review completed");
    expect(actionLabel("manual_review_required")).toBe("Manual review required");
    expect(actionLabel("account.signup")).toBe("Account created");
  });

  it("degrades readably for an action it has never seen", () => {
    // `staff.role_assigned` aside, the ledger holds rows written by bootstrap
    // scripts that `src/` does not contain. An unknown action must still read.
    expect(actionLabel("some_future.thing_happened")).toBe(
      "Some future thing happened",
    );
  });

  it("does not paint everything amber", () => {
    expect(actionTone("document.download")).toBe("neutral");
    expect(actionTone("staff.mfa_enrolled")).toBe("success");
    expect(actionTone("manual_review_required")).toBe("warning");
    expect(actionTone("shipment.exception_opened")).toBe("danger");
    expect(actionTone("totally.unknown")).toBe("neutral");
  });
});

describe("value humanising", () => {
  it("turns snake_case into a sentence and leaves prose alone", () => {
    expect(humanizeValue("manual_review")).toBe("Manual review");
    expect(humanizeValue("Food & Beverage")).toBe("Food & Beverage");
    expect(humanizeKey("note_length")).toBe("Note length");
  });

  it("formats booleans, numbers, null and empty values", () => {
    expect(humanizeValue(true)).toBe("Yes");
    expect(humanizeValue(false)).toBe("No");
    expect(humanizeValue(302)).toBe("302");
    expect(humanizeValue(null)).toBe("—");
    expect(humanizeValue(undefined)).toBe("—");
    expect(humanizeValue("")).toBe("—");
  });
});

describe("summaries — the examples the brief named", () => {
  const summarise = (action: string, detail: unknown) =>
    formatAuditEvent(row({ action, detail }), null);

  it("document.download", () => {
    const f = summarise("document.download", { ttl_seconds: 300 });
    expect(f.summary).toBe("Secure document link generated");
    expect(f.secondary).toBe("Link expires in 5 minutes");
  });

  it("pre_registration_staff_review — cleared", () => {
    const f = summarise("pre_registration_staff_review", {
      outcome: "clear",
      decision: "eligible_to_continue",
      note_length: 302,
    });
    expect(f.summary).toBe("Carrier cleared to continue");
    expect(f.secondary).toBe("Manual staff review completed");
    // The brief is explicit: note_length must not reach the primary table.
    expect(`${f.summary} ${f.secondary}`).not.toContain("302");
    // It survives under technical details, phrased.
    expect(f.technical).toContainEqual({
      label: "Note length",
      value: "302 characters",
    });
  });

  it("staff.mfa_enrolled", () => {
    const f = summarise("staff.mfa_enrolled", { role: "admin" });
    expect(f.summary).toBe("Two-factor authentication enabled");
    expect(f.secondary).toBe("Admin account");
  });

  it("staff.role_assigned — implementation detail stays out of the summary", () => {
    const f = summarise("staff.role_assigned", {
      to: "admin",
      from: "carrier",
      method: "service_role_bootstrap",
    });
    expect(f.summary).toBe("Role changed from Carrier to Admin");
    expect(f.secondary).toBe("Administrative role assignment");
    expect(`${f.summary} ${f.secondary}`).not.toContain("service_role");
  });

  it("manual_review_required", () => {
    expect(summarise("manual_review_required", { risk_tier: "manual_review" }).summary).toBe(
      "Manual carrier review required",
    );
  });

  it("fmcsa_check_started — says why it could not run", () => {
    const f = summarise("fmcsa_check_started", {
      provider: "fmcsa_qcmobile",
      configured: false,
    });
    expect(f.summary).toBe("FMCSA verification started");
    expect(f.secondary).toBe("FMCSA integration not configured");
  });

  it("fmcsa_check_completed — translates provider values", () => {
    const f = summarise("fmcsa_check_completed", {
      provider: "fmcsa_qcmobile",
      lookup_status: "provider_not_configured",
      verification_status: "manual_review",
    });
    expect(f.summary).toContain("FMCSA provider not configured");
    expect(f.secondary).toContain("Manual review");
  });

  it("pre_registration_created", () => {
    expect(summarise("pre_registration_created", { has_mc: true }).secondary).toBe(
      "MC number provided",
    );
    expect(summarise("pre_registration_created", { has_mc: false }).secondary).toBe(
      "No MC number provided",
    );
  });

  it("account.signup", () => {
    const f = summarise("account.signup", {
      kind: "shipper",
      industry: "Food & Beverage",
      shipping_frequency: "monthly",
    });
    expect(f.summary).toBe("New shipper account created");
    expect(f.secondary).toBe("Food & Beverage · Monthly shipping");
  });
});

describe("missing, null and unknown metadata", () => {
  it("falls back to the action label rather than to a dump", () => {
    for (const detail of [null, undefined, {}, "not-an-object", 42, []]) {
      const f = formatAuditEvent(row({ action: "invoice.generate", detail }), null);
      expect(f.summary).toBe("Invoice generated");
      expect(f.summary).not.toContain("{");
      expect(f.technical).toEqual([]);
    }
  });

  it("an unknown action with metadata still shows no JSON in the summary", () => {
    const f = formatAuditEvent(
      // NB not `some_key` — anything ending `_key` is redacted by design,
      // which is the correct call for `api_key` and friends.
      row({ action: "future.event", detail: { some_field: "some_value" } }),
      null,
    );
    expect(f.summary).toBe("Future event");
    expect(f.summary).not.toContain("some_value");
    // …but the operator can still find it.
    expect(f.technical).toContainEqual({ label: "Some field", value: "Some value" });
  });
});

describe("redaction — the security half", () => {
  it("recognises sensitive key names", () => {
    for (const k of [
      "password",
      "totp_secret",
      "access_token",
      "refresh_token",
      "service_role_key",
      "api_key",
      "authorization",
      "cookie",
      "qr_payload",
      "session_id",
      "jwt",
      "ein",
      "ssn",
    ]) {
      expect(isSensitiveKey(k), `${k} should be sensitive`).toBe(true);
    }
  });

  it("does not redact any key the application actually writes", () => {
    // Read off the `detail:` payloads in src/. If the redactor started
    // swallowing one of these, the technical view would quietly go blank.
    for (const k of [
      "ttl_seconds", "carrier_id", "company_name", "decision", "bound",
      "dispatcher_id", "email", "role", "field", "thread_id", "has_mc",
      "outcome", "note_length", "provider", "configured", "reason",
      "old_status", "risk_tier", "shipment_id", "visibility", "step",
      "broker_partner_id", "kind", "industry", "shipping_frequency",
      "authority_status", "routed", "lookup_status", "docket_status",
      "verification_status", "to", "from", "method",
    ]) {
      expect(isSensitiveKey(k), `${k} is written by the app and must show`).toBe(
        false,
      );
    }
  });

  it("does not over-redact keys that merely look alarming", () => {
    // `settings.update` writes the SETTING key — "company_phone", not a secret.
    expect(isSensitiveKey("key")).toBe(false);
    expect(isSensitiveKey("signature_request_id")).toBe(false);
    for (const k of ["role", "decision", "note_length", "has_mc", "ttl_seconds"]) {
      expect(isSensitiveKey(k), `${k} should not be redacted`).toBe(false);
    }
  });

  it("withholds sensitive values in the technical view", () => {
    const f = formatAuditEvent(
      row({ detail: { totp_secret: "JBSWY3DPEHPK3PXP", role: "admin" } }),
      null,
    );
    expect(f.hasRedactions).toBe(true);
    const secret = f.technical.find((t) => t.label === "Totp secret");
    expect(secret?.value).toBe("[redacted]");
    expect(JSON.stringify(f)).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("withholds them in the raw view too", () => {
    const raw = redactedDetailJson({
      access_token: "eyJhbGciOi.secret.value",
      role: "admin",
    });
    expect(raw).not.toBeNull();
    expect(raw!).not.toContain("eyJhbGciOi");
    expect(raw!).toContain("[redacted]");
    expect(raw!).toContain("admin");
  });

  it("returns null raw JSON when there is nothing to show", () => {
    expect(redactedDetailJson(null)).toBeNull();
    expect(redactedDetailJson({})).toBeNull();
  });

  it("never mutates the event it was given", () => {
    const detail = { totp_secret: "s3cr3t", role: "admin" };
    const e = row({ detail });
    formatAuditEvent(e, null);
    redactedDetailJson(detail);
    // The ledger object is the ledger object.
    expect(detail).toEqual({ totp_secret: "s3cr3t", role: "admin" });
    expect(e.detail).toBe(detail);
    expect(e.action).toBe("document.download");
  });
});

describe("actor, target and origin", () => {
  it("names a staff actor and their role separately", () => {
    const f = formatAuditEvent(row({ actor_id: "3fe16fa9-aaaa" }), {
      id: "3fe16fa9-aaaa",
      full_name: "Dana Whitfield",
      role: "admin",
    });
    expect(f.actorLabel).toBe("Dana Whitfield");
    expect(f.actorSub).toBe("Admin");
  });

  it("reads an automated event as System, not as a developer log", () => {
    const f = formatAuditEvent(row({ actor_id: null }), null);
    expect(f.actorLabel).toBe("System");
    expect(f.actorSub).toBe("Automated service");
  });

  it("gives the target a type, with the id secondary", () => {
    const f = formatAuditEvent(row({ target_table: "carrier_pre_registrations" }), null);
    expect(f.targetLabel).toBe("Carrier application");
    expect(f.targetRef).toBe("035983ba…");
  });

  it("labels a loopback address without falsifying it", () => {
    const local = formatAuditEvent(row({ ip: "::1" }), null);
    expect(local.ipLabel).toBe("Local");
    expect(local.ipSub).toBe("::1");
    const real = formatAuditEvent(row({ ip: "203.0.113.7" }), null);
    expect(real.ipLabel).toBe("203.0.113.7");
    expect(real.ipSub).toBe("");
  });
});

describe("filter resolution", () => {
  it("keeps an exact constant working", () => {
    expect(resolveActionFilter("staff.mfa_enrolled")).toEqual(["staff.mfa_enrolled"]);
  });

  it("lets an operator search by what the table shows them", () => {
    expect(resolveActionFilter("MFA enabled")).toContain("staff.mfa_enrolled");
    expect(resolveActionFilter("manual review")).toContain("manual_review_required");
  });

  it("passes an unknown constant through, since the ledger predates this map", () => {
    expect(resolveActionFilter("legacy.bootstrap_thing")).toEqual([
      "legacy.bootstrap_thing",
    ]);
  });

  it("returns nothing for an empty filter", () => {
    expect(resolveActionFilter("")).toEqual([]);
    expect(resolveActionFilter("   ")).toEqual([]);
  });
});
