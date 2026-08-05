import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildShipmentSignal,
  logShipmentSignal,
  redactDetail,
  SHIPMENT_SIGNALS,
} from "@/lib/shipments/observability";

/**
 * M-72 — §26 observability hooks.
 *
 * §26 has two halves and both are tested here: the nine signals it tracks, and
 * the list of things it says must NEVER be logged. The second half is the one
 * worth automating — a never-log rule enforced by discipline is enforced until
 * the first person passes an error string through verbatim.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("§26's nine tracked signals", () => {
  it("carries exactly the nine the directive names", () => {
    expect(SHIPMENT_SIGNALS).toEqual([
      "public_tracking_failure",
      "repeated_invalid_tracking_attempts",
      "status_update_error",
      "webhook_failure",
      "notification_failure",
      "location_provider_failure",
      "unauthorized_access_attempt",
      "document_download_error",
      "eta_calculation_failure",
    ]);
    expect(SHIPMENT_SIGNALS).toHaveLength(9);
  });
});

describe("the record shape (allow-list construction, as in dto.ts)", () => {
  it("emits every key, defaulting absent ones to null rather than omitting", () => {
    const record = buildShipmentSignal({
      signal: "status_update_error",
      code: "illegal_transition",
    });
    expect(Object.keys(record).sort()).toEqual(
      [
        "actor_id",
        "actor_role",
        "code",
        "detail",
        "from",
        "scope",
        "shipment_id",
        "signal",
        "to",
        "tracking_number",
      ].sort(),
    );
    expect(record.scope).toBe("shipment");
    expect(record.shipment_id).toBeNull();
  });

  /**
   * §26 forbids logging "exact location data beyond operational need". There
   * is no coordinate FIELD at all, so a latitude cannot be logged by mistake.
   */
  it("has no field for coordinates", () => {
    const record = buildShipmentSignal({
      signal: "location_provider_failure",
      code: "timeout",
    });
    expect(record).not.toHaveProperty("latitude");
    expect(record).not.toHaveProperty("longitude");
  });
});

describe("§26's never-log list", () => {
  it("passes an ordinary operator sentence through unchanged", () => {
    expect(redactDetail("shipment is delayed, not in_transit")).toBe(
      "shipment is delayed, not in_transit",
    );
  });

  it("drops the WHOLE string when anything credential-shaped is present", () => {
    const cases = [
      "Authorization: Bearer abc123",
      "provider replied with eyJhbGciOiJIUzI1NiJ9.payload",
      "stripe key sk_live_deadbeef rejected",
      "signature mismatch for whsec_abcdef",
      "-----BEGIN RSA PRIVATE KEY-----",
      "https://track.example.com/d/xyz?token=9f2c",
      "response contained access_token",
      "header X-Signature did not match",
    ];
    for (const detail of cases) {
      expect(redactDetail(detail), detail).toBe(
        "[redacted: credential-shaped content]",
      );
    }
  });

  it("fails CLOSED — a partial mask would still disclose context", () => {
    const redacted = redactDetail("driver link https://x.test/?token=abc");
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("x.test");
  });

  it("truncates a long detail rather than writing a payload dump", () => {
    const redacted = redactDetail("x".repeat(500));
    expect(redacted).toHaveLength(201); // 200 chars + the ellipsis
    expect(redacted?.endsWith("…")).toBe(true);
  });

  it("normalises empty and whitespace-only details to null", () => {
    expect(redactDetail("")).toBeNull();
    expect(redactDetail("   ")).toBeNull();
    expect(redactDetail(null)).toBeNull();
    expect(redactDetail(undefined)).toBeNull();
  });

  it("redacts inside logShipmentSignal, not just in the helper", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logShipmentSignal({
      signal: "document_download_error",
      code: "expired",
      detail: "signed URL https://s.test/o?token=leaky expired",
    });
    const payload = JSON.parse(spy.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(payload.detail).toBe("[redacted: credential-shaped content]");
  });
});

describe("the transport", () => {
  it("writes one structured line under a stable prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logShipmentSignal({
      signal: "status_update_error",
      code: "status_conflict",
      shipmentId: "s1",
      from: "in_transit",
      to: "delivered",
      actorRole: "dispatcher",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("[shipment]");
    const payload = JSON.parse(spy.mock.calls[0]?.[1] as string) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      scope: "shipment",
      signal: "status_update_error",
      code: "status_conflict",
      from: "in_transit",
      to: "delivered",
      actor_role: "dispatcher",
    });
  });

  /** A logger that can break the thing it observes is worse than none. */
  it("never throws, even when the transport does", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("log drain is down");
    });
    expect(() =>
      logShipmentSignal({ signal: "webhook_failure", code: "500" }),
    ).not.toThrow();
  });
});
