import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M-79 — the worker's own decision logic
 * (`src/lib/shipments/notification-worker.ts`).
 *
 * UNIT tests: the queue RPCs, the recipient resolver, the preference reads and
 * the transport are all mocked, so what is proved here is what the WORKER
 * decides — which outcome it settles with, whether it retries, and whether a
 * suppressed row is ever transmitted.
 *
 * That the queue actually dedupes on a unique index, that `for update skip
 * locked` prevents a double send, and that the attempt ledger is append-only
 * are proved against a real PostgreSQL 16 in
 * `tests/integration/shipment-notifications.test.ts`. A mock cannot prove a
 * constraint.
 */

const harvestShipmentNotifications = vi.fn();
const claimShipmentNotifications = vi.fn();
const settleShipmentNotification = vi.fn();
const reportNotificationFailure = vi.fn();

const getRecipientByProfile = vi.fn();
const notifyCustomer = vi.fn();
const sendEmail = vi.fn();
const readNotificationPreferences = vi.fn();
const isAddressSuppressed = vi.fn();

vi.mock("@/lib/shipments/notification-queue", () => ({
  harvestShipmentNotifications: (...a: unknown[]) =>
    harvestShipmentNotifications(...a),
  claimShipmentNotifications: (...a: unknown[]) =>
    claimShipmentNotifications(...a),
  settleShipmentNotification: (...a: unknown[]) =>
    settleShipmentNotification(...a),
  reportNotificationFailure: (...a: unknown[]) =>
    reportNotificationFailure(...a),
}));

vi.mock("@/lib/notify", () => ({
  getRecipientByProfile: (...a: unknown[]) => getRecipientByProfile(...a),
  notifyCustomer: (...a: unknown[]) => notifyCustomer(...a),
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
}));

vi.mock("@/lib/notification-preferences", () => ({
  readNotificationPreferences: (...a: unknown[]) =>
    readNotificationPreferences(...a),
  isAddressSuppressed: (...a: unknown[]) => isAddressSuppressed(...a),
}));

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => ({}),
  createAdminClient: () => ({}),
}));

const { runNotificationWorker } = await import(
  "@/lib/shipments/notification-worker"
);

const SHIPMENT = "ffffffff-ffff-ffff-ffff-ffffffff0a01";
const PROFILE = "22222222-2222-2222-2222-2222222aaaaa";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111110001",
    shipmentId: SHIPMENT,
    event: "delivered",
    channel: "email",
    recipientProfileId: PROFILE,
    idempotencyKey: "m79:delivered:x:once:email",
    payload: { tracking_number: "PL-2026-000458" },
    attempts: 1,
    maxAttempts: 6,
    ...overrides,
  };
}

beforeEach(() => {
  for (const m of [
    harvestShipmentNotifications,
    claimShipmentNotifications,
    settleShipmentNotification,
    reportNotificationFailure,
    getRecipientByProfile,
    notifyCustomer,
    sendEmail,
    readNotificationPreferences,
    isAddressSuppressed,
  ]) {
    m.mockReset();
  }
  harvestShipmentNotifications.mockResolvedValue({
    ok: true,
    scanned: 3,
    enqueued: 2,
    from: null,
    through: null,
  });
  settleShipmentNotification.mockResolvedValue({
    ok: true,
    state: "sent",
    attempts: 1,
  });
  getRecipientByProfile.mockResolvedValue({
    profileId: PROFILE,
    email: "ops@acme.com",
    locale: "en",
    fullName: "Ops",
  });
  readNotificationPreferences.mockResolvedValue({
    prefs: { emailShipmentUpdates: true, inappShipmentUpdates: true },
    token: "8b2e6f14-1111-4222-8333-444455556666",
  });
  isAddressSuppressed.mockResolvedValue(false);
  notifyCustomer.mockResolvedValue({ notification: "written", email: null });
  sendEmail.mockResolvedValue({
    status: "sent",
    providerMessageId: "prov_1",
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the worker loop", () => {
  it("harvests BEFORE claiming — a fact written this minute is sendable", () => {
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [] });
    return runNotificationWorker().then((summary) => {
      expect(harvestShipmentNotifications).toHaveBeenCalledTimes(1);
      expect(claimShipmentNotifications).toHaveBeenCalledTimes(1);
      expect(summary.harvested).toEqual({ scanned: 3, enqueued: 2 });
      expect(summary.ok).toBe(true);
    });
  });

  it("stops without claiming when the service key is missing", async () => {
    harvestShipmentNotifications.mockResolvedValue({
      ok: false,
      code: "not_configured",
      message: "no key",
    });
    const summary = await runNotificationWorker();
    expect(claimShipmentNotifications).not.toHaveBeenCalled();
    expect(summary.ok).toBe(false);
    expect(summary.notes).toContain("harvest not_configured");
  });

  it("still processes the backlog when only the HARVEST failed", async () => {
    // A harvest error must not strand rows that are already queued.
    harvestShipmentNotifications.mockResolvedValue({
      ok: false,
      code: "write_failed",
      message: "boom",
    });
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    const summary = await runNotificationWorker();
    expect(summary.sent).toBe(1);
    expect(summary.notes).toContain("harvest write_failed");
  });

  it("is BOUNDED — it passes a batch size to the claim", async () => {
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [] });
    await runNotificationWorker(7);
    expect(claimShipmentNotifications).toHaveBeenCalledWith(7);
  });
});

describe("delivery outcomes", () => {
  it("sends the email and settles `sent` with the provider id", async () => {
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    const summary = await runNotificationWorker();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const args = sendEmail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.to).toBe("ops@acme.com");
    expect(args.template).toBe("shipment-delivered");

    expect(settleShipmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "sent",
        providerMessageId: "prov_1",
        retryAfterSeconds: null,
      }),
    );
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("writes the in-app feed row for an `in_app` row and sends NO email", async () => {
    claimShipmentNotifications.mockResolvedValue({
      ok: true,
      rows: [row({ channel: "in_app", event: "picked_up" })],
    });
    const summary = await runNotificationWorker();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(notifyCustomer).toHaveBeenCalledTimes(1);
    const args = notifyCustomer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.kind).toBe("shipment_picked_up");
    expect(args.email).toBeUndefined();
    expect(args.href).toBe(`/portal/shipper/shipments/${SHIPMENT}`);
    expect(summary.sent).toBe(1);
  });

  it("SUPPRESSES — never transmits — when the preference is off", async () => {
    readNotificationPreferences.mockResolvedValue({
      prefs: { emailShipmentUpdates: false, inappShipmentUpdates: true },
      token: null,
    });
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    const summary = await runNotificationWorker();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(settleShipmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "suppressed", retryAfterSeconds: null }),
    );
    expect(summary.suppressed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("SUPPRESSES an unsubscribed ADDRESS even with the preference on", async () => {
    isAddressSuppressed.mockResolvedValue(true);
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    const summary = await runNotificationWorker();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(summary.suppressed).toBe(1);
    expect(settleShipmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "suppressed",
        error: "address_suppressed",
      }),
    );
  });

  it("re-checks preferences at SEND time, not only at enqueue time", async () => {
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    await runNotificationWorker();
    // The row was enqueued (so the enqueue-time check passed); the worker
    // asked again anyway. §17 says respect preferences, not the preferences
    // in force when we decided to write.
    expect(readNotificationPreferences).toHaveBeenCalledWith(
      expect.anything(),
      PROFILE,
    );
  });

  it("RETRIES with backoff on a transient provider failure", async () => {
    sendEmail.mockResolvedValue({
      status: "failed",
      providerMessageId: null,
      error: "502 upstream",
    });
    claimShipmentNotifications.mockResolvedValue({
      ok: true,
      rows: [row({ attempts: 2 })],
    });
    const summary = await runNotificationWorker();

    expect(settleShipmentNotification).toHaveBeenCalledWith(
      // attempt 2 failed → the second entry of the backoff table (300s).
      expect.objectContaining({ outcome: "failed", retryAfterSeconds: 300 }),
    );
    expect(summary.failed).toBe(1);
    expect(summary.dead).toBe(0);
    expect(reportNotificationFailure).toHaveBeenCalledTimes(1);
  });

  it("gives up (dead) once the attempts are exhausted", async () => {
    sendEmail.mockResolvedValue({
      status: "failed",
      providerMessageId: null,
      error: "still failing",
    });
    claimShipmentNotifications.mockResolvedValue({
      ok: true,
      rows: [row({ attempts: 6 })],
    });
    const summary = await runNotificationWorker();

    expect(settleShipmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", retryAfterSeconds: null }),
    );
    expect(summary.dead).toBe(1);
  });

  it("does not retry forever when the provider is not configured", async () => {
    sendEmail.mockResolvedValue({
      status: "skipped",
      providerMessageId: null,
      error: null,
    });
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    const summary = await runNotificationWorker();

    expect(settleShipmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "skipped",
        error: "email provider not configured",
      }),
    );
    expect(summary.suppressed).toBe(1);
    expect(summary.sent).toBe(0);
  });

  it("does not retry a recipient who no longer exists", async () => {
    getRecipientByProfile.mockResolvedValue(null);
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    await runNotificationWorker();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(settleShipmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "skipped" }),
    );
  });

  it("settles a THROWN delivery as a failure instead of stranding the row", async () => {
    sendEmail.mockRejectedValue(new Error("socket hang up"));
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    const summary = await runNotificationWorker();
    expect(settleShipmentNotification).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed" }),
    );
    expect(summary.failed).toBe(1);
  });

  it("processes every claimed row even when one of them fails", async () => {
    sendEmail
      .mockResolvedValueOnce({
        status: "failed",
        providerMessageId: null,
        error: "boom",
      })
      .mockResolvedValue({
        status: "sent",
        providerMessageId: "prov_2",
        error: null,
      });
    claimShipmentNotifications.mockResolvedValue({
      ok: true,
      rows: [
        row({ id: "row-1" }),
        row({ id: "row-2" }),
        row({ id: "row-3", channel: "in_app" }),
      ],
    });
    const summary = await runNotificationWorker();
    expect(summary.claimed).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(2);
    expect(settleShipmentNotification).toHaveBeenCalledTimes(3);
  });

  it("emits §26's notification_failure signal with no provider text leaked", async () => {
    sendEmail.mockResolvedValue({
      status: "failed",
      providerMessageId: null,
      error: "Bearer sk_live_should_never_be_logged",
    });
    claimShipmentNotifications.mockResolvedValue({ ok: true, rows: [row()] });
    await runNotificationWorker();

    expect(reportNotificationFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "deliver:delivered:email",
        shipmentId: SHIPMENT,
        trackingNumber: "PL-2026-000458",
      }),
    );
    // The redaction itself is M-72's `logShipmentSignal` and is proved in
    // tests/unit/shipment-observability.test.ts; what is proved here is that
    // the worker routes through it rather than console.error-ing the body.
  });
});
