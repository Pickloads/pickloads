import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_VALUE_MARKERS,
  DROPPED,
  isForbiddenKey,
  looksLikeCredential,
  REDACTED,
  scrubEvent,
  scrubString,
  scrubUrl,
  scrubValue,
  type ScrubbableEvent,
} from "@/lib/observability/scrub";
import { sentryEnabled } from "@/lib/observability/sentry-options";

/**
 * M-84b — §26's never-log list, proved.
 *
 * Directive P names twelve categories that must never reach error monitoring.
 * Each gets a test below, and — because a redaction test that cannot fail is
 * worse than no test — each rule also gets a NON-VACUITY control showing the
 * same assertion catching the unscrubbed value.
 */

/** Every §P category, with a value shaped the way it would really arrive. */
const FORBIDDEN_SAMPLES: Array<[label: string, key: string, value: string]> = [
  ["password", "password", "hunter2-correct-horse"],
  ["auth token", "access_token", "ya29.a0AfH6SMBx-REAL-LOOKING"],
  ["cookie", "cookie", "sb-access-token=abc; path=/"],
  ["tracking access code", "tracking_access_code", "07111"],
  ["driver secure token", "driver_token", "d3f4a1b2c3d4e5f6"],
  ["EIN", "ein", "12-3456789"],
  ["banking", "account_number", "000123456789"],
  ["W-9 contents", "w9_content", "Form W-9 Request for Taxpayer..."],
  ["insurance document", "insurance_document", "CERT OF LIABILITY INSURANCE"],
  ["BOL/POD contents", "file_content", "%PDF-1.7 binary bill of lading"],
  ["private note", "internal_message", "shipper is disputing the detention"],
  ["margin", "margin", "412.50"],
];

describe("§26 never-log list — forbidden keys", () => {
  for (const [label, key, value] of FORBIDDEN_SAMPLES) {
    it(`redacts ${label} (\`${key}\`) wherever it appears`, () => {
      const scrubbed = scrubValue({ [key]: value }) as Record<string, unknown>;
      expect(scrubbed[key]).toBe(REDACTED);
      expect(JSON.stringify(scrubbed)).not.toContain(value);
    });
  }

  it("NON-VACUITY: the same assertion fails against an unscrubbed object", () => {
    // If this ever passes, every test above is meaningless.
    const unscrubbed = { password: "hunter2-correct-horse" };
    expect(JSON.stringify(unscrubbed)).toContain("hunter2-correct-horse");
  });

  it("redacts at depth, not only at the top level", () => {
    const scrubbed = scrubValue({
      a: { b: { c: { d: { ein: "12-3456789" } } } },
    });
    expect(JSON.stringify(scrubbed)).not.toContain("12-3456789");
  });

  it("redacts inside arrays", () => {
    const scrubbed = scrubValue([{ password: "p1" }, { password: "p2" }]);
    expect(JSON.stringify(scrubbed)).not.toContain("p1");
    expect(JSON.stringify(scrubbed)).not.toContain("p2");
  });

  it("drops a subtree deeper than the recursion ceiling rather than passing it", () => {
    let deep: Record<string, unknown> = { leaf: "value" };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(JSON.stringify(scrubValue(deep))).toContain(DROPPED);
  });

  it("keeps identifiers that are NOT secrets — a scrubber that eats everything is unusable", () => {
    const scrubbed = scrubValue({
      shipment_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      document_id: "7386eb84-0d7c-4972-9cc4-4017c8b16eed",
      tracking_number: "PL-2026-000101",
      status: "in_transit",
      attempts: 3,
      delivered: true,
    }) as Record<string, unknown>;
    expect(scrubbed.shipment_id).toBe("ffffffff-ffff-ffff-ffff-ffffffffffff");
    expect(scrubbed.document_id).toBe("7386eb84-0d7c-4972-9cc4-4017c8b16eed");
    expect(scrubbed.tracking_number).toBe("PL-2026-000101");
    expect(scrubbed.status).toBe("in_transit");
    expect(scrubbed.attempts).toBe(3);
    expect(scrubbed.delivered).toBe(true);
  });

  it("does not treat `author` or `authenticated` as auth material", () => {
    expect(isForbiddenKey("author")).toBe(false);
    expect(isForbiddenKey("authenticated")).toBe(false);
    expect(isForbiddenKey("authorization")).toBe(true);
    expect(isForbiddenKey("x-auth")).toBe(true);
  });
});

describe("§26 never-log list — forbidden value SHAPES under innocent keys", () => {
  for (const marker of CREDENTIAL_VALUE_MARKERS) {
    it(`redacts a value containing \`${marker}\` even under a harmless key`, () => {
      const value = `provider said: ${marker}XYZ123`;
      expect(looksLikeCredential(value)).toBe(true);
      const scrubbed = scrubValue({ detail: value }) as Record<string, unknown>;
      expect(scrubbed.detail).toBe(REDACTED);
    });
  }

  it("redacts a JWT quoted into an ordinary error message", () => {
    const msg =
      "provider rejected request: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig";
    expect(scrubString(msg)).toBe(REDACTED);
  });

  it("NON-VACUITY: an ordinary error message survives untouched", () => {
    const msg = "provider rejected request: 502 upstream";
    expect(scrubString(msg)).toBe(msg);
  });

  it("redacts exact coordinates but keeps city/state (§26 operational need)", () => {
    expect(scrubString("truck at 40.735657,-74.172363 now")).toBe(
      `truck at ${REDACTED} now`,
    );
    expect(scrubString("truck at Newark, NJ now")).toBe("truck at Newark, NJ now");
  });

  it("redacts a bare EIN in free text", () => {
    expect(scrubString("carrier EIN 12-3456789 rejected")).toBe(
      `carrier EIN ${REDACTED} rejected`,
    );
  });
});

describe("URLs — where driver tokens and access codes actually leak", () => {
  it("strips the query string from a driver-update link (M-76)", () => {
    const scrubbed = scrubUrl(
      "https://pickloads.com/en/driver/update/abc123?token=SECRET&x=1",
    );
    expect(scrubbed).toBe(`https://pickloads.com/en/driver/update/abc123?${REDACTED}`);
    expect(scrubbed).not.toContain("SECRET");
  });

  it("strips a fragment too", () => {
    expect(scrubUrl("https://pickloads.com/track#code=07111")).not.toContain("07111");
  });

  it("leaves a clean path alone", () => {
    expect(scrubUrl("https://pickloads.com/en/track")).toBe(
      "https://pickloads.com/en/track",
    );
  });
});

describe("scrubEvent — the whole beforeSend contract", () => {
  function hostileEvent(): ScrubbableEvent {
    return {
      message: "failed for eyJhbGciOiJIUzI1NiJ9.payload",
      request: {
        url: "https://pickloads.com/en/driver/update/x?token=SECRET",
        query_string: "token=SECRET",
        data: { password: "hunter2", bol_file: "%PDF-1.7" },
        cookies: "sb-access-token=abc",
        headers: {
          authorization: "Bearer SECRET",
          cookie: "sb=abc",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0",
        },
      },
      user: { id: "u-1", email: "shipper@example.com", ip_address: "203.0.113.5" },
      extra: { ein: "12-3456789", note: "internal only" },
      tags: { shipment_signal: "status_update_error" },
      breadcrumbs: [{ message: "GET /api?token=SECRET", data: { body: "x" } }],
      exception: { values: [{ value: "threw with Bearer SECRET attached" }] },
    };
  }

  it("drops cookies, request body and query string wholesale", () => {
    const out = scrubEvent(hostileEvent())!;
    expect(out.request?.cookies).toBe(DROPPED);
    expect(out.request?.data).toBe(DROPPED);
    expect(out.request?.query_string).toBe(DROPPED);
  });

  it("keeps only allow-listed headers", () => {
    const out = scrubEvent(hostileEvent())!;
    expect(Object.keys(out.request?.headers ?? {}).sort()).toEqual([
      "content-type",
      "user-agent",
    ]);
  });

  it("reduces the user to an id — no email, no IP address", () => {
    const out = scrubEvent(hostileEvent())!;
    expect(out.user).toEqual({ id: "u-1" });
  });

  it("scrubs the message, the exception value and the breadcrumb", () => {
    const out = scrubEvent(hostileEvent())!;
    expect(out.message).toBe(REDACTED);
    expect(out.exception?.values?.[0]?.value).toBe(REDACTED);
    expect(out.breadcrumbs?.[0]?.message).toBe(REDACTED);
    expect(out.breadcrumbs?.[0]?.data).toBe(DROPPED);
  });

  it("keeps a useful tag — the event must stay actionable", () => {
    const out = scrubEvent(hostileEvent())!;
    expect(out.tags?.shipment_signal).toBe("status_update_error");
  });

  it("THE WHOLE-EVENT SWEEP: no forbidden value survives anywhere in the payload", () => {
    const out = scrubEvent(hostileEvent())!;
    const serialized = JSON.stringify(out);
    for (const secret of [
      "SECRET",
      "hunter2",
      "12-3456789",
      "sb-access-token=abc",
      "shipper@example.com",
      "203.0.113.5",
      "eyJhbGciOiJIUzI1NiJ9",
      "%PDF-1.7",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("NON-VACUITY: the same sweep FINDS every one of them before scrubbing", () => {
    const serialized = JSON.stringify(hostileEvent());
    for (const secret of [
      "SECRET",
      "hunter2",
      "12-3456789",
      "sb-access-token=abc",
      "shipper@example.com",
      "203.0.113.5",
      "eyJhbGciOiJIUzI1NiJ9",
      "%PDF-1.7",
    ]) {
      expect(serialized).toContain(secret);
    }
  });

  it("an empty event is handled without throwing", () => {
    expect(scrubEvent({})).toEqual({});
  });
});

describe("graceful behaviour without a DSN (§P)", () => {
  it("is disabled when the DSN is missing, blank or a placeholder", () => {
    expect(sentryEnabled(undefined)).toBe(false);
    expect(sentryEnabled("")).toBe(false);
    expect(sentryEnabled("   ")).toBe(false);
    expect(sentryEnabled("https://placeholder@o0.ingest.sentry.io/0")).toBe(false);
  });

  it("is enabled for a real-looking DSN — the control", () => {
    expect(sentryEnabled("https://abc123@o12345.ingest.sentry.io/678")).toBe(true);
  });
});
