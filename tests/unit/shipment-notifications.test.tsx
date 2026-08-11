import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  allowsChannel,
  decideSend,
  EVENT_SOURCED_NOTIFICATIONS,
  FORBIDDEN_PAYLOAD_KEYS,
  IDEMPOTENCY_KEY_PREFIX,
  MAX_NOTIFICATION_ATTEMPTS,
  NOTIFICATION_CHANNELS,
  notificationIdempotencyKey,
  normalizeSuppressionEmail,
  payloadIsSafe,
  RETRY_BACKOFF_SECONDS,
  retryDelaySeconds,
  SHIPMENT_NOTIFICATION_EVENTS,
  SHIPMENT_NOTIFICATION_MAP,
  SHIPMENT_NOTIFICATION_RULES,
  type NotificationChannel,
  type ShipmentNotificationEvent,
} from "@/lib/shipments/notification-rules";
import {
  IN_APP_TITLE_DICT,
  inAppCopy,
  localizedPath,
  optOutUrl,
  SHIPMENT_EMAIL_BUILDERS,
  trackingUrl,
} from "@/emails/shipment-templates";
import { EMAIL_LOCALES, type EmailLocale } from "@/emails/i18n";
import { normalizeNotificationToken } from "@/lib/notification-preferences";
import { SHIPMENT_EVENT_TYPES, SHIPMENT_STATUSES } from "@/lib/shipments/types";

/**
 * M-79 — §17's notification vocabulary, mapping, keys, backoff, preference
 * gating, locale fallback and the sensitive-data sentinel sweep.
 *
 * These are UNIT tests: no database, no transport, no mocks of either. What
 * they prove is that the DECISIONS are total and stable — that every one of
 * §17's eleven notifications has a template and an audience, that a key
 * derived twice is the same key, that a retry schedule is monotone and
 * terminates, and that no rendered email in any of the five locales contains
 * a financial or internal value.
 *
 * That the queue actually dedupes, retries and suppresses against real SQL is
 * proved in `tests/integration/shipment-notifications.test.ts` against PG16. A
 * unit test cannot prove a unique index, and pretending otherwise would be the
 * vacuous kind of green.
 */

const SHIPMENT = "ffffffff-ffff-ffff-ffff-ffffffff0a01";
const EVENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001";
const EVENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0002";

/* ================================================================== *
 * 1 · §17's eleven, and the event → template → audience map
 * ================================================================== */

describe("§17 — the eleven customer notifications", () => {
  it("names exactly the eleven the directive lists, in its order", () => {
    // Transcribed from docs/DIRECTIVE-tracking.md §17, not from the source.
    expect([...SHIPMENT_NOTIFICATION_EVENTS]).toEqual([
      "quote_accepted",
      "carrier_assigned",
      "driver_dispatched",
      "picked_up",
      "in_transit",
      "delay_reported",
      "delivery_eta_updated",
      "arrived_at_delivery",
      "delivered",
      "pod_available",
      "invoice_available",
    ]);
    expect(SHIPMENT_NOTIFICATION_EVENTS).toHaveLength(11);
  });

  it("launches exactly the two channels §17 permits — and not SMS", () => {
    expect([...NOTIFICATION_CHANNELS]).toEqual(["email", "in_app"]);
    expect(NOTIFICATION_CHANNELS as readonly string[]).not.toContain("sms");
  });

  it("maps every event to a template and an audience (total function)", () => {
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      const spec = SHIPMENT_NOTIFICATION_MAP[event];
      expect(spec, `no spec for ${event}`).toBeDefined();
      expect(spec.template).toMatch(/^shipment-/);
      expect(spec.audience).toBe("shipper_customer");
      expect(spec.inAppKind).not.toBe("");
      expect(["per_shipment", "per_source"]).toContain(spec.dedupeScope);
    }
    expect(Object.keys(SHIPMENT_NOTIFICATION_MAP).sort()).toEqual(
      [...SHIPMENT_NOTIFICATION_EVENTS].sort(),
    );
  });

  it("gives every event a DISTINCT email template id", () => {
    const templates = SHIPMENT_NOTIFICATION_EVENTS.map(
      (e) => SHIPMENT_NOTIFICATION_MAP[e].template,
    );
    expect(new Set(templates).size).toBe(templates.length);
  });

  it("has a builder for every event and an event for every builder", () => {
    expect(Object.keys(SHIPMENT_EMAIL_BUILDERS).sort()).toEqual(
      [...SHIPMENT_NOTIFICATION_EVENTS].sort(),
    );
  });

  it("has in-app copy for every event, in every authored locale", () => {
    for (const locale of ["en", "es", "fr"] as const) {
      expect(Object.keys(IN_APP_TITLE_DICT[locale]).sort()).toEqual(
        [...SHIPMENT_NOTIFICATION_EVENTS].sort(),
      );
    }
  });
});

/* ================================================================== *
 * 2 · The event → notification rules, AS A TABLE
 * ================================================================== */

describe("§17 — shipment event → notification rules", () => {
  /** The table, transcribed from the DIRECTIVE + M-79's stated decisions. */
  const EXPECTED: ReadonlyArray<
    [ShipmentNotificationEvent, string, string | null, boolean]
  > = [
    ["quote_accepted", "status_change", "quote_accepted", false],
    ["carrier_assigned", "status_change", "carrier_assigned", false],
    ["driver_dispatched", "status_change", "dispatched", false],
    ["picked_up", "status_change", "picked_up", false],
    ["in_transit", "status_change", "in_transit", false],
    ["arrived_at_delivery", "status_change", "arrived_at_delivery", false],
    ["delivered", "status_change", "delivered", false],
    ["delay_reported", "exception_opened", null, true],
    ["delay_reported", "status_change", "delayed", true],
    ["delivery_eta_updated", "eta_update", null, false],
    ["pod_available", "document_approved", null, false],
  ];

  it.each(EXPECTED)(
    "%s ← %s (status %s, customer-visible required: %s)",
    (notificationEvent, sourceEventType, matchStatus, requireVisible) => {
      const rule = SHIPMENT_NOTIFICATION_RULES.find(
        (r) =>
          r.notificationEvent === notificationEvent &&
          r.sourceEventType === sourceEventType &&
          r.matchStatus === matchStatus,
      );
      expect(rule, `missing rule ${notificationEvent}←${sourceEventType}`).toBeDefined();
      expect(rule?.requireCustomerVisible).toBe(requireVisible);
    },
  );

  it("declares no rule the table above does not name", () => {
    expect(SHIPMENT_NOTIFICATION_RULES).toHaveLength(EXPECTED.length);
  });

  it("uses only real event types and real statuses", () => {
    for (const rule of SHIPMENT_NOTIFICATION_RULES) {
      expect(SHIPMENT_EVENT_TYPES as readonly string[]).toContain(
        rule.sourceEventType,
      );
      if (rule.matchStatus !== null) {
        expect(SHIPMENT_STATUSES as readonly string[]).toContain(
          rule.matchStatus,
        );
      }
    }
  });

  it("narrows the two ambiguous producers by metadata containment", () => {
    const eta = SHIPMENT_NOTIFICATION_RULES.find(
      (r) => r.notificationEvent === "delivery_eta_updated",
    );
    // §17 names "delivery ETA updated". A PICKUP eta must not notify.
    expect(eta?.matchMetadata).toEqual({ eta_kind: "delivery" });

    const pod = SHIPMENT_NOTIFICATION_RULES.find(
      (r) => r.notificationEvent === "pod_available",
    );
    // Keyed on APPROVAL — 0024 makes an unapproved POD unreadable.
    expect(pod?.matchMetadata).toEqual({
      doc_type: "pod",
      decision: "approved",
    });
    expect(pod?.sourceEventType).toBe("document_approved");
  });

  it("leaves invoice_available WITHOUT an event rule, on purpose", () => {
    // An invoice is a row in `invoices`, not a timeline entry; the harvest
    // reads that table directly. Asserted so the gap is a decision on the
    // record rather than something a reader has to notice.
    expect(EVENT_SOURCED_NOTIFICATIONS).not.toContain("invoice_available");
    const covered = new Set(EVENT_SOURCED_NOTIFICATIONS);
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      if (event === "invoice_available") continue;
      expect(covered.has(event), `${event} has no producing rule`).toBe(true);
    }
  });
});

/* ================================================================== *
 * 3 · §17 — "use idempotency keys" / "avoid duplicate notifications"
 * ================================================================== */

describe("§17 — idempotency key derivation", () => {
  it("is deterministic for identical parts (this IS the dedupe)", () => {
    const parts = {
      event: "delivered" as const,
      shipmentId: SHIPMENT,
      channel: "email" as const,
    };
    expect(notificationIdempotencyKey(parts)).toBe(
      notificationIdempotencyKey({ ...parts }),
    );
  });

  it("carries the module prefix, the event and the shipment", () => {
    const key = notificationIdempotencyKey({
      event: "picked_up",
      shipmentId: SHIPMENT,
      channel: "email",
    });
    expect(key.startsWith(`${IDEMPOTENCY_KEY_PREFIX}:`)).toBe(true);
    expect(key).toContain("picked_up");
    expect(key).toContain(SHIPMENT);
  });

  it("COLLAPSES a per_shipment event however many times it is produced", () => {
    // A corrected status that re-enters `delivered` is the same news.
    const first = notificationIdempotencyKey({
      event: "delivered",
      shipmentId: SHIPMENT,
      channel: "email",
      sourceId: EVENT_A,
    });
    const second = notificationIdempotencyKey({
      event: "delivered",
      shipmentId: SHIPMENT,
      channel: "email",
      sourceId: EVENT_B,
    });
    expect(first).toBe(second);
    expect(first).toContain(":once:");
  });

  it("SEPARATES per_source events — three ETA changes are three keys", () => {
    const first = notificationIdempotencyKey({
      event: "delivery_eta_updated",
      shipmentId: SHIPMENT,
      channel: "email",
      sourceId: EVENT_A,
    });
    const second = notificationIdempotencyKey({
      event: "delivery_eta_updated",
      shipmentId: SHIPMENT,
      channel: "email",
      sourceId: EVENT_B,
    });
    expect(first).not.toBe(second);
  });

  it("scopes by CHANNEL so a failed email cannot block the feed row", () => {
    const email = notificationIdempotencyKey({
      event: "delivered",
      shipmentId: SHIPMENT,
      channel: "email",
    });
    const inApp = notificationIdempotencyKey({
      event: "delivered",
      shipmentId: SHIPMENT,
      channel: "in_app",
    });
    expect(email).not.toBe(inApp);
    expect(email.endsWith(":email")).toBe(true);
    expect(inApp.endsWith(":in_app")).toBe(true);
  });

  it("separates two shipments that reach the same milestone", () => {
    const a = notificationIdempotencyKey({
      event: "delivered",
      shipmentId: SHIPMENT,
      channel: "email",
    });
    const b = notificationIdempotencyKey({
      event: "delivered",
      shipmentId: "ffffffff-ffff-ffff-ffff-ffffffff0a02",
      channel: "email",
    });
    expect(a).not.toBe(b);
  });

  it("THROWS for a per_source event with no source id", () => {
    // Silently collapsing would tell a customer about the first of five
    // delays and nothing else. A bug to fix, not a silence to ship.
    expect(() =>
      notificationIdempotencyKey({
        event: "delay_reported",
        shipmentId: SHIPMENT,
        channel: "email",
      }),
    ).toThrow(/per_source/);
    expect(() =>
      notificationIdempotencyKey({
        event: "delay_reported",
        shipmentId: SHIPMENT,
        channel: "email",
        sourceId: "   ",
      }),
    ).toThrow(/per_source/);
  });

  it("produces a unique key for every (event × channel) on one shipment", () => {
    const keys = new Set<string>();
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      for (const channel of NOTIFICATION_CHANNELS) {
        keys.add(
          notificationIdempotencyKey({
            event,
            shipmentId: SHIPMENT,
            channel,
            sourceId: EVENT_A,
          }),
        );
      }
    }
    expect(keys.size).toBe(SHIPMENT_NOTIFICATION_EVENTS.length * 2);
  });
});

/* ================================================================== *
 * 4 · §17 — "provide retry handling"
 * ================================================================== */

describe("§17 — retry backoff", () => {
  it("is strictly increasing (a backoff that does not back off is a loop)", () => {
    for (let i = 1; i < RETRY_BACKOFF_SECONDS.length; i += 1) {
      expect(RETRY_BACKOFF_SECONDS[i]).toBeGreaterThan(
        RETRY_BACKOFF_SECONDS[i - 1] as number,
      );
    }
  });

  it("delays every attempt before the last, and TERMINATES at the last", () => {
    for (let attempt = 1; attempt < MAX_NOTIFICATION_ATTEMPTS; attempt += 1) {
      expect(retryDelaySeconds(attempt)).toBe(
        RETRY_BACKOFF_SECONDS[attempt - 1],
      );
    }
    // The final attempt gets no retry — the row goes `dead` and a human looks.
    expect(retryDelaySeconds(MAX_NOTIFICATION_ATTEMPTS)).toBeNull();
    expect(retryDelaySeconds(MAX_NOTIFICATION_ATTEMPTS + 50)).toBeNull();
  });

  it("is total over junk input rather than throwing inside a worker loop", () => {
    expect(retryDelaySeconds(0)).toBeNull();
    expect(retryDelaySeconds(-3)).toBeNull();
    expect(retryDelaySeconds(1.5)).toBeNull();
    expect(retryDelaySeconds(Number.NaN)).toBeNull();
  });

  it("has one delay per non-final attempt — no unreachable schedule entry", () => {
    expect(RETRY_BACKOFF_SECONDS).toHaveLength(MAX_NOTIFICATION_ATTEMPTS - 1);
  });
});

/* ================================================================== *
 * 5 · §17 — "respect user preferences"
 * ================================================================== */

describe("§17 — preference gating", () => {
  it("defaults to RECEIVE when no preference row exists", () => {
    // A shipper who booked freight asked to be told what happens to it.
    for (const channel of NOTIFICATION_CHANNELS) {
      expect(allowsChannel(null, channel)).toBe(true);
      expect(allowsChannel(undefined, channel)).toBe(true);
      expect(allowsChannel({}, channel)).toBe(true);
    }
  });

  const MATRIX: ReadonlyArray<
    [boolean | null, boolean | null, NotificationChannel, boolean]
  > = [
    [true, true, "email", true],
    [true, true, "in_app", true],
    [false, true, "email", false],
    [false, true, "in_app", true],
    [true, false, "email", true],
    [true, false, "in_app", false],
    [false, false, "email", false],
    [false, false, "in_app", false],
    [null, false, "email", true],
    [null, null, "in_app", true],
  ];

  it.each(MATRIX)(
    "email=%s inapp=%s → %s allowed: %s",
    (email, inapp, channel, expected) => {
      expect(
        allowsChannel(
          { emailShipmentUpdates: email, inappShipmentUpdates: inapp },
          channel,
        ),
      ).toBe(expected);
    },
  );

  it("refuses an unsubscribed ADDRESS even when the preference says yes", () => {
    expect(
      decideSend({
        channel: "email",
        prefs: { emailShipmentUpdates: true },
        email: "dock@acme.com",
        addressSuppressed: true,
      }),
    ).toEqual({ send: false, reason: "address_suppressed" });
  });

  it("refuses when the preference is off, whatever the address says", () => {
    expect(
      decideSend({
        channel: "email",
        prefs: { emailShipmentUpdates: false },
        email: "dock@acme.com",
        addressSuppressed: false,
      }),
    ).toEqual({ send: false, reason: "preference_off" });
  });

  it("refuses an email with no address, and never blocks in_app on one", () => {
    expect(
      decideSend({
        channel: "email",
        prefs: null,
        email: null,
        addressSuppressed: false,
      }),
    ).toEqual({ send: false, reason: "no_address" });
    expect(
      decideSend({
        channel: "in_app",
        prefs: null,
        email: null,
        addressSuppressed: true,
      }),
    ).toEqual({ send: true });
  });

  it("sends when nothing refuses", () => {
    expect(
      decideSend({
        channel: "email",
        prefs: { emailShipmentUpdates: true },
        email: "ops@acme.com",
        addressSuppressed: false,
      }),
    ).toEqual({ send: true });
  });

  it("normalises addresses so capitalisation cannot defeat a suppression", () => {
    expect(normalizeSuppressionEmail("  Dock@ACME.com ")).toBe(
      "dock@acme.com",
    );
  });

  it("accepts only UUID-shaped opt-out tokens", () => {
    expect(
      normalizeNotificationToken("8B2E6F14-1111-4222-8333-444455556666"),
    ).toBe("8b2e6f14-1111-4222-8333-444455556666");
    expect(normalizeNotificationToken("not-a-token")).toBeNull();
    expect(normalizeNotificationToken("")).toBeNull();
    expect(normalizeNotificationToken(null)).toBeNull();
    expect(normalizeNotificationToken(42)).toBeNull();
    // No SQL wildcard, no injection attempt, ever reaches a query.
    expect(normalizeNotificationToken("%")).toBeNull();
    expect(normalizeNotificationToken("' or 1=1 --")).toBeNull();
  });
});

/* ================================================================== *
 * 6 · §24 — localisation and the ru/ht mirror
 * ================================================================== */

const PAYLOAD = {
  tracking_number: "PL-2026-000458",
  event_time: "2026-08-05T14:30:00.000Z",
  public_message: "Held at the receiver's dock until a door opens.",
  eta_at: "2026-08-07T18:00:00.000Z",
  delay_minutes: 90,
  reason_public: "Traffic on I-80.",
};

describe("§24 — localisation", () => {
  it("authors en/es/fr distinctly for every one of the eleven", () => {
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      const build = SHIPMENT_EMAIL_BUILDERS[event];
      const en = build({ locale: "en", payload: PAYLOAD });
      const es = build({ locale: "es", payload: PAYLOAD });
      const fr = build({ locale: "fr", payload: PAYLOAD });
      expect(es.subject, `${event} es`).not.toBe(en.subject);
      expect(fr.subject, `${event} fr`).not.toBe(en.subject);
      expect(fr.subject, `${event} fr vs es`).not.toBe(es.subject);
    }
  });

  it("MIRRORS English for ru/ht (flagged, pending native review)", () => {
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      const build = SHIPMENT_EMAIL_BUILDERS[event];
      const en = build({ locale: "en", payload: PAYLOAD });
      expect(build({ locale: "ru", payload: PAYLOAD }).subject).toBe(en.subject);
      expect(build({ locale: "ht", payload: PAYLOAD }).subject).toBe(en.subject);
    }
  });

  it("keeps the email_log template id LOCALE-INDEPENDENT", () => {
    // A delivery log that reports five templates for one notification is
    // unqueryable. The locale is in the body, never in the identifier.
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      const ids = EMAIL_LOCALES.map(
        (l) => SHIPMENT_EMAIL_BUILDERS[event]({ locale: l, payload: PAYLOAD }).template,
      );
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).toBe(SHIPMENT_NOTIFICATION_MAP[event].template);
    }
  });

  it("localises the in-app feed copy and appends the tracking number", () => {
    const en = inAppCopy("en", "delivered", "PL-2026-000458");
    const es = inAppCopy("es", "delivered", "PL-2026-000458");
    expect(en.title).toBe("Delivered — PL-2026-000458");
    expect(es.title).toBe("Entregado — PL-2026-000458");
    expect(es.body).not.toBe(en.body);
    expect(inAppCopy("ru", "delivered", null).title).toBe("Delivered");
  });

  it("prefixes non-English paths and leaves English bare (as-needed)", () => {
    expect(localizedPath("en", "/track")).toBe("/track");
    expect(localizedPath("es", "/track")).toBe("/es/track");
    expect(localizedPath("ht", "/notifications/unsubscribe")).toBe(
      "/ht/notifications/unsubscribe",
    );
  });
});

/* ================================================================== *
 * 7 · §17 — "include tracking link", and NEVER the second factor
 * ================================================================== */

describe("§17 — the tracking link", () => {
  it("points at /track with the tracking NUMBER prefilled", () => {
    expect(trackingUrl("en", "PL-2026-000458")).toContain(
      "/track?number=PL-2026-000458",
    );
    expect(trackingUrl("fr", "PL-2026-000458")).toContain("/fr/track?number=");
  });

  it("degrades to the bare page when there is no number", () => {
    expect(trackingUrl("en", null).endsWith("/track")).toBe(true);
    expect(trackingUrl("en", "  ").endsWith("/track")).toBe(true);
  });

  it("percent-encodes rather than interpolating raw text into a URL", () => {
    expect(trackingUrl("en", "PL 2026/000458")).toContain(
      "number=PL%202026%2F000458",
    );
  });

  it("appears in EVERY one of the eleven, in EVERY locale", () => {
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      for (const locale of EMAIL_LOCALES) {
        const html = renderToStaticMarkup(
          SHIPMENT_EMAIL_BUILDERS[event]({ locale, payload: PAYLOAD }).react,
        );
        expect(html, `${event}/${locale}`).toContain(
          "/track?number=PL-2026-000458",
        );
      }
    }
  });

  it("builds the opt-out URL from a token only, never an address", () => {
    const url = optOutUrl("en", "8b2e6f14-1111-4222-8333-444455556666");
    expect(url).toContain("/notifications/unsubscribe?token=");
    expect(url).not.toContain("@");
    expect(optOutUrl("en", null)).toBeNull();
    expect(optOutUrl("en", "  ")).toBeNull();
  });

  it("renders the opt-out link when a token is supplied, and not otherwise", () => {
    const withToken = renderToStaticMarkup(
      SHIPMENT_EMAIL_BUILDERS.delivered({
        locale: "en",
        payload: PAYLOAD,
        optOutToken: "8b2e6f14-1111-4222-8333-444455556666",
      }).react,
    );
    expect(withToken).toContain("/notifications/unsubscribe?token=");
    const without = renderToStaticMarkup(
      SHIPMENT_EMAIL_BUILDERS.delivered({ locale: "en", payload: PAYLOAD }).react,
    );
    expect(without).not.toContain("/notifications/unsubscribe");
  });
});

/* ================================================================== *
 * 8 · §17/§26 — the SENTINEL SWEEP over rendered HTML
 * ================================================================== */

/**
 * Values that must never appear in a customer email, each planted in the
 * payload or nearby in the domain so that "it isn't there" is a fact about
 * the templates rather than about the fixture being empty.
 *
 * Two shapes are swept: FINANCIAL (§18 staff-only) and INTERNAL/CREDENTIAL
 * (§7's staff band, §16's signed URLs, M-73's access code).
 */
const SENTINELS: ReadonlyArray<[string, string]> = [
  ["shipper gross", "48250.00"],
  ["carrier pay", "39500.00"],
  ["margin", "MARGIN-SENTINEL-8875"],
  ["internal note", "INTERNAL-ONLY-do-not-show-customer"],
  ["dispatcher commentary", "carrier is late again, third time"],
  ["access code (M-73 second factor)", "ZQ7T4M"],
  ["signed document URL", "https://storage.example/sign?token=abc123"],
  ["bearer token", "eyJhbGciOiJIUzI1NiJ9.sentinel"],
  ["driver token", "drv_9f2c1b7e5a4d"],
  ["exact coordinates", "40.7128,-74.0060"],
];

describe("§17/§26 — no sensitive data in a rendered notification", () => {
  /**
   * TWO templates legitimately echo operator-written customer-facing text
   * (`delay_reported` and `delivery_eta_updated` render `reason_public` /
   * `public_message` — that is D-6's whole point, and the non-vacuity test
   * below proves they do). The other NINE must never render either field, so
   * poisoning those two fields is a real test for the nine and would be a
   * meaningless one for the two. They are excluded by NAME rather than by a
   * skip inside the loop, so the exclusion is a stated decision and adding a
   * twelfth template does not quietly inherit it.
   */
  const ECHOES_OPERATOR_TEXT: readonly ShipmentNotificationEvent[] = [
    "delay_reported",
    "delivery_eta_updated",
  ];

  it("never echoes operator free text from the nine templates that must not", () => {
    const poison = SENTINELS.map(([, v]) => v).join(" | ");
    const poisoned = {
      ...PAYLOAD,
      public_message: poison,
      reason_public: poison,
    };
    const swept = SHIPMENT_NOTIFICATION_EVENTS.filter(
      (e) => !ECHOES_OPERATOR_TEXT.includes(e),
    );
    expect(swept).toHaveLength(9);

    for (const event of swept) {
      for (const locale of EMAIL_LOCALES) {
        const html = renderToStaticMarkup(
          SHIPMENT_EMAIL_BUILDERS[event]({
            locale,
            payload: { ...poisoned },
            optOutToken: "8b2e6f14-1111-4222-8333-444455556666",
          }).react,
        );
        for (const [label, value] of SENTINELS) {
          expect(html, `${event}/${locale} leaked ${label}`).not.toContain(
            value,
          );
        }
      }
    }
  });

  it("never carries a financial value even when one is smuggled in", () => {
    // The payload TYPE has no amount field, so this goes in as an unknown key
    // — the case a `Record<string, unknown>` from the database could produce.
    const smuggled = {
      ...PAYLOAD,
      gross_shipper_amount: "48250.00",
      carrier_pay: "39500.00",
      internal_message: "INTERNAL-ONLY-do-not-show-customer",
      access_code: "ZQ7T4M",
      signed_url: "https://storage.example/sign?token=abc123",
    } as unknown as typeof PAYLOAD;

    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      for (const locale of EMAIL_LOCALES) {
        const html = renderToStaticMarkup(
          SHIPMENT_EMAIL_BUILDERS[event]({ locale, payload: smuggled }).react,
        );
        for (const value of [
          "48250.00",
          "39500.00",
          "INTERNAL-ONLY-do-not-show-customer",
          "ZQ7T4M",
          "https://storage.example/sign?token=abc123",
        ]) {
          expect(html, `${event}/${locale}`).not.toContain(value);
        }
      }
    }
  });

  it("DOES render the operator's customer-facing wording (non-vacuity)", () => {
    // The sweep above would pass trivially if the templates rendered nothing
    // from the payload. They do render the two customer-facing fields — this
    // is the assertion that makes the other one mean something.
    const delay = renderToStaticMarkup(
      SHIPMENT_EMAIL_BUILDERS.delay_reported({
        locale: "en",
        payload: PAYLOAD,
      }).react,
    );
    expect(delay).toContain("Traffic on I-80.");
    expect(delay).toContain("90 minutes");

    const eta = renderToStaticMarkup(
      SHIPMENT_EMAIL_BUILDERS.delivery_eta_updated({
        locale: "en",
        payload: PAYLOAD,
      }).react,
    );
    expect(eta).toContain("Traffic on I-80.");
  });

  it("never renders a raw ISO timestamp — §24 date formatting", () => {
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      const html = renderToStaticMarkup(
        SHIPMENT_EMAIL_BUILDERS[event]({ locale: "en", payload: PAYLOAD }).react,
      );
      expect(html, event).not.toContain("2026-08-05T14:30:00.000Z");
    }
  });

  it("carries §30's honest label and never claims live tracking or AI", () => {
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      for (const locale of ["en", "es", "fr"] as const) {
        const html = renderToStaticMarkup(
          SHIPMENT_EMAIL_BUILDERS[event]({ locale, payload: PAYLOAD }).react,
        ).toLowerCase();
        expect(html, `${event}/${locale}`).not.toContain("live tracking");
        expect(html, `${event}/${locale}`).not.toContain("real-time gps");
        expect(html, `${event}/${locale}`).not.toContain("ai-powered");
      }
      const en = renderToStaticMarkup(
        SHIPMENT_EMAIL_BUILDERS[event]({ locale: "en", payload: PAYLOAD }).react,
      );
      expect(en, event).toContain("Milestone tracking");
    }
  });

  it("guards the payload key-set as data too", () => {
    expect(payloadIsSafe({ tracking_number: "PL-2026-000458" })).toBe(true);
    for (const key of FORBIDDEN_PAYLOAD_KEYS) {
      expect(payloadIsSafe({ [key]: "x" }), key).toBe(false);
    }
  });
});

/* ================================================================== *
 * 9 · Subject lines carry the tracking number and nothing else
 * ================================================================== */

describe("subjects", () => {
  it("names the shipment and never a value from the payload body", () => {
    for (const event of SHIPMENT_NOTIFICATION_EVENTS) {
      for (const locale of EMAIL_LOCALES as readonly EmailLocale[]) {
        const built = SHIPMENT_EMAIL_BUILDERS[event]({
          locale,
          payload: {
            ...PAYLOAD,
            public_message: "SUBJECT-LEAK-SENTINEL",
            reason_public: "SUBJECT-LEAK-SENTINEL",
          },
        });
        expect(built.subject, `${event}/${locale}`).toContain(
          "PL-2026-000458",
        );
        expect(built.subject).not.toContain("SUBJECT-LEAK-SENTINEL");
      }
    }
  });
});

/* ================================================================== *
 * 10 · §24 / D-6 — operator text reaches the inbox RESOLVED, not raw
 * ================================================================== */

/**
 * The defect these pin is one an email suite is uniquely exposed to.
 *
 * M-73's decision D-6 stores a curated phrase as a TOKEN —
 * `ShipmentOpsForms.tsx` writes `phrase:delay.traffic` into
 * `shipment_events.public_message` and `shipments.delay_reason_public`. Every
 * on-screen surface resolves it (`TrackingResult`, `ShipmentDetailView`,
 * `CarrierShipmentDetailView` all call `resolvePublicText`). An email builder
 * that printed the stored string verbatim would mail the customer the literal
 * `phrase:delay.traffic` — in the one channel that is archived and forwarded,
 * and the one channel with no "report a problem" button next to it.
 *
 * Two properties, and both matter:
 *
 *   * a LIBRARY phrase arrives TRANSLATED, from M-73's own five-locale
 *     catalogue — not from a second copy authored in `src/emails/`, which
 *     would drift from the `/track` page the same email links to;
 *   * genuinely novel prose arrives VERBATIM under §24's honest label, never
 *     silently machine-translated.
 */
describe("§24/D-6 — phrase tokens are resolved for email", () => {
  const TOKEN = "phrase:delay.traffic";

  it("never prints a raw phrase token, in any locale, in either template", () => {
    for (const event of ["delay_reported", "delivery_eta_updated"] as const) {
      for (const locale of EMAIL_LOCALES as readonly EmailLocale[]) {
        const html = renderToStaticMarkup(
          SHIPMENT_EMAIL_BUILDERS[event]({
            locale,
            payload: { ...PAYLOAD, public_message: TOKEN, reason_public: TOKEN },
          }).react,
        );
        expect(html, `${event}/${locale}`).not.toContain("phrase:");
        expect(html, `${event}/${locale}`).not.toContain("delay.traffic");
      }
    }
  });

  it("renders the library's own translated sentence per locale", () => {
    const expected: Record<EmailLocale, string> = {
      en: "Traffic is slowing the truck down.",
      // M-73's catalogue is genuinely translated for es/fr — unlike the
      // EmailDict copy in src/emails/, where ru/ht still mirror English.
      es: "El tráfico está retrasando al camión.",
      fr: "La circulation ralentit le camion.",
      ru: "Traffic is slowing the truck down.",
      ht: "Traffic is slowing the truck down.",
    };
    for (const locale of EMAIL_LOCALES as readonly EmailLocale[]) {
      const html = renderToStaticMarkup(
        SHIPMENT_EMAIL_BUILDERS.delay_reported({
          locale,
          payload: { ...PAYLOAD, reason_public: TOKEN },
        }).react,
      );
      expect(html, locale).toContain(expected[locale]);
    }
  });

  it("labels genuinely novel dispatcher prose instead of translating it", () => {
    const free = "Receiver moved us to door 14 for the afternoon.";
    for (const locale of EMAIL_LOCALES as readonly EmailLocale[]) {
      const html = renderToStaticMarkup(
        SHIPMENT_EMAIL_BUILDERS.delay_reported({
          locale,
          payload: { ...PAYLOAD, reason_public: free },
        }).react,
      );
      // Verbatim — §24 forbids silently machine-translating operator text.
      expect(html, locale).toContain(free);
      // …under the honest label, in the READER's language (es/fr authored).
      const notice =
        locale === "es"
          ? "Escrito por dispatch, en inglés"
          : locale === "fr"
            ? "Rédigé par la régulation, en anglais"
            : "Written by dispatch, in English";
      expect(html, locale).toContain(notice);
    }
  });

  it("does NOT label a library phrase — it really is in the reader's language", () => {
    const html = renderToStaticMarkup(
      SHIPMENT_EMAIL_BUILDERS.delay_reported({
        locale: "es",
        payload: { ...PAYLOAD, reason_public: TOKEN },
      }).react,
    );
    expect(html).not.toContain("Escrito por dispatch, en inglés");
  });

  it("degrades a RETIRED phrase id to honest English, never to a token", () => {
    // A phrase removed from the library after it was stored. The customer must
    // get a readable sentence or nothing — never `phrase:delay.no_longer_here`.
    const html = renderToStaticMarkup(
      SHIPMENT_EMAIL_BUILDERS.delay_reported({
        locale: "fr",
        payload: { ...PAYLOAD, reason_public: "phrase:delay.no_longer_here" },
      }).react,
    );
    expect(html).toContain("Rédigé par la régulation, en anglais");
  });

  it("omits the row entirely for blank operator text", () => {
    const html = renderToStaticMarkup(
      SHIPMENT_EMAIL_BUILDERS.delay_reported({
        locale: "en",
        payload: { ...PAYLOAD, reason_public: "   ", public_message: null },
      }).react,
    );
    expect(html).not.toContain("From dispatch");
  });
});
