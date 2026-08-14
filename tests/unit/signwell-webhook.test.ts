import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSignwellConfigured, verifySignwellEvent } from "@/lib/signwell";

/**
 * M-91 — SignWell webhook.
 *
 * The verification scheme is SignWell's, taken from
 * https://developers.signwell.com/reference/event-hash-verification :
 *
 *   HMAC-SHA256(key = webhook id, data = `${event.type}@${event.time}`)
 *   compared in constant time against `event.hash`.
 *
 * These tests independently re-implement that from the published spec rather
 * than calling our own helper to generate the expectation — a test that signs
 * with the code under test proves only that the function is deterministic.
 */

const WEBHOOK_ID = "test-webhook-id-not-a-real-secret";

/**
 * Source with comments stripped.
 *
 * These files document the mistakes they exist to prevent — the route's header
 * names `SIGNWELL_WEBHOOK_ID` while explaining why it must never come from a
 * request. A scanner that reads prose flags the explanation as the defect.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

/** The spec, re-implemented here on purpose. */
function officialHash(type: string, time: string | number, key: string) {
  return createHmac("sha256", key)
    .update(`${type}@${String(time)}`)
    .digest("hex");
}

describe("M-91 · SignWell event hash verification", () => {
  beforeEach(() => {
    process.env.SIGNWELL_WEBHOOK_ID = WEBHOOK_ID;
    process.env.SIGNWELL_API_KEY = "test-api-key";
  });
  afterEach(() => {
    delete process.env.SIGNWELL_WEBHOOK_ID;
    delete process.env.SIGNWELL_API_KEY;
  });

  it("accepts a hash computed per the published SignWell spec", () => {
    const eventType = "document_completed";
    const eventTime = 1786000000;
    expect(
      verifySignwellEvent({
        eventType,
        eventTime,
        eventHash: officialHash(eventType, eventTime, WEBHOOK_ID),
      }),
    ).toBe(true);
  });

  it("stringifies a numeric event.time the way SignWell's own sample does", () => {
    // Their Python sample is `str(params['event']['time'])`. A number and its
    // string form must therefore produce the same signature.
    const hash = officialHash("document_completed", "1786000000", WEBHOOK_ID);
    expect(
      verifySignwellEvent({
        eventType: "document_completed",
        eventTime: 1786000000,
        eventHash: hash,
      }),
    ).toBe(true);
  });

  it("REJECTS a hash signed with the wrong key", () => {
    const eventType = "document_completed";
    const eventTime = 1786000000;
    expect(
      verifySignwellEvent({
        eventType,
        eventTime,
        eventHash: officialHash(eventType, eventTime, "attacker-chosen-key"),
      }),
    ).toBe(false);
  });

  it("REJECTS a replay whose event type was swapped", () => {
    // A signature is bound to (type, time). Lifting the hash from a
    // `document_viewed` event onto a `document_completed` one must fail.
    const time = 1786000000;
    expect(
      verifySignwellEvent({
        eventType: "document_completed",
        eventTime: time,
        eventHash: officialHash("document_viewed", time, WEBHOOK_ID),
      }),
    ).toBe(false);
  });

  it("REJECTS a replay whose timestamp was altered", () => {
    expect(
      verifySignwellEvent({
        eventType: "document_completed",
        eventTime: 1786000001,
        eventHash: officialHash("document_completed", 1786000000, WEBHOOK_ID),
      }),
    ).toBe(false);
  });

  it("REJECTS rather than throwing on a length-mismatched hash", () => {
    // timingSafeEqual throws on unequal lengths. A throw inside a verifier is
    // a denial-of-service lever, so the length check comes first.
    expect(() =>
      verifySignwellEvent({
        eventType: "document_completed",
        eventTime: 1786000000,
        eventHash: "short",
      }),
    ).not.toThrow();
    expect(
      verifySignwellEvent({
        eventType: "document_completed",
        eventTime: 1786000000,
        eventHash: "short",
      }),
    ).toBe(false);
  });

  it("FAILS CLOSED when no webhook id is configured", () => {
    delete process.env.SIGNWELL_WEBHOOK_ID;
    const eventType = "document_completed";
    const eventTime = 1786000000;
    // Even a correctly-signed event is refused: unconfigured means unverifiable,
    // and unverifiable must never mean "accept".
    expect(
      verifySignwellEvent({
        eventType,
        eventTime,
        eventHash: officialHash(eventType, eventTime, WEBHOOK_ID),
      }),
    ).toBe(false);
    expect(isSignwellConfigured()).toBe(false);
  });
});

describe("M-91 · the HMAC key never comes from the request", () => {
  /**
   * The finding this guards. SignWell documents the key as "the Webhook ID
   * sent in the webhook POST resource". Implemented literally, an attacker
   * supplies both the key and the hash and every forgery verifies.
   *
   * `verifySignwellEvent` takes no key parameter — the type system makes the
   * mistake unexpressible — and these assertions keep it that way.
   */
  it("verifySignwellEvent accepts no key argument", () => {
    // eventType, eventTime, eventHash — bundled in ONE object, no key.
    expect(verifySignwellEvent.length).toBe(1);
  });

  it("the route never reads a webhook id out of the payload", () => {
    expect(code("src/app/api/signwell/webhook/route.ts")).not.toMatch(
      /webhook_id/i,
    );
  });

  it("every reference to the webhook id reads it from the environment", () => {
    // Two legitimate readers: isSignwellConfigured() and verifySignwellEvent().
    // What matters is not how many there are but that EVERY one is a
    // `process.env` read — the moment one is sourced from a parameter or a
    // parsed body, the signature stops proving anything.
    const lib = code("src/lib/signwell.ts");
    const all = lib.match(/SIGNWELL_WEBHOOK_ID/g)?.length ?? 0;
    const fromEnv =
      lib.match(/process\.env\.SIGNWELL_WEBHOOK_ID/g)?.length ?? 0;
    expect(all).toBeGreaterThan(0);
    expect(fromEnv).toBe(all);
  });
});

describe("M-91 · idempotency key does not collide the way SEC-P2-02 does", () => {
  /**
   * The Dropbox Sign route keys idempotency on `event_hash`, which is a pure
   * function of (type, time). Two different documents completing in the same
   * second therefore collide: the second is deduped, answered 200, and never
   * processed — a carrier's agreement silently never stamped.
   *
   * SignWell's hash has the identical property, so reusing it here would
   * reproduce the defect exactly. The key is document-scoped instead.
   */
  const key = (documentId: string, type: string, time: string | number) =>
    `${documentId}:${type}:${String(time)}`;

  it("two documents completing in the SAME SECOND get different keys", () => {
    const time = 1786000000;
    expect(key("doc_aaa", "document_completed", time)).not.toBe(
      key("doc_bbb", "document_completed", time),
    );
    // …whereas the hash — the tempting key — is identical for both.
    expect(officialHash("document_completed", time, WEBHOOK_ID)).toBe(
      officialHash("document_completed", time, WEBHOOK_ID),
    );
  });

  it("a genuine redelivery of the same event collapses to one key", () => {
    expect(key("doc_aaa", "document_completed", 1786000000)).toBe(
      key("doc_aaa", "document_completed", 1786000000),
    );
  });

  it("different event types on one document stay distinct", () => {
    const t = 1786000000;
    expect(key("doc_aaa", "document_signed", t)).not.toBe(
      key("doc_aaa", "document_completed", t),
    );
  });

  it("the route actually builds the key this way", () => {
    const route = readFileSync("src/app/api/signwell/webhook/route.ts", "utf8");
    expect(route).toContain(
      "`${documentId}:${event.type}:${String(event.time)}`",
    );
    // And does NOT fall back to the hash.
    expect(route).not.toMatch(/event_id:\s*event\.hash/);
  });
});

describe("M-91 · route contract", () => {
  const route = code("src/app/api/signwell/webhook/route.ts");

  it("is POST-only — no GET handler exists", () => {
    expect(route).toContain("export async function POST");
    expect(route).not.toMatch(/export async function GET/);
  });

  it("verifies before doing any work", () => {
    // Signature check must precede the admin client, the DB insert and any
    // outbound fetch. Ordering is the control here, so it is asserted.
    const verifyAt = route.indexOf("verifySignwellEvent(");
    const adminAt = route.indexOf("tryCreateAdminClient()");
    const insertAt = route.indexOf('.from("webhook_events")');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(adminAt);
    expect(verifyAt).toBeLessThan(insertAt);
  });

  it("fails closed when unconfigured and refuses a bad signature", () => {
    expect(route).toContain("status: 503");
    expect(route).toContain("status: 401");
    expect(route).toContain("status: 400");
  });

  it("preserves the carrier activation gate", () => {
    // agreement_signed_at is stamped only when currently null — idempotent,
    // and a replay cannot re-date an existing agreement.
    expect(route).toContain('.is("agreement_signed_at", null)');
    // Activation stays a separate staff decision: the webhook must never
    // flip `active`.
    expect(route).not.toMatch(/update\(\{\s*active:/);
  });

  it("stores artefacts privately and never hands out a provider URL", () => {
    expect(route).toContain('.from("carrier-docs")');
    expect(route).toContain("sniffMime");
    // No public bucket, no public URL.
    expect(route).not.toContain("getPublicUrl");
    expect(route).not.toContain("public: true");
  });

  it("does not leak secrets into responses or logs", () => {
    expect(route).not.toMatch(/SIGNWELL_API_KEY/);
    expect(route).not.toMatch(/SIGNWELL_WEBHOOK_ID/);
  });
});
