/**
 * M-79 — the shipment-notification vocabulary, mapping and policy.
 *
 * `docs/DIRECTIVE-tracking.md` §17 names eleven customer notifications and
 * nine requirements. This file is the part of §17 that is pure data and pure
 * arithmetic: what the eleven are, which shipment event produces each, how
 * the idempotency key is derived, how long a retry waits, and which
 * preference gates which channel.
 *
 * It deliberately imports NOTHING server-side — no `server-only`, no Supabase
 * client, no React. That is what lets the unit lane prove the mapping is a
 * total function, the keys are stable and the backoff is monotone, without a
 * database and without mocking a transport. The durable half lives in
 * `notification-queue.ts` (SQL) and `notification-worker.ts` (delivery).
 *
 * ── ONE DISPATCHER, AS DATA ───────────────────────────────────────────────
 *
 * The plan's M-79 row and §17 both push the same way: there must be ONE place
 * that says "this event means this template for this audience". Scattering
 * `sendEmail` calls across M-72…M-78's write paths would put eleven partial
 * copies of that decision in eleven files, and the twelfth notification would
 * be added to ten of them.
 *
 * So `SHIPMENT_NOTIFICATION_MAP` is a full `Record` over the enum — a missing
 * entry is a COMPILE error, not a silent no-send — and
 * `SHIPMENT_NOTIFICATION_RULES` is the event→notification mapping mirrored
 * from migration 0026's `shipment_notification_rules` table. The SQL is the
 * one the harvest executes; this is the one TypeScript reasons about; an
 * integration test compares them cell for cell, because drift between them is
 * the one bug neither the unit lane (no database) nor the RLS lane (no
 * TypeScript) can see. M-77 established the technique for its visibility
 * matrix and it is reused here rather than reinvented.
 */

import type {
  ShipmentEventType,
  ShipmentStatus,
} from "@/lib/shipments/types";

/* ------------------------------------------------------------------ *
 * 1 · §17's eleven customer notifications
 * ------------------------------------------------------------------ */

/**
 * The directive's own list, in the directive's own order:
 *
 *   quote accepted · carrier assigned · driver dispatched · picked up ·
 *   shipment in transit · delay reported · delivery ETA updated ·
 *   arrived at delivery · delivered · POD available · invoice available
 */
export type ShipmentNotificationEvent =
  | "quote_accepted"
  | "carrier_assigned"
  | "driver_dispatched"
  | "picked_up"
  | "in_transit"
  | "delay_reported"
  | "delivery_eta_updated"
  | "arrived_at_delivery"
  | "delivered"
  | "pod_available"
  | "invoice_available";

export const SHIPMENT_NOTIFICATION_EVENTS = [
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
] as const satisfies readonly ShipmentNotificationEvent[];

/**
 * §17: *"Channels at launch: email; in-app notifications."*
 *
 * SMS is absent rather than present-and-disabled. §17 permits it *"only when
 * Twilio or another approved provider is explicitly enabled and compliant
 * opt-in exists"*, and §30 forbids shipping a capability the product cannot
 * perform. A `"sms"` member here would immediately become a column value, a
 * preference checkbox and a promise.
 */
export type NotificationChannel = "email" | "in_app";

export const NOTIFICATION_CHANNELS = [
  "email",
  "in_app",
] as const satisfies readonly NotificationChannel[];

/** Queue lifecycle, mirroring 0026's `notification_delivery_state`. */
export type NotificationDeliveryState =
  | "pending"
  | "sending"
  | "sent"
  | "suppressed"
  | "dead";

/**
 * Who a notification is for.
 *
 * All eleven of §17's are CUSTOMER notifications, and the customer of a
 * brokerage shipment is the shipper organisation — resolved to its owner
 * member, which is precisely what M-60's shipped `getShipperOwnerRecipient`
 * already does. The type is a union of one rather than a bare string so that
 * M-81's broker audience and any future consignee audience are added by
 * widening a type the compiler then re-checks everywhere.
 */
export type NotificationAudience = "shipper_customer";

/**
 * `per_shipment` — at most one of these per shipment, ever. A milestone that
 *   is re-entered after an admin correction is the SAME news; §17's *"avoid
 *   duplicate notifications"* is about the customer's inbox, not about the
 *   ledger.
 * `per_source` — one per producing fact. Three ETA changes are three
 *   different things to say.
 */
export type DedupeScope = "per_shipment" | "per_source";

/* ------------------------------------------------------------------ *
 * 2 · event → template → audience
 * ------------------------------------------------------------------ */

export interface ShipmentNotificationSpec {
  /** `email_log.template` and the React Email builder key. One string, so a
   *  delivery-log query and a template lookup cannot disagree. */
  template: string;
  audience: NotificationAudience;
  /** `notifications.kind` for the in-app row (M-60's feed). */
  inAppKind: string;
  dedupeScope: DedupeScope;
}

/**
 * A FULL `Record`. Adding a twelfth notification without a template is a type
 * error at the point the enum grows, which is the only place it can be caught
 * before a customer notices the silence.
 */
export const SHIPMENT_NOTIFICATION_MAP: Record<
  ShipmentNotificationEvent,
  ShipmentNotificationSpec
> = {
  quote_accepted: {
    template: "shipment-quote-accepted",
    audience: "shipper_customer",
    inAppKind: "shipment_quote_accepted",
    dedupeScope: "per_shipment",
  },
  carrier_assigned: {
    template: "shipment-carrier-assigned",
    audience: "shipper_customer",
    inAppKind: "shipment_carrier_assigned",
    dedupeScope: "per_shipment",
  },
  driver_dispatched: {
    template: "shipment-driver-dispatched",
    audience: "shipper_customer",
    inAppKind: "shipment_driver_dispatched",
    dedupeScope: "per_shipment",
  },
  picked_up: {
    template: "shipment-picked-up",
    audience: "shipper_customer",
    inAppKind: "shipment_picked_up",
    dedupeScope: "per_shipment",
  },
  in_transit: {
    template: "shipment-in-transit",
    audience: "shipper_customer",
    inAppKind: "shipment_in_transit",
    dedupeScope: "per_shipment",
  },
  delay_reported: {
    template: "shipment-delay-reported",
    audience: "shipper_customer",
    inAppKind: "shipment_delay_reported",
    dedupeScope: "per_source",
  },
  delivery_eta_updated: {
    template: "shipment-eta-updated",
    audience: "shipper_customer",
    // M-78 already writes this kind for its in-app row. Reusing the string
    // keeps one feed vocabulary rather than two spellings of one fact.
    inAppKind: "shipment_eta",
    dedupeScope: "per_source",
  },
  arrived_at_delivery: {
    template: "shipment-arrived-at-delivery",
    audience: "shipper_customer",
    inAppKind: "shipment_arrived_at_delivery",
    dedupeScope: "per_shipment",
  },
  delivered: {
    template: "shipment-delivered",
    audience: "shipper_customer",
    inAppKind: "shipment_delivered",
    dedupeScope: "per_shipment",
  },
  pod_available: {
    template: "shipment-pod-available",
    audience: "shipper_customer",
    inAppKind: "shipment_pod_available",
    dedupeScope: "per_shipment",
  },
  invoice_available: {
    template: "shipment-invoice-available",
    audience: "shipper_customer",
    inAppKind: "shipment_invoice_available",
    dedupeScope: "per_source",
  },
};

/* ------------------------------------------------------------------ *
 * 3 · shipment event → notification (the mirror of 0026's rules table)
 * ------------------------------------------------------------------ */

export interface ShipmentNotificationRule {
  notificationEvent: ShipmentNotificationEvent;
  sourceEventType: ShipmentEventType;
  /** null = any status the event asserts (or none). */
  matchStatus: ShipmentStatus | null;
  /** jsonb containment filter against `shipment_events.metadata`. */
  matchMetadata: Record<string, string>;
  /** Require the event to be published to a customer band (not `staff_only`). */
  requireCustomerVisible: boolean;
  dedupeScope: DedupeScope;
}

/**
 * Transcribed from migration 0026 section 2 — and the integration test reads
 * the TABLE and compares, so a future edit to one and not the other fails
 * loudly rather than silently halving the notification set.
 *
 * Two rules deserve their reasoning restated here, where a reader of the
 * TypeScript will find it:
 *
 *   * **`pod_available` keys on APPROVAL, not on the `pod_uploaded` status.**
 *     0024 makes an unapproved POD unreadable by the shipper. Announcing
 *     availability the moment a driver uploads would be a link to a document
 *     the customer is not licensed to open — §30's fake-capability rule
 *     applied to a hyperlink.
 *   * **`delay_reported` requires a customer-visible band.** M-78 writes an
 *     exception `staff_only` when it has no public description. Telling a
 *     customer "there is a delay" while deliberately withholding what it is
 *     is worse than the silence, and §21's calm-explanation rule says so.
 */
export const SHIPMENT_NOTIFICATION_RULES: readonly ShipmentNotificationRule[] =
  [
    milestone("quote_accepted", "quote_accepted"),
    milestone("carrier_assigned", "carrier_assigned"),
    milestone("driver_dispatched", "dispatched"),
    milestone("picked_up", "picked_up"),
    milestone("in_transit", "in_transit"),
    milestone("arrived_at_delivery", "arrived_at_delivery"),
    milestone("delivered", "delivered"),
    {
      notificationEvent: "delay_reported",
      sourceEventType: "exception_opened",
      matchStatus: null,
      matchMetadata: {},
      requireCustomerVisible: true,
      dedupeScope: "per_source",
    },
    {
      notificationEvent: "delay_reported",
      sourceEventType: "status_change",
      matchStatus: "delayed",
      matchMetadata: {},
      requireCustomerVisible: true,
      dedupeScope: "per_source",
    },
    {
      notificationEvent: "delivery_eta_updated",
      sourceEventType: "eta_update",
      matchStatus: null,
      matchMetadata: { eta_kind: "delivery" },
      requireCustomerVisible: false,
      dedupeScope: "per_source",
    },
    {
      notificationEvent: "pod_available",
      sourceEventType: "document_approved",
      matchStatus: null,
      matchMetadata: { doc_type: "pod", decision: "approved" },
      requireCustomerVisible: false,
      dedupeScope: "per_shipment",
    },
  ];

function milestone(
  notificationEvent: ShipmentNotificationEvent,
  status: ShipmentStatus,
): ShipmentNotificationRule {
  return {
    notificationEvent,
    sourceEventType: "status_change",
    matchStatus: status,
    matchMetadata: {},
    requireCustomerVisible: false,
    dedupeScope: "per_shipment",
  };
}

/**
 * §17's eleventh notification has NO `shipment_events` producer, and saying so
 * explicitly is better than leaving a reader to notice the gap. An invoice is
 * a row in `invoices` (0021's shipper linkage), not a timeline entry; the
 * harvest reads that table directly. Nothing writes a shipper invoice today —
 * that is M-96 — so the honest present-tense answer is "none found", not a
 * fabricated notification.
 */
export const EVENT_SOURCED_NOTIFICATIONS: readonly ShipmentNotificationEvent[] =
  SHIPMENT_NOTIFICATION_RULES.map((r) => r.notificationEvent);

/* ------------------------------------------------------------------ *
 * 4 · §17 — "use idempotency keys"
 * ------------------------------------------------------------------ */

export interface IdempotencyKeyParts {
  event: ShipmentNotificationEvent;
  shipmentId: string;
  channel: NotificationChannel;
  /**
   * The producing fact's id — a `shipment_events.id`, an `invoices.id`.
   * Required for `per_source` scope, ignored for `per_shipment`.
   */
  sourceId?: string | null;
}

export const IDEMPOTENCY_KEY_PREFIX = "m79";

/**
 * Derive the unique key 0026's `idempotency_key` column enforces.
 *
 * Four properties, each of which a test pins:
 *
 *   1. DETERMINISTIC — same inputs, same key, in TypeScript and in SQL. The
 *      harvest builds the identical string; that is what lets an inline
 *      enqueue and a background harvest of the same fact collapse into one
 *      row instead of two emails.
 *   2. SCOPED BY CHANNEL — the email and the in-app row are separate
 *      deliveries with separate failure modes. A single key for both would
 *      mean a failed email blocks the feed row, or a sent feed row suppresses
 *      the email.
 *   3. COLLAPSES `per_shipment` — the discriminator is the literal `once`, so
 *      a corrected status that re-enters `delivered` finds the key taken.
 *   4. SEPARATES `per_source` — the discriminator is the source id, so three
 *      ETA changes are three keys.
 *
 * A `per_source` key with no source id would silently collapse into
 * `per_shipment` behaviour — a customer told once about the first of five
 * delays. It throws instead: an unsendable notification is a bug to fix, not
 * a silence to ship.
 */
export function notificationIdempotencyKey(
  parts: IdempotencyKeyParts,
): string {
  const scope = SHIPMENT_NOTIFICATION_MAP[parts.event].dedupeScope;
  let discriminator: string;
  if (scope === "per_shipment") {
    discriminator = "once";
  } else {
    const source = (parts.sourceId ?? "").trim();
    if (source === "") {
      throw new Error(
        `notificationIdempotencyKey: "${parts.event}" is per_source and needs a sourceId`,
      );
    }
    discriminator = source;
  }
  return [
    IDEMPOTENCY_KEY_PREFIX,
    parts.event,
    parts.shipmentId,
    discriminator,
    parts.channel,
  ].join(":");
}

/* ------------------------------------------------------------------ *
 * 5 · §17 — "provide retry handling"
 * ------------------------------------------------------------------ */

/**
 * Exponential backoff with a cap, in seconds, indexed by the attempt that
 * just FAILED (1-based).
 *
 * The shape is chosen for what a transient email failure actually looks like:
 * a provider 5xx or a network blip clears in seconds, so the first retry is
 * fast; a rate limit or a DNS problem clears in minutes; anything still
 * failing after three hours is not transient and a human should see it. Six
 * attempts spread over ~4h35m, then `dead`.
 *
 * Deliberately a TABLE and not `Math.pow`: the schedule is a product decision
 * that gets tuned, and a lookup makes the tuning visible in review and exact
 * in a test. `retryDelaySeconds` is total over the integers — an attempt past
 * the end returns null, which `settle_shipment_notification` reads as "no more
 * retries" and moves the row to `dead`.
 */
export const RETRY_BACKOFF_SECONDS: readonly number[] = [
  60, // 1 min
  300, // 5 min
  900, // 15 min
  3600, // 1 h
  10800, // 3 h
];

/** Must equal 0026's `shipment_notification_queue.max_attempts` default. */
export const MAX_NOTIFICATION_ATTEMPTS = 6;

export function retryDelaySeconds(failedAttempt: number): number | null {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) return null;
  if (failedAttempt >= MAX_NOTIFICATION_ATTEMPTS) return null;
  return RETRY_BACKOFF_SECONDS[failedAttempt - 1] ?? null;
}

/* ------------------------------------------------------------------ *
 * 6 · §17 — "respect user preferences"
 * ------------------------------------------------------------------ */

/**
 * The two booleans 0026 adds to `user_preferences`, plus the address-level
 * suppression the worker resolves separately.
 *
 * `undefined`/`null` means NO PREFERENCE ROW, which is the common case for an
 * account that has never opened its preferences page. It resolves to
 * "receive" — a shipper who booked freight asked to be told what happens to
 * it, and defaulting a transactional update to off would be a silent service
 * downgrade dressed as privacy.
 */
export interface NotificationPreferences {
  emailShipmentUpdates?: boolean | null;
  inappShipmentUpdates?: boolean | null;
}

export function allowsChannel(
  prefs: NotificationPreferences | null | undefined,
  channel: NotificationChannel,
): boolean {
  if (!prefs) return true;
  const value =
    channel === "email"
      ? prefs.emailShipmentUpdates
      : prefs.inappShipmentUpdates;
  return value === null || value === undefined ? true : value === true;
}

/**
 * The whole send decision for one queue row, in one place.
 *
 * The address suppression is checked separately from the preference because
 * they answer different questions — *does this ACCOUNT want mail* versus *may
 * we write to this ADDRESS at all* — and a shared mailbox
 * (`dispatch@acme.com`) can be opted out without an account existing for it.
 * Either one refusing is a refusal.
 */
export type SendDecision =
  | { send: true }
  | { send: false; reason: "preference_off" | "address_suppressed" | "no_address" };

export function decideSend(args: {
  channel: NotificationChannel;
  prefs: NotificationPreferences | null | undefined;
  email: string | null;
  addressSuppressed: boolean;
}): SendDecision {
  if (!allowsChannel(args.prefs, args.channel)) {
    return { send: false, reason: "preference_off" };
  }
  if (args.channel === "email") {
    if (!args.email) return { send: false, reason: "no_address" };
    if (args.addressSuppressed) {
      return { send: false, reason: "address_suppressed" };
    }
  }
  return { send: true };
}

/** Normalise an address for suppression lookups. 0026 stores lowercase. */
export function normalizeSuppressionEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/* ------------------------------------------------------------------ *
 * 7 · The payload (§17 "do not expose sensitive data")
 * ------------------------------------------------------------------ */

/**
 * Everything a shipment notification may carry, and nothing else.
 *
 * Every field here is one §8's public tracking page already shows to anybody
 * holding two factors. What is ABSENT is the point: no `gross_shipper_amount`
 * or `carrier_pay` (§18 staff-only), no `internal_message` (§7 staff band), no
 * document contents or signed URLs (§16 — a signed URL in an inbox outlives
 * its 300 seconds in the mail archive), no access code (M-73's threat model),
 * no exact coordinates (§26).
 *
 * 0026 backs three of those with a CHECK constraint, so a payload carrying
 * them is a write failure rather than a review comment.
 */
export interface ShipmentNotificationPayload {
  tracking_number?: string | null;
  event_time?: string | null;
  /** Operator-written customer-facing wording (§24 D-6 — never translated). */
  public_message?: string | null;
  eta_at?: string | null;
  delay_minutes?: number | null;
  reason_public?: string | null;
}

/**
 * Key shapes that must never appear in a notification payload or a rendered
 * email. Used by the queue writer AND by the unit lane's sentinel sweep over
 * rendered HTML, so the same list guards the data and the output.
 */
export const FORBIDDEN_PAYLOAD_KEYS: readonly string[] = [
  "signed_url",
  "signedUrl",
  "access_code",
  "accessCode",
  "internal_message",
  "internalMessage",
  "internal_note",
  "gross_shipper_amount",
  "carrier_pay",
  "margin",
  "rate_confirmation",
  "token",
];

/** True when a payload object carries anything §17 forbids. */
export function payloadIsSafe(payload: Record<string, unknown>): boolean {
  return !Object.keys(payload).some((key) =>
    FORBIDDEN_PAYLOAD_KEYS.includes(key),
  );
}
