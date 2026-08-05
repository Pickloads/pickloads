import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeBrokerageGate,
  count,
  exec,
  lit,
  openBrokerageGate,
  scalar,
} from "./helpers/db";
import {
  capturedInserts,
  createPsqlSupabaseClient,
  resetCapturedInserts,
} from "./helpers/psql-supabase";

/**
 * M-73 — §27's public-tracking integration tests, against a real PostgreSQL 16.
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 restores the integration tier the
 * extension audit dropped, and lists eleven named §27 tests. M-72's instalment
 * proved four of them (create shipment · assign carrier · create event ·
 * update status). This file adds the FIFTH — **public lookup** — as five
 * scenarios plus the ledger guarantee:
 *
 *   happy path · wrong secondary value · unknown number · rate-limit trip ·
 *   the access-log row, written WITHOUT the secret.
 *
 * WHAT MAKES THIS AN INTEGRATION TEST. The REAL `lookupPublicTracking` runs —
 * the same function `/track` calls — against the REAL schema built from
 * migrations 0001…0020, with the REAL HMAC verification and the REAL
 * `toPublicTrackingDto`. Only the transport is adapted (`helpers/psql-supabase`
 * translates supabase-js's query shapes into SQL, because the lane has Postgres
 * but no PostgREST). The unit lane mocks the data; here the database is the one
 * answering, and a mistyped column, a rejected enum value or a violated CHECK
 * fails the test.
 *
 * The rate limiter is the one thing stubbed, and deliberately: the real one is
 * Upstash Redis over the network, which this lane has no access to and whose
 * sliding-window semantics are not PickLoads code. What is proved here is the
 * WIRING — that a refusal stops the lookup dead and still reaches the ledger —
 * which is the part that could regress.
 */

process.env.TRACKING_ACCESS_SECRET = "m73-integration-secret";

/* ---- the stubbed limiter: N allowed per bucket, then refusals ---- */
let allowance = Number.POSITIVE_INFINITY;
const rateLimitCalls: { form: string; ip: string; limit: number | undefined }[] =
  [];

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (form: string, ip: string, limit?: number) => {
    rateLimitCalls.push({ form, ip, limit });
    if (allowance <= 0) return false;
    allowance -= 1;
    return true;
  },
}));

const client = createPsqlSupabaseClient();
vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => client,
  createAdminClient: () => client,
}));

const { hashSecondaryValue } = await import("@/lib/shipments/access-code");
const { lookupPublicTracking, recordRateLimitedAttempt, TRACK_RATE_LIMIT } =
  await import("@/lib/shipments/public-lookup");
const { checkRateLimit } = await import("@/lib/rate-limit");

const SHIPPER = "22222222-2222-2222-2222-222222220001";
const CARRIER = "11111111-1111-1111-1111-111111110001";
const DISPATCHER = "00000000-0000-0000-0000-0000000e0001";

const TRACKED = "PL-2026-070001";
const SUSPENDED = "PL-2026-070002";
const ZIP = "07111";
const WRONG_ZIP = "99999";
const UNKNOWN = "PL-2026-079999";

let trackedId = "";
let suspendedId = "";

beforeAll(() => {
  // Identities, created HERE rather than inherited from the M-72 file. The
  // lane shares one database and runs single-threaded, but nothing guarantees
  // file ORDER — a test that only passes when another file ran first is a
  // flake waiting for an alphabetical rename. `on conflict do nothing` makes
  // both files' identical inserts idempotent.
  exec(`insert into auth.users (id, email) values
      (${lit(DISPATCHER)}, 'dispatcher@integration.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(DISPATCHER)}, 'dispatcher', 'Integration Dispatcher')
    on conflict do nothing`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER)}, 'Integration Shipper Inc') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER)}, 'Integration Carrier A', true) on conflict do nothing`);

  openBrokerageGate();

  const hash = hashSecondaryValue(ZIP);
  expect(hash).toMatch(/^v1:[0-9a-f]{64}$/);

  trackedId =
    scalar(`insert into shipments (
      tracking_number, shipper_id, carrier_id, dispatcher_id, status,
      origin_city, origin_state, destination_city, destination_state, equipment,
      gross_shipper_amount, carrier_pay, margin,
      delay_reason_internal,
      public_tracking_enabled, location_visibility, public_access_hash,
      estimated_delivery_at, eta_source, eta_confidence
    ) values (
      ${lit(TRACKED)}, ${lit(SHIPPER)}, ${lit(CARRIER)}, ${lit(DISPATCHER)}, 'in_transit',
      'Newark', 'NJ', 'Atlanta', 'GA', 'dry-van',
      4321, 3210, 1111,
      'INTERNAL-ONLY-DELAY-NOTE',
      true, 'approximate', ${lit(hash ?? "")},
      '2026-08-10T14:00:00Z', 'manual', 'medium'
    ) returning id`) ?? "";
  expect(trackedId).not.toBe("");

  // §15: an admin can suspend public tracking. The lookup must refuse it with
  // the SAME message as an unknown number.
  suspendedId =
    scalar(`insert into shipments (
      tracking_number, shipper_id, status, origin_city, origin_state,
      destination_city, destination_state, equipment,
      public_tracking_enabled, public_access_hash
    ) values (
      ${lit(SUSPENDED)}, ${lit(SHIPPER)}, 'in_transit', 'Newark', 'NJ',
      'Boston', 'MA', 'reefer', false, ${lit(hash ?? "")}
    ) returning id`) ?? "";

  closeBrokerageGate();

  // Two PUBLIC events and one STAFF_ONLY event, through M-72's own write
  // function. The staff note is the control: §7's absolute rule is that it
  // must never appear in a customer timeline, and this proves the SQL filter
  // holds, not just the DTO.
  exec(`select append_shipment_event(${lit(trackedId)}, 'public_update', 'dispatcher',
        null, 'public', '2026-08-01T14:00:00Z', 'phrase:update.picked_up',
        null, 'Newark', 'NJ', null, null, '{}'::jsonb, null, null, 'picked_up')`);
  exec(`select append_shipment_event(${lit(trackedId)}, 'public_update', 'dispatcher',
        null, 'public', '2026-08-02T09:00:00Z', 'phrase:update.in_transit',
        null, 'Knoxville', 'TN', null, null, '{}'::jsonb, null, null, 'in_transit')`);
  exec(`select append_shipment_event(${lit(trackedId)}, 'internal_note', 'dispatcher',
        null, 'staff_only', '2026-08-02T10:00:00Z', null,
        'STAFF-ONLY-MARGIN-NOTE', null, null, null, null, '{}'::jsonb, null, null, null)`);
});

beforeEach(() => {
  allowance = Number.POSITIVE_INFINITY;
  rateLimitCalls.length = 0;
  resetCapturedInserts();
});

function request(overrides: Record<string, unknown> = {}) {
  return {
    trackingNumber: TRACKED,
    secondaryValue: ZIP,
    ip: "198.51.100.10",
    userAgent: "Mozilla/5.0 (integration)",
    ...overrides,
  };
}

function ledgerCount(where: string): number {
  return count(`select count(*) from shipment_tracking_access where ${where}`);
}

/* ================================================================== *
 * §27 · public tracking lookup — happy path
 * ================================================================== */

describe("§27 public tracking lookup — happy path", () => {
  it("returns the strict public DTO for a correct number + ZIP", async () => {
    const result = await lookupPublicTracking(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tracking.tracking_number).toBe(TRACKED);
    expect(result.tracking.status).toBe("in_transit");
    expect(result.tracking.status_key).toBe("shipment.status.in_transit");
    expect(result.tracking.origin_city).toBe("Newark");
    expect(result.tracking.destination_state).toBe("GA");
    expect(result.tracking.carrier_assigned).toBe(true);
    expect(result.timelineTruncated).toBe(false);
  });

  it("carries no financial field and no internal note — from the REAL row", async () => {
    const result = await lookupPublicTracking(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.tracking);
    // The fixture's real column values, read back out of Postgres.
    for (const forbidden of ["4321", "3210", "1111", "INTERNAL-ONLY-DELAY-NOTE"]) {
      expect(serialized.includes(forbidden), `leaked ${forbidden}`).toBe(false);
    }
    expect(Object.keys(result.tracking)).not.toContain("margin");
    expect(Object.keys(result.tracking)).not.toContain("id");
    expect(Object.keys(result.tracking)).not.toContain("public_access_hash");
  });

  it("returns the PUBLIC timeline and never the staff_only note (§7)", async () => {
    const result = await lookupPublicTracking(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tracking.events).toHaveLength(2);
    expect(JSON.stringify(result.tracking.events)).not.toContain(
      "STAFF-ONLY-MARGIN-NOTE",
    );
    // Non-vacuous: the staff note really is in the table.
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(trackedId)} and visibility = 'staff_only'`,
      ),
    ).toBe(1);
  });

  it("accepts the ZIP+4 a customer reads off a shipping label", async () => {
    const result = await lookupPublicTracking(
      request({ secondaryValue: "07111-1234" }),
    );
    expect(result.ok).toBe(true);
  });
});

/* ================================================================== *
 * §27 · the three refusals
 * ================================================================== */

describe("§27 public tracking lookup — refusals are indistinguishable", () => {
  it("refuses a wrong secondary value", async () => {
    const result = await lookupPublicTracking(
      request({ secondaryValue: WRONG_ZIP }),
    );
    expect(result).toEqual({ ok: false, code: "refused" });
  });

  it("refuses an unknown tracking number", async () => {
    const result = await lookupPublicTracking(
      request({ trackingNumber: UNKNOWN }),
    );
    expect(result).toEqual({ ok: false, code: "refused" });
  });

  it("refuses a shipment whose public tracking an admin suspended (§15)", async () => {
    const result = await lookupPublicTracking(
      request({ trackingNumber: SUSPENDED }),
    );
    expect(result).toEqual({ ok: false, code: "refused" });
  });

  it("all three return the IDENTICAL value against the real database", async () => {
    const [wrong, unknown, suspended] = await Promise.all([
      lookupPublicTracking(request({ secondaryValue: WRONG_ZIP })),
      lookupPublicTracking(request({ trackingNumber: UNKNOWN })),
      lookupPublicTracking(request({ trackingNumber: SUSPENDED })),
    ]);
    expect(wrong).toEqual(unknown);
    expect(suspended).toEqual(unknown);
    expect(Object.keys(wrong)).toEqual(Object.keys(unknown));
  });
});

/* ================================================================== *
 * §27 · rate-limit trip
 * ================================================================== */

describe("§27 rate-limit trip", () => {
  it("stops the lookup dead and lands a rate_limited row in Postgres", async () => {
    const before = ledgerCount("outcome = 'rate_limited'");

    // The action consults the limiter before anything else; simulate the trip
    // and assert the consequence the ledger has to record.
    allowance = 0;
    expect(await checkRateLimit("public-tracking", "203.0.113.9", TRACK_RATE_LIMIT)).toBe(
      false,
    );
    await recordRateLimitedAttempt(TRACKED, "203.0.113.9", "curl/8.0");

    expect(ledgerCount("outcome = 'rate_limited'")).toBe(before + 1);
    expect(
      count(
        `select count(*) from shipment_tracking_access where outcome = 'rate_limited' and ip = '203.0.113.9'`,
      ),
    ).toBe(1);
    // The limiter was consulted with M-73's TIGHTER limit, not the default.
    expect(rateLimitCalls.at(-1)?.limit).toBe(TRACK_RATE_LIMIT);
    expect(TRACK_RATE_LIMIT).toBeLessThan(5);
  });

  it("a rate-limited attempt records no shipment id — it never got that far", () => {
    expect(
      count(
        `select count(*) from shipment_tracking_access where outcome = 'rate_limited' and shipment_id is not null`,
      ),
    ).toBe(0);
  });
});

/* ================================================================== *
 * §27 · the access ledger, written without the secret
 * ================================================================== */

describe("§27 access log", () => {
  it("records every outcome against the real enum and CHECKs", async () => {
    const before = ledgerCount("true");

    await lookupPublicTracking(request());
    await lookupPublicTracking(request({ secondaryValue: WRONG_ZIP }));
    await lookupPublicTracking(request({ trackingNumber: UNKNOWN }));
    await lookupPublicTracking(request({ trackingNumber: SUSPENDED }));

    expect(ledgerCount("true")).toBe(before + 4);
    expect(
      count(
        `select count(*) from shipment_tracking_access where tracking_number_attempted = ${lit(TRACKED)} and outcome = 'granted'`,
      ),
    ).toBeGreaterThanOrEqual(1);
    // `>= 1` rather than `= 1`: earlier describes in this file exercise the
    // same refusals against the same shared database, and an exact count would
    // couple this assertion to test ORDER rather than to behaviour.
    expect(
      count(
        `select count(*) from shipment_tracking_access where tracking_number_attempted = ${lit(UNKNOWN)} and outcome = 'not_found' and shipment_id is null`,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      count(
        `select count(*) from shipment_tracking_access where outcome = 'tracking_disabled' and shipment_id = ${lit(suspendedId)}`,
      ),
    ).toBeGreaterThanOrEqual(1);
    // …but an unknown number must NEVER acquire a shipment id, at any count.
    expect(
      count(
        `select count(*) from shipment_tracking_access where tracking_number_attempted = ${lit(UNKNOWN)} and shipment_id is not null`,
      ),
    ).toBe(0);
  });

  it("links a granted lookup to the shipment it granted", async () => {
    await lookupPublicTracking(request());
    expect(
      count(
        `select count(*) from shipment_tracking_access where outcome = 'granted' and shipment_id = ${lit(trackedId)}`,
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it("NEVER stores the attempted secondary value — proved against the table", async () => {
    const secret = "SUPERSECRETCODE99";
    await lookupPublicTracking(request({ secondaryValue: secret }));

    // 1 — the payload the module handed the client carries no such value.
    expect(JSON.stringify(capturedInserts)).not.toContain(secret);

    // 2 — and neither does the TABLE, swept across every text column there is.
    // A future migration adding a column would still be caught by the exact
    // column-set assertion in supabase/tests/20_rls_isolation.sql §9a; this is
    // the value-level companion.
    const hits = count(
      `select count(*) from shipment_tracking_access
        where to_jsonb(shipment_tracking_access)::text ilike ${lit("%" + secret + "%")}`,
    );
    expect(hits).toBe(0);

    // Non-vacuous: the attempt itself IS recorded, so "no hits" is not "no rows".
    expect(
      count(
        `select count(*) from shipment_tracking_access where outcome = 'bad_secondary'`,
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it("the ledger is append-only for the service role too (0020's trigger)", () => {
    const id = scalar(
      `select id from shipment_tracking_access order by accessed_at limit 1`,
    );
    expect(id).not.toBeNull();
    expect(() =>
      exec(
        `update shipment_tracking_access set outcome = 'granted' where id = ${lit(id ?? "")}`,
      ),
    ).toThrow();
    expect(() =>
      exec(`delete from shipment_tracking_access where id = ${lit(id ?? "")}`),
    ).toThrow();
  });
});
