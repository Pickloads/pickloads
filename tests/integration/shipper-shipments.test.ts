import { beforeAll, describe, expect, it } from "vitest";

import {
  closeBrokerageGate,
  count,
  exec,
  lit,
  openBrokerageGate,
  scalar,
} from "./helpers/db";
import {
  createRlsSupabaseClient,
  issuedSql,
  resetIssuedSql,
} from "./helpers/psql-rls-supabase";
import {
  EMPTY_FILTERS,
  getShipperShipments,
  MAX_PAGE_SIZE,
  parseShipmentFilters,
  shipperHasAnyShipment,
} from "@/lib/shipments/shipper-list";
import {
  getShipmentContacts,
  getShipmentInvoices,
  getShipmentSummary,
  getShipmentTimelinePage,
  TIMELINE_PAGE_SIZE,
} from "@/lib/shipments/shipper-detail";
import { getShipperTileCounts } from "@/lib/shipments/shipper-tiles";
import { toShipperDto } from "@/lib/shipments/dto";

/**
 * M-74 — §27's **portal lookup** integration test, and the tenant-isolation
 * proof the task asks for *"through the real client, not just RLS SQL"*.
 *
 * ── WHAT THIS LANE ANSWERS THAT THE OTHER TWO CANNOT ──────────────────────
 *
 * `tests/unit/shipment-shipper-*.test.ts` mocks the client: it proves the
 * queries are BOUNDED and SCOPED, and can prove nothing about SQL validity or
 * policy behaviour. `supabase/tests/20_rls_isolation.sql` is pure SQL: it
 * proves a SESSION cannot cross a tenant boundary, and imports no TypeScript
 * at all, so it cannot know whether the portal's own query builder produces
 * SQL the schema accepts.
 *
 * This lane runs the REAL exported functions from `src/lib/shipments/` against
 * the REAL schema (0001 … 0021) as a REAL `authenticated` session with
 * `request.jwt.claim.sub` set — which is what `auth.uid()` reads and therefore
 * what makes `my_shipper_ids()` and every 0018/0019/0021 policy fire. If the
 * projection names a column that does not exist, if `applyShipmentFilters`
 * emits an `or()` the translator cannot express, or if the policy does not
 * scope the way the unit lane assumes, it fails HERE.
 *
 * §27 rows advanced by this file: **portal lookup** (the sixth of the eleven).
 * M-83b still owns carrier update, document upload, POD upload, notification
 * generation and exception lifecycle.
 *
 * ── NON-VACUITY IS BY INJECTION, NOT BY ASSERTION ─────────────────────────
 *
 * The isolation test's final block DISABLES the application-level
 * `.eq("shipper_id", …)` predicate — issuing the same query without it — and
 * asserts the database STILL returns nothing to the wrong shipper. That
 * separates the two mechanisms: it shows the RLS policy alone is doing the
 * work, and it shows the assertion is capable of failing (the same query as
 * the OWNING shipper returns the row).
 */

const SHIPPER_A = "22222222-2222-2222-2222-2222222a0074";
const SHIPPER_B = "22222222-2222-2222-2222-2222222b0074";
const OWNER_A = "00000000-0000-0000-0000-00000000a074";
const OWNER_B = "00000000-0000-0000-0000-00000000b074";
const CARRIER_A = "11111111-1111-1111-1111-1111111a0074";
const DISPATCHER = "00000000-0000-0000-0000-00000000d074";

const SHIPMENT_A1 = "ffffffff-ffff-ffff-ffff-fffffff1a074";
const SHIPMENT_A2 = "ffffffff-ffff-ffff-ffff-fffffff2a074";
const SHIPMENT_A3 = "ffffffff-ffff-ffff-ffff-fffffff3a074";
const SHIPMENT_B1 = "ffffffff-ffff-ffff-ffff-fffffff1b074";

const INVOICE_A = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a0074";
const INVOICE_B = "7a7a7a7a-7a7a-7a7a-7a7a-7b7b7b7b0074";

/** The session client the portal pages hold. */
const clientA = createRlsSupabaseClient({
  role: "authenticated",
  sub: OWNER_A,
});
const clientB = createRlsSupabaseClient({
  role: "authenticated",
  sub: OWNER_B,
});
const anonClient = createRlsSupabaseClient({ role: "anon", sub: null });

beforeAll(() => {
  exec(`insert into auth.users (id, email) values
      (${lit(OWNER_A)}, 'ownerA@shipper-a-74.test'),
      (${lit(OWNER_B)}, 'ownerB@shipper-b-74.test'),
      (${lit(DISPATCHER)}, 'dispatcher74@integration.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(OWNER_A)}, 'shipper', 'Owner A'),
      (${lit(OWNER_B)}, 'shipper', 'Owner B'),
      (${lit(DISPATCHER)}, 'dispatcher', 'Dispatcher 74')
    on conflict (id) do update set role = excluded.role`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER_A)}, 'Shipper A 74 Inc'),
      (${lit(SHIPPER_B)}, 'Shipper B 74 Inc') on conflict do nothing`);
  exec(`insert into shipper_memberships (shipper_id, profile_id, role) values
      (${lit(SHIPPER_A)}, ${lit(OWNER_A)}, 'owner'),
      (${lit(SHIPPER_B)}, ${lit(OWNER_B)}, 'owner') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER_A)}, 'Carrier A 74', true) on conflict do nothing`);

  // The §2 gate refuses every shipment INSERT while brokerage is off — even
  // for the table owner — so seeding has to open it deliberately and close it
  // again, exactly as `supabase/tests/10_fixtures.sql` does.
  openBrokerageGate();
  exec(`insert into shipments (id, tracking_number, shipper_id, carrier_id, dispatcher_id,
      status, origin_city, origin_state, destination_city, destination_state,
      equipment, po_number, shipper_reference, pickup_appointment_at,
      delivery_appointment_at, estimated_delivery_at, delay_minutes,
      gross_shipper_amount, carrier_pay, margin, delay_reason_internal,
      public_access_hash)
    values
      (${lit(SHIPMENT_A1)}, 'PL-2026-740001', ${lit(SHIPPER_A)}, ${lit(CARRIER_A)},
        ${lit(DISPATCHER)}, 'in_transit', 'Newark', 'NJ', 'Atlanta', 'GA',
        'dry-van', 'PO-A-1', 'REF-A-1', '2026-08-05T13:00:00Z',
        '2026-08-08T13:00:00Z', '2026-08-08T14:00:00Z', null,
        999111, 999222, 999333, 'INTERNAL-DELAY-999444', 'SENTINEL-HASH-999555'),
      (${lit(SHIPMENT_A2)}, 'PL-2026-740002', ${lit(SHIPPER_A)}, null,
        ${lit(DISPATCHER)}, 'delayed', 'Chicago', 'IL', 'Dallas', 'TX',
        'reefer', 'PO-A-2', null, '2026-08-06T13:00:00Z',
        '2026-08-09T13:00:00Z', null, 120, 1000, 800, 200, null, null),
      (${lit(SHIPMENT_A3)}, 'PL-2026-740003', ${lit(SHIPPER_A)}, ${lit(CARRIER_A)},
        ${lit(DISPATCHER)}, 'delivered', 'Newark', 'NJ', 'Miami', 'FL',
        'flatbed', null, 'REF-A-3', '2026-07-01T13:00:00Z',
        '2026-07-04T13:00:00Z', null, null, 1000, 800, 200, null, null),
      (${lit(SHIPMENT_B1)}, 'PL-2026-740099', ${lit(SHIPPER_B)}, null,
        ${lit(DISPATCHER)}, 'in_transit', 'Boston', 'MA', 'Denver', 'CO',
        'dry-van', 'PO-B-1', 'REF-B-1', '2026-08-05T13:00:00Z',
        '2026-08-10T13:00:00Z', null, null, 2000, 1500, 500, null, null)
    on conflict do nothing`);
  closeBrokerageGate();

  // §7's five bands on shipment A1, so every audience assertion is a
  // statement about the band list rather than about an empty table.
  exec(`insert into shipment_events (shipment_id, event_type, status, event_time,
      source, city, state, public_message, internal_message, visibility)
    values
      (${lit(SHIPMENT_A1)}, 'status_change', 'picked_up', '2026-08-05T14:00:00Z',
        'dispatcher', 'Newark', 'NJ', 'phrase:update.picked_up', null, 'public'),
      (${lit(SHIPMENT_A1)}, 'appointment_rescheduled', null, '2026-08-06T09:00:00Z',
        'dispatcher', null, null, 'Delivery moved to Thursday 09:00', null, 'shipper'),
      (${lit(SHIPMENT_A1)}, 'email_logged', null, '2026-08-06T10:00:00Z',
        'dispatcher', null, null, null, 'CARRIER-BAND-999666', 'carrier'),
      (${lit(SHIPMENT_A1)}, 'document_approved', null, '2026-08-06T11:00:00Z',
        'admin', null, null, 'BOL released', null, 'broker'),
      (${lit(SHIPMENT_A1)}, 'internal_note', null, '2026-08-06T12:00:00Z',
        'dispatcher', null, null, null, 'STAFF-ONLY-999777', 'staff_only'),
      (${lit(SHIPMENT_B1)}, 'status_change', 'in_transit', '2026-08-05T15:00:00Z',
        'dispatcher', 'Boston', 'MA', 'Rolling', null, 'public')
    on conflict do nothing`);

  exec(`insert into shipment_parties (shipment_id, party_role, company_name,
      contact_name, phone, email, public_contact)
    values
      (${lit(SHIPMENT_A1)}, 'consignee', 'Atlanta DC', 'Receiving Desk',
        '4045550100', 'dock@atlanta-dc.test', true),
      (${lit(SHIPMENT_A1)}, 'carrier', 'Carrier A 74', 'Night Dispatch',
        '9735559999', 'night@carrier-a.test', false)
    on conflict do nothing`);

  // §11 invoice status. `carrier_id` is NULL by design — see 0021's header:
  // naming the hauling carrier would expose the shipper gross to them.
  exec(`insert into invoices (id, carrier_id, shipment_id, shipper_id,
      amount_cents, status, issued_at, due_at)
    values
      (${lit(INVOICE_A)}, null, ${lit(SHIPMENT_A1)}, ${lit(SHIPPER_A)},
        240000, 'open', '2026-08-06T00:00:00Z', '2026-09-05T00:00:00Z'),
      (${lit(INVOICE_B)}, null, ${lit(SHIPMENT_B1)}, ${lit(SHIPPER_B)},
        310000, 'open', '2026-08-06T00:00:00Z', '2026-09-05T00:00:00Z')
    on conflict do nothing`);
});

/* ------------------------------------------------------------------ *
 * §27 · portal lookup — the happy path, end to end
 * ------------------------------------------------------------------ */

describe("§27 portal lookup — the shipper reads their own shipments", () => {
  it("the real list query runs against the real schema and returns the tenant's rows", async () => {
    const result = await getShipperShipments(
      clientA as never,
      SHIPPER_A,
      EMPTY_FILTERS,
      1,
    );
    expect(result.failed).toBe(false);
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.tracking_number).sort()).toEqual([
      "PL-2026-740001",
      "PL-2026-740002",
      "PL-2026-740003",
    ]);
  });

  it("the projection genuinely omits §18's financial columns FROM THE PAYLOAD", async () => {
    const result = await getShipperShipments(
      clientA as never,
      SHIPPER_A,
      EMPTY_FILTERS,
      1,
    );
    // The row in the database DOES carry all five sentinels — asserted here so
    // "not found in the payload" is a statement about the projection and not
    // about an empty column.
    expect(
      count(
        `select count(*) from shipments where id = ${lit(SHIPMENT_A1)}
           and gross_shipper_amount = 999111 and margin = 999333
           and delay_reason_internal = 'INTERNAL-DELAY-999444'`,
      ),
    ).toBe(1);
    const serialized = JSON.stringify(result.rows);
    for (const sentinel of [
      "999111",
      "999222",
      "999333",
      "INTERNAL-DELAY-999444",
      "SENTINEL-HASH-999555",
    ]) {
      expect(serialized, `leaked ${sentinel}`).not.toContain(sentinel);
    }
  });

  it("the summary read returns the shipment and issues no event query", async () => {
    resetIssuedSql();
    const summary = await getShipmentSummary(
      clientA as never,
      SHIPPER_A,
      SHIPMENT_A1,
    );
    expect(summary?.tracking_number).toBe("PL-2026-740001");
    expect(issuedSql.join(" ")).toContain('from public."shipments"');
    expect(issuedSql.join(" ")).not.toContain("shipment_events");
  });

  it("the timeline returns the shipper's TWO bands and never the other three (§7)", async () => {
    const page = await getShipmentTimelinePage(clientA as never, SHIPMENT_A1);
    expect(page.failed).toBe(false);
    expect(page.events).toHaveLength(2);
    expect(page.events.map((e) => e.visibility).sort()).toEqual([
      "public",
      "shipper",
    ]);
    const serialized = JSON.stringify(page.events);
    // The staff-only and carrier-band notes are IN the table…
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(SHIPMENT_A1)}
           and internal_message in ('STAFF-ONLY-999777','CARRIER-BAND-999666')`,
      ),
    ).toBe(2);
    // …and in NO form in what the shipper receives. §7's hard rule.
    expect(serialized).not.toContain("STAFF-ONLY-999777");
    expect(serialized).not.toContain("CARRIER-BAND-999666");
  });

  it("the whole detail composes into a ShipperShipmentDto with no forbidden value", async () => {
    const [summary, history] = await Promise.all([
      getShipmentSummary(clientA as never, SHIPPER_A, SHIPMENT_A1),
      getShipmentTimelinePage(clientA as never, SHIPMENT_A1),
    ]);
    expect(summary).not.toBeNull();
    const dto = toShipperDto({
      shipment: {
        ...summary!,
        gross_shipper_amount: null,
        carrier_pay: null,
        margin: null,
        delay_reason_internal: null,
        public_access_hash: null,
      },
      events: history.events.map((e) => ({
        ...e,
        created_by: null,
        latitude: null,
        longitude: null,
        internal_message: null,
        metadata: null,
        external_event_id: null,
        idempotency_key: null,
      })),
    });
    expect(dto.tracking_number).toBe("PL-2026-740001");
    expect(dto.events).toHaveLength(2);
    expect(Object.keys(dto)).not.toContain("gross_shipper_amount");
    expect(Object.keys(dto)).not.toContain("margin");
  });

  it("§11 invoice status comes back from `invoices` under 0021's policy", async () => {
    const result = await getShipmentInvoices(clientA as never, SHIPMENT_A1);
    expect(result.failed).toBe(false);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]!.status).toBe("open");
    expect(result.invoices[0]!.amount_cents).toBe(240000);
  });

  it("§11 contacts apply M-71's visibility rule against real rows", async () => {
    const result = await getShipmentContacts(clientA as never, SHIPMENT_A1);
    expect(result.failed).toBe(false);
    const byRole = Object.fromEntries(
      result.contacts.map((c) => [c.party_role, c]),
    );
    expect(byRole.consignee!.phone).toBe("4045550100");
    const carrier = byRole.carrier!;
    expect(carrier.company_name).toBe("Carrier A 74");
    expect(carrier.phone).toBeNull();
    expect(carrier.channels_withheld).toBe(true);
    // The number IS in the database — so the null above is the rule firing.
    expect(
      count(
        `select count(*) from shipment_parties where shipment_id = ${lit(SHIPMENT_A1)}
           and phone = '9735559999'`,
      ),
    ).toBe(1);
  });

  it("§11 tiles count the tenant's own shipments, with no row loaded", async () => {
    const counts = await getShipperTileCounts(
      clientA as never,
      SHIPPER_A,
      new Date("2026-08-05T18:00:00.000Z"),
    );
    expect(counts.in_transit).toBe(1);
    expect(counts.delayed).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.booked).toBe(0);
    expect(counts.pickups_today).toBe(1); // A1's 2026-08-05 13:00Z = 09:00 ET
    expect(counts.outstanding_invoices).toBe(1);
    // M-77's table does not exist; the tile must be "not measured", not 0.
    expect(counts.documents_awaiting_review).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * §11 filters and §25 pagination, against real SQL
 * ------------------------------------------------------------------ */

describe("§11 filters narrow the real result set", () => {
  async function listWith(params: Record<string, string>) {
    return getShipperShipments(
      clientA as never,
      SHIPPER_A,
      parseShipmentFilters(params),
      1,
    );
  }

  it("tracking number", async () => {
    const result = await listWith({ tracking: "740002" });
    expect(result.total).toBe(1);
    expect(result.rows[0]!.tracking_number).toBe("PL-2026-740002");
  });

  it("PO / reference searches BOTH columns", async () => {
    expect((await listWith({ reference: "PO-A-1" })).total).toBe(1);
    expect((await listWith({ reference: "REF-A-3" })).total).toBe(1);
    expect((await listWith({ reference: "PO-B-1" })).total).toBe(0);
  });

  it("pickup date window", async () => {
    const inside = await listWith({ from: "2026-08-05", to: "2026-08-06" });
    expect(inside.total).toBe(2);
    const outside = await listWith({ from: "2026-07-01", to: "2026-07-02" });
    expect(outside.total).toBe(1);
  });

  it("origin and destination", async () => {
    expect((await listWith({ origin: "Newark" })).total).toBe(2);
    expect((await listWith({ destination: "Dallas" })).total).toBe(1);
    expect((await listWith({ origin: "NJ" })).total).toBe(2);
  });

  it("status, equipment", async () => {
    expect((await listWith({ status: "in_transit" })).total).toBe(1);
    expect((await listWith({ equipment: "reefer" })).total).toBe(1);
  });

  it("`delayed` catches BOTH the status and recorded minutes", async () => {
    const result = await listWith({ delayed: "1" });
    expect(result.total).toBe(1);
    expect(result.rows[0]!.tracking_number).toBe("PL-2026-740002");
  });

  it("`delivered`", async () => {
    const result = await listWith({ delivered: "1" });
    expect(result.total).toBe(1);
    expect(result.rows[0]!.tracking_number).toBe("PL-2026-740003");
  });

  it("filters COMPOSE — every one of the nine at once returns a real answer", async () => {
    const result = await listWith({
      tracking: "PL-2026",
      reference: "PO-A-1",
      from: "2026-08-01",
      to: "2026-08-31",
      origin: "Newark",
      destination: "Atlanta",
      status: "in_transit",
      equipment: "dry-van",
    });
    expect(result.failed).toBe(false);
    expect(result.total).toBe(1);
  });

  it("a hostile filter value is a VALUE, not a new operand", async () => {
    const result = await listWith({ reference: "x,status.eq.delivered" });
    expect(result.failed).toBe(false);
    // If the comma had reshaped the `or()`, this would have matched A3.
    expect(result.total).toBe(0);
  });

  it("§25: page 2 of a 2-row page returns the tail and never overlaps", async () => {
    const page1 = await getShipperShipments(
      clientA as never,
      SHIPPER_A,
      EMPTY_FILTERS,
      1,
      2,
    );
    const page2 = await getShipperShipments(
      clientA as never,
      SHIPPER_A,
      EMPTY_FILTERS,
      2,
      2,
    );
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(1);
    expect(page1.pageCount).toBe(2);
    const ids = new Set([
      ...page1.rows.map((r) => r.id),
      ...page2.rows.map((r) => r.id),
    ]);
    expect(ids.size).toBe(3);
  });

  it("§25: an absurd page size cannot widen the read past the ceiling", async () => {
    resetIssuedSql();
    await getShipperShipments(
      clientA as never,
      SHIPPER_A,
      EMPTY_FILTERS,
      1,
      100_000,
    );
    const sql = issuedSql.find((s) => s.includes("limit"))!;
    const limit = Number(/limit (\d+)/.exec(sql)?.[1]);
    expect(limit).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it("§25: the history read is bounded to one page plus a lookahead", async () => {
    resetIssuedSql();
    await getShipmentTimelinePage(clientA as never, SHIPMENT_A1);
    const sql = issuedSql.find((s) => s.includes("shipment_events"))!;
    expect(sql).toContain(`limit ${TIMELINE_PAGE_SIZE + 1}`);
  });
});

/* ------------------------------------------------------------------ *
 * §3 / §19 — tenant isolation, through the real client
 * ------------------------------------------------------------------ */

describe("§3 isolation — shipper A cannot read shipper B", () => {
  it("shipper B's list contains only shipper B's shipment", async () => {
    const result = await getShipperShipments(
      clientB as never,
      SHIPPER_B,
      EMPTY_FILTERS,
      1,
    );
    expect(result.total).toBe(1);
    expect(result.rows[0]!.tracking_number).toBe("PL-2026-740099");
  });

  it("asking for shipper B's rows AS shipper A returns nothing", async () => {
    // The exact URL-manipulation shape: A's session, B's organization id.
    const result = await getShipperShipments(
      clientA as never,
      SHIPPER_B,
      EMPTY_FILTERS,
      1,
    );
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it("the detail read of B's shipment AS shipper A returns null → the page 404s", async () => {
    expect(
      await getShipmentSummary(clientA as never, SHIPPER_A, SHIPMENT_B1),
    ).toBeNull();
    // …and cannot be reached by supplying B's organization id either.
    expect(
      await getShipmentSummary(clientA as never, SHIPPER_B, SHIPMENT_B1),
    ).toBeNull();
  });

  it("B's timeline, invoices and contacts are all empty to A", async () => {
    const [timeline, invoices, contacts] = await Promise.all([
      getShipmentTimelinePage(clientA as never, SHIPMENT_B1),
      getShipmentInvoices(clientA as never, SHIPMENT_B1),
      getShipmentContacts(clientA as never, SHIPMENT_B1),
    ]);
    expect(timeline.events).toEqual([]);
    expect(invoices.invoices).toEqual([]);
    expect(contacts.contacts).toEqual([]);
  });

  it("A's tiles never count B's freight", async () => {
    const counts = await getShipperTileCounts(
      clientA as never,
      SHIPPER_B,
      new Date("2026-08-05T18:00:00.000Z"),
    );
    expect(counts.in_transit).toBe(0);
    expect(counts.outstanding_invoices).toBe(0);
  });

  it("an anonymous session reads nothing at all (§19)", async () => {
    // HONEST ATTRIBUTION: anon is refused here by 0009's `revoke all on
    // function public.my_shipper_ids() from public` — the policy predicate
    // itself is not executable by anon — BEFORE the "there is no anon policy
    // on `shipments`" rule ever comes into play. Both are real production
    // controls (0013 granted `is_staff()` to anon and deliberately did NOT
    // grant the membership helpers), and the POLICY half is asserted
    // separately, as a policy, in `supabase/tests/20_rls_isolation.sql` §7.
    // The module's own contract is what is proved here: whatever the database
    // says no to, the caller gets an empty list and a logged error, never a
    // row and never a throw.
    const result = await getShipperShipments(
      anonClient as never,
      SHIPPER_A,
      EMPTY_FILTERS,
      1,
    );
    expect(result.rows).toEqual([]);
    expect(result.failed).toBe(true);
    expect(
      await getShipmentSummary(anonClient as never, SHIPPER_A, SHIPMENT_A1),
    ).toBeNull();
  });

  /* ---------------------------------------------------------------- *
   * NON-VACUITY, BY INJECTION
   * ---------------------------------------------------------------- */

  it("INJECTION: with the app-level shipper predicate REMOVED, RLS alone still refuses", async () => {
    // The same query the list issues, minus `.eq("shipper_id", …)` — i.e. the
    // exact bug of forgetting the scope. If the predicate were the only thing
    // protecting the boundary, this would return all four shipments.
    const unscoped = await clientA
      .from("shipments")
      .select("id, tracking_number", { count: "exact" })
      .limit(50);
    expect(unscoped.error).toBeNull();
    const numbers = (unscoped.data ?? []).map(
      (r) => (r as { tracking_number: string }).tracking_number,
    );
    expect(numbers).not.toContain("PL-2026-740099");
    expect(numbers.sort()).toEqual([
      "PL-2026-740001",
      "PL-2026-740002",
      "PL-2026-740003",
    ]);
  });

  it("INJECTION CONTROL: the same unscoped query as an ADMIN sees everything", async () => {
    // Proves the assertion above is capable of failing — the rows exist, the
    // query shape works, and only the policy is keeping them apart.
    exec(`insert into auth.users (id, email) values
        ('00000000-0000-0000-0000-00000000f074', 'admin74@integration.test')
      on conflict do nothing`);
    exec(`insert into profiles (id, role, full_name) values
        ('00000000-0000-0000-0000-00000000f074', 'admin', 'Admin 74')
      on conflict (id) do update set role = 'admin'`);
    const adminClient = createRlsSupabaseClient({
      role: "authenticated",
      sub: "00000000-0000-0000-0000-00000000f074",
    });
    // The bound is generous rather than tight: this lane shares one database
    // and later modules (M-76 added ~25) create their own shipments, so a
    // 50-row cap would make this control fail for a reason that has nothing
    // to do with the policy it exists to prove.
    const all = await adminClient
      .from("shipments")
      .select("tracking_number")
      .limit(500);
    const numbers = (all.data ?? []).map(
      (r) => (r as { tracking_number: string }).tracking_number,
    );
    expect(numbers).toContain("PL-2026-740001");
    expect(numbers).toContain("PL-2026-740099");
  });

  it("INJECTION: a raw tracking-number lookup by the wrong tenant finds nothing", async () => {
    // §5's identifier is not an access grant, restated through the client the
    // portal actually uses.
    const found = await clientA
      .from("shipments")
      .select("id")
      .eq("tracking_number", "PL-2026-740099")
      .limit(1);
    expect(found.data).toEqual([]);
    // Non-vacuity: the row exists.
    expect(
      scalar(
        `select id::text from shipments where tracking_number = 'PL-2026-740099'`,
      ),
    ).toBe(SHIPMENT_B1);
  });
});

/* ------------------------------------------------------------------ *
 * §2 — the brokerage gate input
 * ------------------------------------------------------------------ */

describe("§2 brokerage gate input", () => {
  it("shipperHasAnyShipment is true for a tenant with freight and false for one without", async () => {
    expect(await shipperHasAnyShipment(clientA as never, SHIPPER_A)).toBe(true);
    // Asked AS shipper A about shipper B: RLS makes the answer false, which
    // is what keeps the gate from leaking the existence of another tenant.
    expect(await shipperHasAnyShipment(clientA as never, SHIPPER_B)).toBe(
      false,
    );
  });

  it("the gate is CLOSED in this lane, and shipments in flight stay readable", async () => {
    expect(
      scalar(
        `select value::text from company_settings where key = 'brokerage_active'`,
      ),
    ).toBe("false");
    const result = await getShipperShipments(
      clientA as never,
      SHIPPER_A,
      EMPTY_FILTERS,
      1,
    );
    // M-71 made the §2 gate INSERT-only for exactly this reason: freight
    // already moving must not vanish because a flag went back off.
    expect(result.total).toBe(3);
  });
});
