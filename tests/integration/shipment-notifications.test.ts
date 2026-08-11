import { beforeAll, describe, expect, it } from "vitest";

import {
  count,
  exec,
  json,
  lit,
  litOrNull,
  openBrokerageGate,
  scalar,
  sqlstateOf,
} from "./helpers/db";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  notificationIdempotencyKey,
  retryDelaySeconds,
  SHIPMENT_NOTIFICATION_EVENTS,
  SHIPMENT_NOTIFICATION_MAP,
  SHIPMENT_NOTIFICATION_RULES,
} from "@/lib/shipments/notification-rules";

/**
 * M-79 — §17's notification pipeline, end to end on PG16.
 *
 * ── §27's TENTH NAMED TEST ───────────────────────────────────────────────
 *
 * `FINAL-IMPLEMENTATION-PLAN` §4 restores the §27 integration tier as eleven
 * named tests. This file is **"notification generation"** — the tenth — and
 * with M-78 having landed "exception lifecycle", M-83b's list is complete.
 *
 * ── THE FIVE THINGS ONLY THIS LANE CAN PROVE ─────────────────────────────
 *
 *   1. **THE HARVEST MAPPING MATCHES THE TYPESCRIPT MAPPING.** M-77
 *      established the technique: a mapping that exists in a table AND in a
 *      `Record` is one bug away from drifting, and neither the unit lane (no
 *      database) nor the RLS lane (no TypeScript) can see it. Every rule is
 *      compared cell for cell in both directions.
 *
 *   2. **IDEMPOTENCY IS A UNIQUE INDEX, NOT A CONVENTION.** The TypeScript
 *      derives a key; the SQL derives the same key; a duplicate enqueue is
 *      absorbed by the database, not by a check the caller might skip. This
 *      lane runs the harvest TWICE over the same events and asserts zero new
 *      rows — a harvest that duplicates on re-run is a harvest nobody can
 *      safely schedule.
 *
 *   3. **`for update skip locked` IS REAL.** Two claims in a row take
 *      disjoint sets, which is what stops two overlapping cron invocations
 *      from double-sending.
 *
 *   4. **RETRY WITH BACKOFF MOVES THE ROW FORWARD IN TIME.** Settling a
 *      failure with a delay makes the row invisible to the next claim and
 *      visible again after it — asserted by claiming, not by reading a column.
 *
 *   5. **AN OPT-OUT SUPPRESSES AT THE SOURCE.** A customer with
 *      `email_shipment_updates = false` produces no email queue row at all,
 *      while their in-app row is untouched — the two channels are independent
 *      preferences and the harvest honours both.
 *
 * Everything runs against the real migration chain. The mapping, the key
 * derivation and the backoff table are imported unmodified from `src/`.
 */

const SHIPPER = "22222222-2222-2222-2222-222222220790";
const SHIPPER_B = "22222222-2222-2222-2222-222222220791";
const CARRIER = "11111111-1111-1111-1111-111111110790";
const DISPATCHER = "00000000-0000-0000-0000-0000000e0790";
const SHIPPER_USER = "00000000-0000-0000-0000-0000000a0790";
const SHIPPER_B_USER = "00000000-0000-0000-0000-0000000a0791";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function createShipment(
  trackingNumber: string,
  shipperId: string = SHIPPER,
): string {
  const id = scalar(
    `insert into shipments (tracking_number, shipper_id, carrier_id,
       dispatcher_id, origin_city, origin_state, destination_city,
       destination_state, equipment, distance_miles)
     values (${lit(trackingNumber)}, ${lit(shipperId)}, ${lit(CARRIER)},
       ${lit(DISPATCHER)}, 'Newark', 'NJ', 'Columbus', 'OH', 'dry-van', 480)
     returning id`,
  );
  if (!id) throw new Error("shipment insert returned no id");
  return id;
}

/** Append a status-change event exactly as M-72's engine writes one. */
function statusEvent(
  shipmentId: string,
  status: string,
  visibility: string = "shipper",
): string {
  const id = scalar(
    `insert into shipment_events (shipment_id, event_type, status, source,
       created_by, visibility)
     values (${lit(shipmentId)}, 'status_change', ${lit(status)}, 'dispatcher',
       ${lit(DISPATCHER)}, ${lit(visibility)})
     returning id`,
  );
  if (!id) throw new Error("event insert returned no id");
  return id;
}

function metadataEvent(args: {
  shipmentId: string;
  eventType: string;
  metadata: Record<string, unknown>;
  visibility?: string;
  publicMessage?: string | null;
}): string {
  const id = scalar(
    `insert into shipment_events (shipment_id, event_type, source, created_by,
       visibility, public_message, metadata)
     values (${lit(args.shipmentId)}, ${lit(args.eventType)}, 'dispatcher',
       ${lit(DISPATCHER)}, ${lit(args.visibility ?? "shipper")},
       ${litOrNull(args.publicMessage ?? null)},
       ${lit(JSON.stringify(args.metadata))}::jsonb)
     returning id`,
  );
  if (!id) throw new Error("event insert returned no id");
  return id;
}

interface HarvestEnvelope {
  scanned: number;
  enqueued: number;
  from: string;
  through: string;
}

function harvest(): HarvestEnvelope {
  return json<HarvestEnvelope>(`select harvest_shipment_notifications(500)`);
}

/** Rewind the watermark so a harvest sees everything written in this run. */
function rewindWatermark(): void {
  exec(
    `update shipment_notification_watermark
        set harvested_through = now() - interval '1 day' where id`,
  );
}

interface ClaimedRow {
  id: string;
  notification_event: string;
  channel: string;
  state: string;
  attempts: number;
  idempotency_key: string;
  payload: Record<string, unknown>;
}

/**
 * Claim a batch.
 *
 * The default is deliberately LARGE. `claim_shipment_notifications` orders by
 * `(available_at asc, created_at asc)` — not a total order: rows harvested in
 * one statement share both timestamps, so which of them a bounded batch takes
 * is unspecified. With the production default of 25 and a queue that grows as
 * the suite runs, a test asserting on one specific row passed or failed
 * depending on how the ties happened to sort. That is a test defect, not an
 * application one: a work queue owes no particular order among rows that are
 * equally due. Tests that care about a specific row therefore claim a batch
 * big enough to contain the whole queue, and the two that assert a row is
 * NOT claimable pass an explicit limit for the same reason.
 */
function claim(limit = 200): ClaimedRow[] {
  const raw = scalar(
    `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
       from claim_shipment_notifications(${limit}) t`,
  );
  return JSON.parse(raw ?? "[]") as ClaimedRow[];
}

function settle(args: {
  id: string;
  outcome: string;
  providerMessageId?: string | null;
  error?: string | null;
  retryAfterSeconds?: number | null;
}): { id: string; state: string; attempts: number; available_at: string } {
  return json(
    `select settle_shipment_notification(${lit(args.id)}, ${lit(args.outcome)},
       ${litOrNull(args.providerMessageId ?? null)},
       ${litOrNull(args.error ?? null)},
       ${args.retryAfterSeconds ?? "null"})`,
  );
}

function queueFor(shipmentId: string, channel?: string): number {
  return count(
    `select count(*) from shipment_notification_queue
      where shipment_id = ${lit(shipmentId)}
      ${channel ? `and channel = ${lit(channel)}` : ""}`,
  );
}

beforeAll(() => {
  openBrokerageGate();
  exec(`insert into auth.users (id, email) values
      (${lit(DISPATCHER)}, 'm79-dispatcher@integration.test'),
      (${lit(SHIPPER_USER)}, 'm79-shipper@integration.test'),
      (${lit(SHIPPER_B_USER)}, 'm79-shipper-b@integration.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(DISPATCHER)}, 'dispatcher', 'M79 Dispatcher'),
      (${lit(SHIPPER_USER)}, 'shipper', 'M79 Shipper User'),
      (${lit(SHIPPER_B_USER)}, 'shipper', 'M79 Shipper B User')
    on conflict do nothing`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER)}, 'M79 Shipper Inc'),
      (${lit(SHIPPER_B)}, 'M79 Opted Out Inc') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER)}, 'M79 Carrier', true) on conflict do nothing`);
  exec(`insert into shipper_memberships (shipper_id, profile_id, role) values
      (${lit(SHIPPER)}, ${lit(SHIPPER_USER)}, 'owner'),
      (${lit(SHIPPER_B)}, ${lit(SHIPPER_B_USER)}, 'owner')
    on conflict do nothing`);
});

/* ================================================================== *
 * 1 · The mapping table matches the TypeScript, cell for cell
 * ================================================================== */

describe("§17 — the rules table and SHIPMENT_NOTIFICATION_RULES agree", () => {
  interface DbRule {
    notification_event: string;
    source_event_type: string;
    match_status: string | null;
    match_metadata: Record<string, string>;
    require_customer_visible: boolean;
    dedupe_scope: string;
  }

  const dbRules = (): DbRule[] =>
    JSON.parse(
      scalar(
        `select coalesce(jsonb_agg(to_jsonb(t) order by t.notification_event,
             t.source_event_type), '[]'::jsonb)
           from (select notification_event, source_event_type, match_status,
                   match_metadata, require_customer_visible, dedupe_scope
                   from shipment_notification_rules) t`,
      ) ?? "[]",
    ) as DbRule[];

  it("has the same NUMBER of rules on both sides", () => {
    expect(dbRules()).toHaveLength(SHIPMENT_NOTIFICATION_RULES.length);
  });

  it("matches every TypeScript rule with a database row", () => {
    const rows = dbRules();
    for (const rule of SHIPMENT_NOTIFICATION_RULES) {
      const match = rows.find(
        (r) =>
          r.notification_event === rule.notificationEvent &&
          r.source_event_type === rule.sourceEventType &&
          (r.match_status ?? null) === rule.matchStatus,
      );
      expect(
        match,
        `no DB rule for ${rule.notificationEvent}←${rule.sourceEventType}`,
      ).toBeDefined();
      expect(match?.match_metadata).toEqual(rule.matchMetadata);
      expect(match?.require_customer_visible).toBe(rule.requireCustomerVisible);
      expect(match?.dedupe_scope).toBe(rule.dedupeScope);
    }
  });

  it("matches every database row with a TypeScript rule (other direction)", () => {
    for (const row of dbRules()) {
      const match = SHIPMENT_NOTIFICATION_RULES.find(
        (r) =>
          r.notificationEvent === row.notification_event &&
          r.sourceEventType === row.source_event_type &&
          r.matchStatus === (row.match_status ?? null),
      );
      expect(
        match,
        `DB rule ${row.notification_event}←${row.source_event_type} has no TS twin`,
      ).toBeDefined();
    }
  });

  it("uses the SAME dedupe scope as the notification map", () => {
    for (const rule of SHIPMENT_NOTIFICATION_RULES) {
      expect(SHIPMENT_NOTIFICATION_MAP[rule.notificationEvent].dedupeScope).toBe(
        rule.dedupeScope,
      );
    }
  });

  it("has an enum value for every one of §17's eleven", () => {
    const values = JSON.parse(
      scalar(
        `select jsonb_agg(e.enumlabel order by e.enumsortorder)
           from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'shipment_notification_event'`,
      ) ?? "[]",
    ) as string[];
    expect(values).toEqual([...SHIPMENT_NOTIFICATION_EVENTS]);
  });

  it("keeps max_attempts in step with the TypeScript backoff table", () => {
    expect(
      count(
        `select column_default::int from information_schema.columns
          where table_name = 'shipment_notification_queue'
            and column_name = 'max_attempts'`,
      ),
    ).toBe(MAX_NOTIFICATION_ATTEMPTS);
  });
});

/* ================================================================== *
 * 2 · §27 "notification generation" — event → queue → claim → settle
 * ================================================================== */

describe("§27 — notification generation, end to end", () => {
  it("harvests a milestone status change into BOTH channels", () => {
    const shipment = createShipment("PL-2026-790001");
    statusEvent(shipment, "picked_up");
    rewindWatermark();

    const result = harvest();
    expect(result.enqueued).toBeGreaterThanOrEqual(2);

    const rows = JSON.parse(
      scalar(
        `select coalesce(jsonb_agg(to_jsonb(t) order by t.channel), '[]'::jsonb)
           from (select notification_event, channel, state, idempotency_key,
                   payload, recipient_profile_id
                   from shipment_notification_queue
                  where shipment_id = ${lit(shipment)}) t`,
      ) ?? "[]",
    ) as Array<{
      notification_event: string;
      channel: string;
      state: string;
      idempotency_key: string;
      payload: Record<string, unknown>;
      recipient_profile_id: string;
    }>;

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.channel)).toEqual(["email", "in_app"]);
    for (const row of rows) {
      expect(row.notification_event).toBe("picked_up");
      expect(row.state).toBe("pending");
      // The AUDIENCE: §17's customer is the shipper org's owner member.
      expect(row.recipient_profile_id).toBe(SHIPPER_USER);
      // The payload carries the tracking number and no financial field.
      expect(row.payload.tracking_number).toBe("PL-2026-790001");
      expect(row.payload).not.toHaveProperty("gross_shipper_amount");
    }
  });

  it("derives the SAME idempotency key in SQL as in TypeScript", () => {
    const shipment = createShipment("PL-2026-790002");
    statusEvent(shipment, "delivered");
    rewindWatermark();
    harvest();

    const key = scalar(
      `select idempotency_key from shipment_notification_queue
        where shipment_id = ${lit(shipment)} and channel = 'email'`,
    );
    expect(key).toBe(
      notificationIdempotencyKey({
        event: "delivered",
        shipmentId: shipment,
        channel: "email",
      }),
    );
  });

  it("claims, settles `sent`, and records the provider response", () => {
    const shipment = createShipment("PL-2026-790003");
    statusEvent(shipment, "in_transit");
    rewindWatermark();
    harvest();

    const claimed = claim().filter((r) => r.notification_event === "in_transit");
    expect(claimed.length).toBeGreaterThanOrEqual(2);
    const email = claimed.find((r) => r.channel === "email");
    expect(email).toBeDefined();
    expect(email?.state).toBe("sending");
    expect(email?.attempts).toBe(1);

    const settled = settle({
      id: email!.id,
      outcome: "sent",
      providerMessageId: "prov_m79_001",
    });
    expect(settled.state).toBe("sent");

    const row = json<{
      state: string;
      sent_at: string | null;
      provider_message_id: string | null;
      locked_at: string | null;
    }>(
      `select to_jsonb(t) from (select state, sent_at, provider_message_id,
         locked_at from shipment_notification_queue where id = ${lit(email!.id)}) t`,
    );
    expect(row.state).toBe("sent");
    expect(row.sent_at).not.toBeNull();
    expect(row.provider_message_id).toBe("prov_m79_001");
    expect(row.locked_at).toBeNull();

    // §17 "log notification attempts" — one ledger row per attempt.
    const attempt = json<{
      attempt_no: number;
      outcome: string;
      provider_message_id: string | null;
    }>(
      `select to_jsonb(t) from (select attempt_no, outcome, provider_message_id
         from shipment_notification_attempts where queue_id = ${lit(email!.id)}) t`,
    );
    expect(attempt.attempt_no).toBe(1);
    expect(attempt.outcome).toBe("sent");
    expect(attempt.provider_message_id).toBe("prov_m79_001");
  });

  it("narrows an ETA update to DELIVERY and ignores a PICKUP one", () => {
    const shipment = createShipment("PL-2026-790004");
    metadataEvent({
      shipmentId: shipment,
      eventType: "eta_update",
      metadata: { eta_kind: "pickup", new_at: "2026-08-09T12:00:00Z" },
    });
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(0);

    metadataEvent({
      shipmentId: shipment,
      eventType: "eta_update",
      metadata: {
        eta_kind: "delivery",
        new_at: "2026-08-10T12:00:00Z",
        reason_public: "Traffic on I-80.",
      },
    });
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(2);

    const payload = json<Record<string, unknown>>(
      `select payload from shipment_notification_queue
        where shipment_id = ${lit(shipment)} and channel = 'email'`,
    );
    expect(payload.eta_at).toBe("2026-08-10T12:00:00Z");
    expect(payload.reason_public).toBe("Traffic on I-80.");
  });

  it("notifies a POD on APPROVAL and never on a bare upload", () => {
    const shipment = createShipment("PL-2026-790005");
    metadataEvent({
      shipmentId: shipment,
      eventType: "document_uploaded",
      metadata: { doc_type: "pod" },
    });
    // An approval of the WRONG document type must not fire it either.
    metadataEvent({
      shipmentId: shipment,
      eventType: "document_approved",
      metadata: { doc_type: "bol", decision: "approved" },
    });
    // Nor a REJECTED POD.
    metadataEvent({
      shipmentId: shipment,
      eventType: "document_approved",
      metadata: { doc_type: "pod", decision: "rejected" },
    });
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(0);

    metadataEvent({
      shipmentId: shipment,
      eventType: "document_approved",
      metadata: { doc_type: "pod", decision: "approved" },
    });
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(2);
  });

  it("withholds a delay whose exception was never described to the customer", () => {
    const shipment = createShipment("PL-2026-790006");
    // M-78 writes `staff_only` when there is no public description. Telling a
    // customer "there is a delay" while withholding what it is is worse than
    // the silence (§21).
    metadataEvent({
      shipmentId: shipment,
      eventType: "exception_opened",
      metadata: { exception_type: "traffic" },
      visibility: "staff_only",
    });
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(0);

    metadataEvent({
      shipmentId: shipment,
      eventType: "exception_opened",
      metadata: { exception_type: "traffic" },
      visibility: "shipper",
      publicMessage: "Held at the receiver's dock.",
    });
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(2);
    expect(
      scalar(
        `select payload ->> 'public_message' from shipment_notification_queue
          where shipment_id = ${lit(shipment)} and channel = 'email'`,
      ),
    ).toBe("Held at the receiver's dock.");
  });

  it("produces NOTHING for a status §17 does not name", () => {
    const shipment = createShipment("PL-2026-790007");
    for (const status of ["quote_sent", "carrier_search", "loading", "unloading"]) {
      statusEvent(shipment, status);
    }
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(0);
  });
});

/* ================================================================== *
 * 3 · §17 — dedupe
 * ================================================================== */

describe("§17 — duplicate enqueue collapses", () => {
  it("re-running the harvest over the same events enqueues NOTHING new", () => {
    const shipment = createShipment("PL-2026-790010");
    statusEvent(shipment, "delivered");
    rewindWatermark();
    const first = harvest();
    expect(first.enqueued).toBeGreaterThanOrEqual(2);

    rewindWatermark();
    const second = harvest();
    // Scanned again (the overlap window is deliberate); enqueued nothing.
    expect(second.scanned).toBeGreaterThan(0);
    expect(queueFor(shipment)).toBe(2);
  });

  it("COLLAPSES a per_shipment milestone re-entered after a correction", () => {
    const shipment = createShipment("PL-2026-790011");
    statusEvent(shipment, "delivered");
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(2);

    // A correction re-asserts `delivered`. Same news, same key, one row.
    statusEvent(shipment, "delivered");
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(2);
  });

  it("SEPARATES per_source ETA changes — three changes are three emails", () => {
    const shipment = createShipment("PL-2026-790012");
    for (const day of ["08", "09", "10"]) {
      metadataEvent({
        shipmentId: shipment,
        eventType: "eta_update",
        metadata: { eta_kind: "delivery", new_at: `2026-08-${day}T12:00:00Z` },
      });
    }
    rewindWatermark();
    harvest();
    expect(queueFor(shipment, "email")).toBe(3);
  });

  it("refuses a direct enqueue with a duplicate key, returning the ORIGINAL", () => {
    const shipment = createShipment("PL-2026-790013");
    const key = notificationIdempotencyKey({
      event: "delivered",
      shipmentId: shipment,
      channel: "email",
    });
    const first = json<{ id: string; deduped: boolean }>(
      `select enqueue_shipment_notification(${lit(shipment)}, 'delivered',
         'email', ${lit(SHIPPER_USER)}, ${lit(key)}, '{}'::jsonb, null)`,
    );
    expect(first.deduped).toBe(false);

    const second = json<{ id: string; deduped: boolean }>(
      `select enqueue_shipment_notification(${lit(shipment)}, 'delivered',
         'email', ${lit(SHIPPER_USER)}, ${lit(key)}, '{}'::jsonb, null)`,
    );
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(queueFor(shipment, "email")).toBe(1);
  });

  it("refuses an enqueue with no idempotency key at all", () => {
    const shipment = createShipment("PL-2026-790014");
    expect(
      sqlstateOf(
        `select enqueue_shipment_notification(${lit(shipment)}, 'delivered',
           'email', ${lit(SHIPPER_USER)}, '   ', '{}'::jsonb, null)`,
      ),
    ).toBe("PL422");
  });
});

/* ================================================================== *
 * 4 · §17 — retry with backoff
 * ================================================================== */

describe("§17 — retry with backoff", () => {
  it("moves a failed row into the FUTURE and out of the next claim", () => {
    const shipment = createShipment("PL-2026-790020");
    statusEvent(shipment, "arrived_at_delivery");
    rewindWatermark();
    harvest();

    const email = claim().find(
      (r) =>
        r.notification_event === "arrived_at_delivery" && r.channel === "email",
    );
    expect(email).toBeDefined();

    const delay = retryDelaySeconds(1);
    expect(delay).toBe(60);
    const settled = settle({
      id: email!.id,
      outcome: "failed",
      error: "502 upstream",
      retryAfterSeconds: delay,
    });
    expect(settled.state).toBe("pending");

    // It is genuinely not due: a claim right now does not take it.
    const again = claim(200).map((r) => r.id);
    expect(again).not.toContain(email!.id);

    // Fast-forward and it comes back.
    exec(
      `update shipment_notification_queue set available_at = now() - interval '1 second'
        where id = ${lit(email!.id)}`,
    );
    const retried = claim(200).find((r) => r.id === email!.id);
    expect(retried).toBeDefined();
    expect(retried?.attempts).toBe(2);
  });

  it("goes DEAD when the retries are exhausted, not pending forever", () => {
    const shipment = createShipment("PL-2026-790021");
    statusEvent(shipment, "carrier_assigned");
    rewindWatermark();
    harvest();

    const email = claim().find(
      (r) => r.notification_event === "carrier_assigned" && r.channel === "email",
    );
    expect(email).toBeDefined();

    // Burn every attempt through the real backoff table.
    let attempt = 1;
    let state = "";
    while (attempt <= MAX_NOTIFICATION_ATTEMPTS) {
      state = settle({
        id: email!.id,
        outcome: "failed",
        error: "still failing",
        retryAfterSeconds: retryDelaySeconds(attempt),
      }).state;
      if (state === "dead") break;
      exec(
        `update shipment_notification_queue
            set available_at = now() - interval '1 second' where id = ${lit(email!.id)}`,
      );
      claim(200);
      attempt += 1;
    }
    expect(state).toBe("dead");
    expect(attempt).toBe(MAX_NOTIFICATION_ATTEMPTS);

    // One ledger row per attempt — the operational fact a queue row alone
    // cannot answer ("resend has been failing since 14:00").
    expect(
      count(
        `select count(*) from shipment_notification_attempts
          where queue_id = ${lit(email!.id)}`,
      ),
    ).toBe(MAX_NOTIFICATION_ATTEMPTS);
  });

  it("keeps the attempt ledger APPEND-ONLY, even for the owner", () => {
    expect(
      sqlstateOf(
        `update shipment_notification_attempts set outcome = 'sent' where outcome = 'failed'`,
      ),
    ).toBe("PL409");
    expect(sqlstateOf(`delete from shipment_notification_attempts`)).toBe(
      "PL409",
    );
  });

  it("never reclaims a row two workers are both looking at", () => {
    const shipment = createShipment("PL-2026-790022");
    statusEvent(shipment, "dispatched");
    rewindWatermark();
    harvest();

    const first = claim(200).map((r) => r.id);
    expect(first.length).toBeGreaterThan(0);
    const second = claim(200).map((r) => r.id);
    // Every row the first claim took is `sending` with a fresh lock, so the
    // second claim (same instant, TTL not expired) cannot take it back.
    for (const id of first) expect(second).not.toContain(id);
  });

  it("treats a suppression as TERMINAL — no retry, no failure", () => {
    const shipment = createShipment("PL-2026-790023");
    statusEvent(shipment, "quote_accepted");
    rewindWatermark();
    harvest();
    const email = claim().find(
      (r) => r.notification_event === "quote_accepted" && r.channel === "email",
    );
    const settled = settle({
      id: email!.id,
      outcome: "suppressed",
      error: "preference_off",
      retryAfterSeconds: 60,
    });
    // Even with a retry delay supplied, a suppression does not come back.
    expect(settled.state).toBe("suppressed");
    expect(claim(200).map((r) => r.id)).not.toContain(email!.id);
  });
});

/* ================================================================== *
 * 5 · §17 — preference respect and the opt-out
 * ================================================================== */

describe("§17 — preferences suppress at the source", () => {
  it("enqueues NO email for an opted-out customer, but keeps the feed row", () => {
    exec(
      `insert into user_preferences (profile_id, email_shipment_updates)
       values (${lit(SHIPPER_B_USER)}, false)
       on conflict (profile_id) do update set email_shipment_updates = false`,
    );
    const shipment = createShipment("PL-2026-790030", SHIPPER_B);
    statusEvent(shipment, "delivered");
    rewindWatermark();
    harvest();

    expect(queueFor(shipment, "email")).toBe(0);
    expect(queueFor(shipment, "in_app")).toBe(1);
  });

  it("enqueues NOTHING when both channels are off", () => {
    exec(
      `update user_preferences
          set email_shipment_updates = false, inapp_shipment_updates = false
        where profile_id = ${lit(SHIPPER_B_USER)}`,
    );
    const shipment = createShipment("PL-2026-790031", SHIPPER_B);
    statusEvent(shipment, "picked_up");
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(0);
  });

  it("resumes both channels when the customer opts back in (non-vacuity)", () => {
    exec(
      `update user_preferences
          set email_shipment_updates = true, inapp_shipment_updates = true
        where profile_id = ${lit(SHIPPER_B_USER)}`,
    );
    const shipment = createShipment("PL-2026-790032", SHIPPER_B);
    statusEvent(shipment, "in_transit");
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(2);
  });

  it("gives every notified customer an opt-out token that resolves", () => {
    const shipment = createShipment("PL-2026-790033");
    statusEvent(shipment, "arrived_at_delivery");
    rewindWatermark();
    harvest();
    // 0026's enqueue guarantees the preference row, so the link printed in
    // the email always resolves — the failure M-69/P-1 fixed for the
    // newsletter cannot recur here.
    const token = scalar(
      `select notification_token::text from user_preferences
        where profile_id = ${lit(SHIPPER_USER)}`,
    );
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("stores address suppressions lowercased and refuses anything else", () => {
    exec(
      `insert into notification_suppressions (email, scope, reason)
       values ('dock@acme.com', 'shipment', 'itest') on conflict do nothing`,
    );
    expect(
      sqlstateOf(
        `insert into notification_suppressions (email) values ('Dock@ACME.com')`,
      ),
    ).toBe("23514");
    expect(
      sqlstateOf(
        `insert into notification_suppressions (email) values ('not-an-address')`,
      ),
    ).toBe("23514");
  });
});

/* ================================================================== *
 * 6 · §17/§26 — the payload can never carry a forbidden field
 * ================================================================== */

describe("§17 — no sensitive data reaches the queue", () => {
  const FORBIDDEN = [
    "signed_url",
    "access_code",
    "internal_message",
    "gross_shipper_amount",
    "carrier_pay",
  ];

  it.each(FORBIDDEN)("refuses a payload carrying `%s`", (key) => {
    const shipment = createShipment(`PL-2026-7904${FORBIDDEN.indexOf(key)}0`);
    expect(
      sqlstateOf(
        `insert into shipment_notification_queue (shipment_id,
           notification_event, channel, recipient_profile_id, idempotency_key,
           payload)
         values (${lit(shipment)}, 'delivered', 'email', ${lit(SHIPPER_USER)},
           ${lit(`itest:${key}:${shipment}`)},
           ${lit(JSON.stringify({ [key]: "x" }))}::jsonb)`,
      ),
    ).toBe("23514");
  });

  it("ACCEPTS the allow-listed payload (non-vacuity)", () => {
    const shipment = createShipment("PL-2026-790450");
    expect(
      sqlstateOf(
        `insert into shipment_notification_queue (shipment_id,
           notification_event, channel, recipient_profile_id, idempotency_key,
           payload)
         values (${lit(shipment)}, 'delivered', 'email', ${lit(SHIPPER_USER)},
           ${lit(`itest:ok:${shipment}`)},
           '{"tracking_number":"PL-2026-790450","event_time":"2026-08-05T00:00:00Z"}'::jsonb)`,
      ),
    ).toBe("OK");
  });

  it("never harvests a payload key outside the allow-list", () => {
    const shipment = createShipment("PL-2026-790451");
    metadataEvent({
      shipmentId: shipment,
      eventType: "eta_update",
      metadata: {
        eta_kind: "delivery",
        new_at: "2026-08-11T12:00:00Z",
        // Fields M-78 legitimately writes into event metadata that must NOT
        // travel into a customer notification.
        reason_internal: "carrier is late again",
        eta_source: "manual",
        eta_confidence: "medium",
      },
    });
    rewindWatermark();
    harvest();
    const payload = json<Record<string, unknown>>(
      `select payload from shipment_notification_queue
        where shipment_id = ${lit(shipment)} and channel = 'email'`,
    );
    expect(Object.keys(payload).sort()).toEqual(
      ["event_time", "eta_at", "tracking_number"].sort(),
    );
    expect(JSON.stringify(payload)).not.toContain("carrier is late again");
  });
});

/* ================================================================== *
 * 7 · §17's eleventh — invoice available
 * ================================================================== */

describe("§17 — invoice available", () => {
  it("harvests a SHIPPER invoice and carries no amount", () => {
    const shipment = createShipment("PL-2026-790060");
    exec(
      `insert into invoices (carrier_id, shipper_id, shipment_id, amount_cents,
         status)
       values (null, ${lit(SHIPPER)}, ${lit(shipment)}, 482500, 'open')`,
    );
    rewindWatermark();
    harvest();

    expect(queueFor(shipment, "email")).toBe(1);
    const payload = json<Record<string, unknown>>(
      `select payload from shipment_notification_queue
        where shipment_id = ${lit(shipment)} and channel = 'email'`,
    );
    expect(payload.tracking_number).toBe("PL-2026-790060");
    // §18 marks shipper gross staff-only. It is not here, in any spelling.
    expect(JSON.stringify(payload)).not.toContain("482500");
    expect(JSON.stringify(payload)).not.toContain("4825");
  });

  it("ignores a CARRIER invoice — it is not the shipper's shipment news", () => {
    const shipment = createShipment("PL-2026-790061");
    exec(
      `insert into invoices (carrier_id, shipper_id, shipment_id, amount_cents,
         status)
       values (${lit(CARRIER)}, null, ${lit(shipment)}, 100000, 'open')`,
    );
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(0);
  });

  it("does not double-enqueue the same invoice on a second harvest", () => {
    const shipment = createShipment("PL-2026-790062");
    exec(
      `insert into invoices (carrier_id, shipper_id, shipment_id, amount_cents,
         status)
       values (null, ${lit(SHIPPER)}, ${lit(shipment)}, 250000, 'open')`,
    );
    rewindWatermark();
    harvest();
    rewindWatermark();
    harvest();
    expect(queueFor(shipment)).toBe(2);
  });
});

/* ================================================================== *
 * 8 · §19 — the queue is staff-only infrastructure
 * ================================================================== */

describe("§19 — RLS shape", () => {
  it("has RLS enabled on all five new tables", () => {
    for (const table of [
      "shipment_notification_rules",
      "shipment_notification_queue",
      "shipment_notification_attempts",
      "shipment_notification_watermark",
      "notification_suppressions",
    ]) {
      expect(
        count(
          `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = ${lit(table)}
              and c.relrowsecurity`,
        ),
        table,
      ).toBe(1);
    }
  });

  it("declares SELECT policies and NO write policy for any role", () => {
    // `permissive = 'PERMISSIVE'` since M-83. Migration 0030 adds a
    // RESTRICTIVE `for all` dispatcher-scope policy to the queue, and a
    // restrictive policy can only ever SUBTRACT — counting it here would turn
    // a "did anyone open a write surface?" detector into a "did anything
    // change?" detector, which is a different and much weaker question.
    const writes = count(
      `select count(*) from pg_policies
        where schemaname = 'public'
          and tablename in ('shipment_notification_rules',
            'shipment_notification_queue', 'shipment_notification_attempts',
            'shipment_notification_watermark', 'notification_suppressions')
          and permissive = 'PERMISSIVE'
          and cmd <> 'SELECT'`,
    );
    expect(writes).toBe(0);
    expect(
      count(
        `select count(*) from pg_policies
          where schemaname = 'public'
            and tablename in ('shipment_notification_rules',
              'shipment_notification_queue', 'shipment_notification_attempts',
              'shipment_notification_watermark', 'notification_suppressions')
            and permissive = 'PERMISSIVE'`,
      ),
    ).toBe(5);
    // …and the restrictive one is present and is exactly one.
    expect(
      count(
        `select count(*) from pg_policies
          where schemaname = 'public'
            and tablename = 'shipment_notification_queue'
            and permissive = 'RESTRICTIVE'`,
      ),
    ).toBe(1);
  });

  it("grants the four write functions to service_role ALONE", () => {
    for (const fn of [
      "harvest_shipment_notifications",
      "enqueue_shipment_notification",
      "claim_shipment_notifications",
      "settle_shipment_notification",
    ]) {
      const grantees = JSON.parse(
        scalar(
          `select coalesce(jsonb_agg(distinct grantee), '[]'::jsonb)
             from information_schema.role_routine_grants
            where routine_schema = 'public' and routine_name = ${lit(fn)}`,
        ) ?? "[]",
      ) as string[];
      expect(grantees.sort(), fn).toEqual(["postgres", "service_role"].sort());
    }
  });
});
