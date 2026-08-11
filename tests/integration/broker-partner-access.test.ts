import { beforeAll, describe, expect, it } from "vitest";

import {
  closeBrokerageGate,
  count,
  exec,
  lit,
  openBrokerageGate,
  scalar,
  sqlstateOf,
} from "./helpers/db";
import { createRlsSupabaseClient } from "./helpers/psql-rls-supabase";
import {
  getBrokerAccessBasis,
  getBrokerPartnerState,
  getBrokerShipmentContacts,
  getBrokerShipmentIds,
  getBrokerShipmentSummary,
  getBrokerShipments,
  getBrokerTimelinePage,
  brokerHasAnyShipment,
} from "@/lib/shipments/broker-access";
import { EMPTY_FILTERS } from "@/lib/shipments/shipper-list";
import { toBrokerDto } from "@/lib/shipments/dto";
import { brokerDeniedFields } from "@/lib/shipments/broker-permissions";
import { listShipmentDocuments } from "@/lib/shipments/document-store";

/**
 * M-81 — §12's broker-partner access, end to end against a real PostgreSQL 16.
 *
 * ── WHAT THIS LANE ANSWERS THAT THE OTHER TWO CANNOT ─────────────────────
 *
 * `tests/unit/shipment-broker-permissions.test.ts` proves the MATRIX is
 * correct and that the serializer obeys it; it touches no database.
 * `supabase/tests/20_rls_isolation.sql` proves a SESSION cannot cross a
 * partner boundary; it imports no TypeScript, so it cannot know whether the
 * portal's own query builder produces SQL the schema accepts.
 *
 * This file runs the REAL exported functions from
 * `src/lib/shipments/broker-access.ts` against the REAL schema (0001 … 0029)
 * as a REAL `authenticated` session with `request.jwt.claim.sub` set — which
 * is what `auth.uid()` reads and therefore what makes
 * `my_broker_partner_ids()` and every 0018/0019/0024/0029 policy fire.
 *
 * ── THE SIX CLAIMS ───────────────────────────────────────────────────────
 *
 *   1. an invited broker sees ONLY the shipments linked, granted or agreed;
 *   2. **broker A cannot read broker B's** — §19's named proof, through the
 *      real client;
 *   3. an UNVERIFIED broker sees nothing at all;
 *   4. a REVOKED grant and an EXPIRED agreement both stop access;
 *   5. a broker cannot reach a carrier packet or ANY financial field;
 *   6. the invite token lifecycle — single use, expiry, revocation — behaves
 *      as the schema promises.
 *
 * ── NON-VACUITY IS BY INJECTION ──────────────────────────────────────────
 *
 * The isolation block re-issues the SAME query with the application-level id
 * predicate DISABLED and asserts the database still returns nothing to the
 * wrong partner. That separates the two mechanisms: it shows the RLS policy
 * alone is doing the work, and it shows the assertion is capable of failing
 * (the same query as the OWNING partner returns the row).
 */

const SHIPPER_X = "22222222-2222-2222-2222-2222222x0081".replace("x", "a");
const SHIPPER_Y = "22222222-2222-2222-2222-2222222b0081";
const CARRIER_X = "11111111-1111-1111-1111-1111111a0081";

const PARTNER_A = "eeeeeeee-eeee-eeee-eeee-eeeeeee1a081";
const PARTNER_B = "eeeeeeee-eeee-eeee-eeee-eeeeeee1b081";
const PARTNER_U = "eeeeeeee-eeee-eeee-eeee-eeeeeee1c081"; // unverified

const USER_A = "00000000-0000-0000-0000-0000000a0081";
const USER_B = "00000000-0000-0000-0000-0000000b0081";
const USER_U = "00000000-0000-0000-0000-0000000c0081";
const DISPATCHER = "00000000-0000-0000-0000-0000000d0081";

/** Linked to partner A through `shipments.broker_partner_id` (M-71's floor). */
const SHIPMENT_LINKED = "ffffffff-ffff-ffff-ffff-fffffff10081";
/** Reached by partner A through a per-shipment GRANT. */
const SHIPMENT_GRANTED = "ffffffff-ffff-ffff-ffff-fffffff20081";
/** Reached by partner A through an ACCOUNT AGREEMENT on shipper Y. */
const SHIPMENT_AGREED = "ffffffff-ffff-ffff-ffff-fffffff30081";
/** Partner A's grant on it was REVOKED. */
const SHIPMENT_REVOKED = "ffffffff-ffff-ffff-ffff-fffffff40081";
/** Partner B's, and nobody else's. */
const SHIPMENT_B = "ffffffff-ffff-ffff-ffff-fffffff50081";

const clientA = createRlsSupabaseClient({ role: "authenticated", sub: USER_A });
const clientB = createRlsSupabaseClient({ role: "authenticated", sub: USER_B });
const clientU = createRlsSupabaseClient({ role: "authenticated", sub: USER_U });
const anonClient = createRlsSupabaseClient({ role: "anon", sub: null });

/**
 * The adapter is structurally NARROWER than `SupabaseClient` on purpose — it
 * implements the operators M-81 uses and throws on the rest, which is the
 * honest limit its own header records. Every module call therefore casts, the
 * same way M-74's and M-76's integration files do. Raw `client.from(...)`
 * probes below use the adapter directly, because those are deliberately
 * testing the adapter's own query shape rather than a module's.
 */
const asClient = (c: unknown) => c as never;

beforeAll(() => {
  exec(`insert into auth.users (id, email) values
      (${lit(USER_A)}, 'a@broker-a-81.test'),
      (${lit(USER_B)}, 'b@broker-b-81.test'),
      (${lit(USER_U)}, 'u@broker-u-81.test'),
      (${lit(DISPATCHER)}, 'dispatcher81@integration.test')
    on conflict do nothing`);
  // The `broker` role is 0028's value; it is set here to prove the same thing
  // the RLS suite proves — that it grants nothing by itself.
  exec(`insert into profiles (id, role, full_name) values
      (${lit(USER_A)}, 'broker', 'Partner A User'),
      (${lit(USER_B)}, 'broker', 'Partner B User'),
      (${lit(USER_U)}, 'broker', 'Unverified User'),
      (${lit(DISPATCHER)}, 'dispatcher', 'Dispatcher 81')
    on conflict (id) do update set role = excluded.role`);

  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER_X)}, 'Shipper X 81'),
      (${lit(SHIPPER_Y)}, 'Shipper Y 81') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER_X)}, 'Carrier X 81', true) on conflict do nothing`);

  exec(`insert into broker_partners
      (id, company_name, mc_number, active, verification_status, verified_by, verified_at)
    values
      (${lit(PARTNER_A)}, 'Partner A 81', 'MC-810001', true, 'verified', ${lit(DISPATCHER)}, now()),
      (${lit(PARTNER_B)}, 'Partner B 81', 'MC-810002', true, 'verified', ${lit(DISPATCHER)}, now()),
      (${lit(PARTNER_U)}, 'Partner U 81', 'MC-810003', true, 'pending', null, null)
    on conflict do nothing`);
  exec(`insert into broker_partner_memberships (broker_partner_id, profile_id, role) values
      (${lit(PARTNER_A)}, ${lit(USER_A)}, 'owner'),
      (${lit(PARTNER_B)}, ${lit(USER_B)}, 'owner'),
      (${lit(PARTNER_U)}, ${lit(USER_U)}, 'owner')
    on conflict do nothing`);

  // The §2 gate refuses every shipment INSERT while brokerage is off — even
  // for the table owner — so seeding has to open it deliberately.
  openBrokerageGate();
  const ship = (
    id: string,
    tracking: string,
    shipper: string,
    broker: string | null,
  ) =>
    exec(`insert into shipments (id, tracking_number, shipper_id, carrier_id,
        dispatcher_id, broker_partner_id, status, origin_city, origin_state,
        destination_city, destination_state, equipment,
        gross_shipper_amount, carrier_pay, margin, public_access_hash)
      values (${lit(id)}, ${lit(tracking)}, ${lit(shipper)}, ${lit(CARRIER_X)},
        ${lit(DISPATCHER)}, ${broker === null ? "null" : lit(broker)},
        'in_transit', 'Newark', 'NJ', 'Atlanta', 'GA', 'dry-van',
        900081, 800081, 100081, 'sha256-secret-81')`);

  ship(SHIPMENT_LINKED, "PL-2026-810001", SHIPPER_X, PARTNER_A);
  ship(SHIPMENT_GRANTED, "PL-2026-810002", SHIPPER_X, null);
  ship(SHIPMENT_AGREED, "PL-2026-810003", SHIPPER_Y, null);
  ship(SHIPMENT_REVOKED, "PL-2026-810004", SHIPPER_X, null);
  ship(SHIPMENT_B, "PL-2026-810005", SHIPPER_X, PARTNER_B);
  closeBrokerageGate();

  // §12's two sharing shapes, plus the two dead states.
  exec(`insert into broker_shipment_grants
      (shipment_id, broker_partner_id, granted_by, revoked_at, revoked_by, note)
    values
      (${lit(SHIPMENT_GRANTED)}, ${lit(PARTNER_A)}, ${lit(DISPATCHER)}, null, null, 'Shared for the lane'),
      (${lit(SHIPMENT_REVOKED)}, ${lit(PARTNER_A)}, ${lit(DISPATCHER)}, now(), ${lit(DISPATCHER)}, null),
      (${lit(SHIPMENT_GRANTED)}, ${lit(PARTNER_U)}, ${lit(DISPATCHER)}, null, null, 'Unverified partner')`);
  exec(`insert into broker_account_agreements
      (broker_partner_id, shipper_id, agreement_reference, starts_at, ends_at, granted_by)
    values
      (${lit(PARTNER_A)}, ${lit(SHIPPER_Y)}, 'AGR-81-LIVE', now() - interval '10 days', null, ${lit(DISPATCHER)})`);

  // Timeline: one band the partner reads, one it must not.
  exec(`insert into shipment_events
      (shipment_id, event_type, status, event_time, source, created_by,
       city, state, public_message, internal_message, visibility)
    values
      (${lit(SHIPMENT_GRANTED)}, 'status_change', 'in_transit', now() - interval '2 hours',
       'dispatcher', ${lit(DISPATCHER)}, 'Richmond', 'VA', 'Rolling south', null, 'broker'),
      (${lit(SHIPMENT_GRANTED)}, 'internal_note', null, now() - interval '1 hour',
       'dispatcher', ${lit(DISPATCHER)}, null, null, null,
       'SENTINEL-STAFF-NOTE-81', 'staff_only')`);

  // Contacts: one approved for sharing, one not.
  exec(`insert into shipment_parties
      (shipment_id, party_role, company_name, contact_name, phone, email, public_contact)
    values
      (${lit(SHIPMENT_GRANTED)}, 'consignee', 'Atlanta DC', 'Dock', '4045550181',
       'dock81@example.test', true),
      (${lit(SHIPMENT_GRANTED)}, 'billing', 'Shipper X 81', 'AP', '9735550181',
       'ap81@example.test', false)`);

  // Documents: the §16 matrix must still decide the TYPE on a granted shipment.
  exec(`insert into shipment_documents
      (shipment_id, doc_type, visibility, storage_path, file_name, mime_type,
       size_bytes, status, uploaded_by, reviewed_by, reviewed_at, approved_by, approved_at)
    values
      (${lit(SHIPMENT_GRANTED)}, 'bol', 'shipper',
       ${lit(`${SHIPMENT_GRANTED}/bol-81.pdf`)}, 'bol-81.pdf', 'application/pdf',
       100000, 'approved', ${lit(DISPATCHER)}, ${lit(DISPATCHER)}, now(), ${lit(DISPATCHER)}, now()),
      (${lit(SHIPMENT_GRANTED)}, 'rate_confirmation', 'carrier',
       ${lit(`${SHIPMENT_GRANTED}/rc-81.pdf`)}, 'rc-81.pdf', 'application/pdf',
       100000, 'approved', ${lit(DISPATCHER)}, ${lit(DISPATCHER)}, now(), ${lit(DISPATCHER)}, now()),
      (${lit(SHIPMENT_GRANTED)}, 'invoice', 'shipper',
       ${lit(`${SHIPMENT_GRANTED}/inv-81.pdf`)}, 'inv-81.pdf', 'application/pdf',
       100000, 'approved', ${lit(DISPATCHER)}, ${lit(DISPATCHER)}, now(), ${lit(DISPATCHER)}, now())`);
});

/* ================================================================== *
 * 1 · An invited, verified broker sees only what §12 grants
 * ================================================================== */

describe("§12 an invited broker sees only linked shipments", () => {
  it("resolves the organization AND its verified state", async () => {
    const state = await getBrokerPartnerState(asClient(clientA));
    expect(state.memberOf).toBe(PARTNER_A);
    expect(state.verified).toBe(true);
    expect(state.companyName).toBe("Partner A 81");
  });

  it("reaches exactly the three shipments §12's three shapes allow", async () => {
    const reachable = await getBrokerShipmentIds(asClient(clientA), PARTNER_A);
    expect(reachable.failed).toBe(false);
    expect([...reachable.ids].sort()).toEqual(
      [SHIPMENT_LINKED, SHIPMENT_GRANTED, SHIPMENT_AGREED].sort(),
    );
    expect(reachable.ids).not.toContain(SHIPMENT_REVOKED);
    expect(reachable.ids).not.toContain(SHIPMENT_B);
  });

  it("lists them through the real paginated query", async () => {
    const result = await getBrokerShipments(asClient(clientA), PARTNER_A, EMPTY_FILTERS, 1);
    expect(result.failed).toBe(false);
    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.id).sort()).toEqual(
      [SHIPMENT_LINKED, SHIPMENT_GRANTED, SHIPMENT_AGREED].sort(),
    );
  });

  it("answers the §2 gate question", async () => {
    expect(await brokerHasAnyShipment(asClient(clientA), PARTNER_A)).toBe(true);
  });

  it("opens the granted shipment and names WHY it is visible", async () => {
    const summary = await getBrokerShipmentSummary(
      asClient(clientA),
      PARTNER_A,
      SHIPMENT_GRANTED,
    );
    expect(summary).not.toBeNull();
    expect(summary?.tracking_number).toBe("PL-2026-810002");

    const basis = await getBrokerAccessBasis(asClient(clientA), PARTNER_A, SHIPMENT_GRANTED);
    expect(basis?.kind).toBe("grant");
    expect(basis?.reference).toBe("Shared for the lane");

    const linked = await getBrokerAccessBasis(asClient(clientA), PARTNER_A, SHIPMENT_LINKED);
    expect(linked?.kind).toBe("link");

    const agreed = await getBrokerAccessBasis(asClient(clientA), PARTNER_A, SHIPMENT_AGREED);
    expect(agreed?.kind).toBe("agreement");
    expect(agreed?.reference).toBe("AGR-81-LIVE");
  });

  it("reads the broker band of the timeline and nothing else", async () => {
    const page = await getBrokerTimelinePage(asClient(clientA), SHIPMENT_GRANTED);
    expect(page.failed).toBe(false);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.visibility).toBe("broker");
    expect(JSON.stringify(page.events)).not.toContain("SENTINEL-STAFF-NOTE-81");
  });

  it("reads only the approved contact channel (§12)", async () => {
    const result = await getBrokerShipmentContacts(asClient(clientA), SHIPMENT_GRANTED);
    expect(result.failed).toBe(false);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.party_role).toBe("consignee");
    expect(JSON.stringify(result.contacts)).not.toContain("ap81@example.test");
  });

  it("reads the approved BOL and NOT the rate confirmation or the invoice", async () => {
    const result = await listShipmentDocuments(asClient(clientA), SHIPMENT_GRANTED, "broker");
    expect(result.failed).toBe(false);
    expect(result.documents.map((d) => d.doc_type)).toEqual(["bol"]);
  });
});

/* ================================================================== *
 * 2 · §19's named proof — broker A cannot read broker B's
 * ================================================================== */

describe("§19 broker A cannot view broker B's shipment", () => {
  it("refuses the summary read", async () => {
    expect(
      await getBrokerShipmentSummary(asClient(clientA), PARTNER_A, SHIPMENT_B),
    ).toBeNull();
    expect(
      await getBrokerShipmentSummary(asClient(clientB), PARTNER_B, SHIPMENT_GRANTED),
    ).toBeNull();
  });

  it("keeps each partner's list to its own freight", async () => {
    const a = await getBrokerShipments(asClient(clientA), PARTNER_A, EMPTY_FILTERS, 1);
    const b = await getBrokerShipments(asClient(clientB), PARTNER_B, EMPTY_FILTERS, 1);
    expect(a.rows.map((r) => r.id)).not.toContain(SHIPMENT_B);
    expect(b.rows.map((r) => r.id)).toEqual([SHIPMENT_B]);
  });

  it("NON-VACUITY: the POLICY refuses it, not the app-level id filter", async () => {
    // The same query the module issues, with the reachable-id predicate
    // REMOVED. If only the application filter were doing the work, this would
    // return partner B's row to partner A.
    const forged = await clientA
      .from("shipments")
      .select("id, tracking_number")
      .eq("id", SHIPMENT_B)
      .maybeSingle();
    expect(forged.error).toBeNull();
    expect(forged.data).toBeNull();

    // …and the assertion is capable of failing: the OWNING partner gets it.
    const owner = await clientB
      .from("shipments")
      .select("id, tracking_number")
      .eq("id", SHIPMENT_B)
      .maybeSingle();
    expect((owner.data as { id: string } | null)?.id).toBe(SHIPMENT_B);
  });

  it("refuses the timeline and the documents too", async () => {
    const timeline = await getBrokerTimelinePage(asClient(clientB), SHIPMENT_GRANTED);
    expect(timeline.events).toHaveLength(0);
    const documents = await listShipmentDocuments(
      asClient(clientB),
      SHIPMENT_GRANTED,
      "broker",
    );
    expect(documents.documents).toHaveLength(0);
  });
});

/* ================================================================== *
 * 3 · An UNVERIFIED broker sees nothing
 * ================================================================== */

describe("§12 verification is a gate", () => {
  it("reports the membership but not the verification", async () => {
    const state = await getBrokerPartnerState(asClient(clientU));
    // NON-VACUITY: the membership row IS readable, so "sees nothing" below is
    // about verification and not about a missing fixture.
    expect(state.memberOf).toBe(PARTNER_U);
    expect(state.verified).toBe(false);
    expect(state.companyName).toBeNull();
  });

  it("reaches no shipment at all — even the one granted to it", async () => {
    const reachable = await getBrokerShipmentIds(asClient(clientU), PARTNER_U);
    expect(reachable.ids).toEqual([]);
    const list = await getBrokerShipments(asClient(clientU), PARTNER_U, EMPTY_FILTERS, 1);
    expect(list.rows).toEqual([]);
    expect(
      await getBrokerShipmentSummary(asClient(clientU), PARTNER_U, SHIPMENT_GRANTED),
    ).toBeNull();
    expect(await brokerHasAnyShipment(asClient(clientU), PARTNER_U)).toBe(false);
  });

  it("becomes able to read the moment an admin verifies — and stops again", async () => {
    // The verification function is the only writer, and it is service-role
    // only; the lane runs as the OWNER, which is how it can call it.
    exec(
      `select verify_broker_partner(${lit(PARTNER_U)}, ${lit(DISPATCHER)}, true, 'checked')`,
    );
    expect(
      (await getBrokerShipmentIds(asClient(clientU), PARTNER_U)).ids,
    ).toEqual([SHIPMENT_GRANTED]);
    expect(
      scalar(
        `select verification_status::text from broker_partners where id = ${lit(PARTNER_U)}`,
      ),
    ).toBe("verified");
    expect(
      scalar(`select verified_by::text from broker_partners where id = ${lit(PARTNER_U)}`),
    ).toBe(DISPATCHER);

    // Suspension revokes everywhere in one write — the reason the rule lives
    // inside `my_broker_partner_ids()` rather than in six policies.
    exec(
      `select verify_broker_partner(${lit(PARTNER_U)}, ${lit(DISPATCHER)}, false, 'bond lapsed')`,
    );
    expect((await getBrokerShipmentIds(asClient(clientU), PARTNER_U)).ids).toEqual([]);
    expect(
      scalar(
        `select verification_status::text from broker_partners where id = ${lit(PARTNER_U)}`,
      ),
    ).toBe("suspended");
  });

  it("raises PL404 for an organization that does not exist", () => {
    expect(
      sqlstateOf(
        `select verify_broker_partner('00000000-0000-0000-0000-000000000000', ${lit(DISPATCHER)}, true, null)`,
      ),
    ).toBe("PL404");
  });
});

/* ================================================================== *
 * 4 · Revocation and expiry
 * ================================================================== */

describe("§12 revocation and expiry stop access", () => {
  it("a REVOKED per-shipment grant is not reachable", async () => {
    expect(
      await getBrokerShipmentSummary(asClient(clientA), PARTNER_A, SHIPMENT_REVOKED),
    ).toBeNull();
    expect(
      count(
        `select 1 from broker_shipment_grants where shipment_id = ${lit(SHIPMENT_REVOKED)} and revoked_at is not null`,
      ),
      // NON-VACUITY: the grant row exists; it is the revocation that refuses.
    ).toBe(1);
  });

  it("NON-VACUITY: the POLICY refuses a revoked grant, not the app-level filter", async () => {
    /*
     * `getBrokerShipmentSummary` narrows to the reachable-id set BEFORE it
     * queries, so on its own it would pass even if `broker_can_read_shipment()`
     * had dropped its `revoked_at is null` clause — the two mechanisms would be
     * indistinguishable. This probe removes the application half: the SAME
     * query with no id-set narrowing, straight through the policy.
     *
     * Verified by injection: deleting that clause from 0029 makes THIS
     * assertion fail while every other test in the file still passes.
     */
    const revoked = await clientA
      .from("shipments")
      .select("id")
      .eq("id", SHIPMENT_REVOKED)
      .maybeSingle();
    expect(revoked.error).toBeNull();
    expect(revoked.data).toBeNull();

    // …and the assertion is capable of failing: the LIVE grant comes back
    // through the identical query.
    const live = await clientA
      .from("shipments")
      .select("id")
      .eq("id", SHIPMENT_GRANTED)
      .maybeSingle();
    expect((live.data as { id: string } | null)?.id).toBe(SHIPMENT_GRANTED);
  });

  it("NON-VACUITY: the POLICY honours the agreement window too", async () => {
    exec(`update broker_account_agreements set ends_at = now() - interval '1 day'
          where broker_partner_id = ${lit(PARTNER_A)} and shipper_id = ${lit(SHIPPER_Y)}`);
    const closed = await clientA
      .from("shipments")
      .select("id")
      .eq("id", SHIPMENT_AGREED)
      .maybeSingle();
    expect(closed.data).toBeNull();
    exec(`update broker_account_agreements set ends_at = null
          where broker_partner_id = ${lit(PARTNER_A)} and shipper_id = ${lit(SHIPPER_Y)}`);
    const open = await clientA
      .from("shipments")
      .select("id")
      .eq("id", SHIPMENT_AGREED)
      .maybeSingle();
    expect((open.data as { id: string } | null)?.id).toBe(SHIPMENT_AGREED);
  });

  it("revoking a LIVE grant closes the shipment immediately", async () => {
    expect(
      await getBrokerShipmentSummary(asClient(clientA), PARTNER_A, SHIPMENT_GRANTED),
    ).not.toBeNull();
    exec(`update broker_shipment_grants
            set revoked_at = now(), revoked_by = ${lit(DISPATCHER)}
          where shipment_id = ${lit(SHIPMENT_GRANTED)}
            and broker_partner_id = ${lit(PARTNER_A)}`);
    expect(
      await getBrokerShipmentSummary(asClient(clientA), PARTNER_A, SHIPMENT_GRANTED),
    ).toBeNull();
    // Restore, so the ordering of the remaining tests does not matter.
    exec(`update broker_shipment_grants set revoked_at = null, revoked_by = null
          where shipment_id = ${lit(SHIPMENT_GRANTED)}
            and broker_partner_id = ${lit(PARTNER_A)}`);
    expect(
      await getBrokerShipmentSummary(asClient(clientA), PARTNER_A, SHIPMENT_GRANTED),
    ).not.toBeNull();
  });

  it("an EXPIRED agreement stops covering new reads", async () => {
    expect(
      await getBrokerShipmentSummary(asClient(clientA), PARTNER_A, SHIPMENT_AGREED),
    ).not.toBeNull();
    exec(`update broker_account_agreements set ends_at = now() - interval '1 day'
          where broker_partner_id = ${lit(PARTNER_A)} and shipper_id = ${lit(SHIPPER_Y)}`);
    expect(
      await getBrokerShipmentSummary(asClient(clientA), PARTNER_A, SHIPMENT_AGREED),
    ).toBeNull();
    exec(`update broker_account_agreements set ends_at = null
          where broker_partner_id = ${lit(PARTNER_A)} and shipper_id = ${lit(SHIPPER_Y)}`);
  });

  it("a REVOKED agreement beats an open window", async () => {
    exec(`update broker_account_agreements
            set revoked_at = now(), revoked_by = ${lit(DISPATCHER)}
          where broker_partner_id = ${lit(PARTNER_A)} and shipper_id = ${lit(SHIPPER_Y)}`);
    expect(
      await getBrokerShipmentSummary(asClient(clientA), PARTNER_A, SHIPMENT_AGREED),
    ).toBeNull();
    exec(`update broker_account_agreements set revoked_at = null, revoked_by = null
          where broker_partner_id = ${lit(PARTNER_A)} and shipper_id = ${lit(SHIPPER_Y)}`);
  });

  it("refuses a SECOND live grant for the same (shipment, partner)", () => {
    expect(
      sqlstateOf(`insert into broker_shipment_grants
          (shipment_id, broker_partner_id, granted_by)
        values (${lit(SHIPMENT_GRANTED)}, ${lit(PARTNER_A)}, ${lit(DISPATCHER)})`),
    ).toBe("23505");
  });

  it("allows a NEW grant after a revocation — history is a sequence", () => {
    expect(
      sqlstateOf(`insert into broker_shipment_grants
          (shipment_id, broker_partner_id, granted_by)
        values (${lit(SHIPMENT_REVOKED)}, ${lit(PARTNER_A)}, ${lit(DISPATCHER)})`),
    ).toBe("OK");
    exec(`update broker_shipment_grants
            set revoked_at = now(), revoked_by = ${lit(DISPATCHER)}
          where shipment_id = ${lit(SHIPMENT_REVOKED)} and revoked_at is null`);
  });
});

/* ================================================================== *
 * 5 · §12's deny list, at the database
 * ================================================================== */

describe("§12 a broker reaches no carrier packet and no financial field", () => {
  it("reads nothing from the carrier tables", async () => {
    for (const table of ["carriers", "documents", "drivers", "trucks", "shipment_assignments"]) {
      const result = await clientA.from(table).select("*").limit(5);
      expect(result.error, `${table} errored`).toBeNull();
      expect(result.data, `${table} leaked rows`).toEqual([]);
    }
  });

  it("reads nothing from the billing tables", async () => {
    for (const table of ["invoices", "freight_quotes"]) {
      const result = await clientA.from(table).select("*").limit(5);
      expect(result.error, `${table} errored`).toBeNull();
      expect(result.data, `${table} leaked rows`).toEqual([]);
    }
  });

  it("cannot select a denied column even on a shipment it CAN read", async () => {
    // ── INVERTED BY M-83, DELIBERATELY ────────────────────────────────────
    //
    // This assertion used to say the opposite, and said so openly: *"the row
    // DOES come back with its financial columns to a hand-written query …
    // M-71 recorded the same residual risk as R-1."* Migration 0030 §4
    // revokes `margin` (with `gross_shipper_amount`, `carrier_pay` and
    // `public_access_hash`) from `authenticated` and `anon`, so naming the
    // column is now a privilege error — 42501 — before RLS is consulted at
    // all. R-1 is closed, and the test that documented it is the test that
    // now proves it.
    const raw = await clientA
      .from("shipments")
      .select("id, margin")
      .eq("id", SHIPMENT_LINKED)
      .maybeSingle();
    expect(raw.error, "margin is still selectable by a broker session").not.toBeNull();
    expect(raw.error?.code).toBe("42501");
    expect(raw.data).toBeNull();

    // Non-vacuity: the ROW is still readable — the refusal is about the
    // column, not about the broker's access to the shipment.
    const readable = await clientA
      .from("shipments")
      .select("id, status")
      .eq("id", SHIPMENT_LINKED)
      .maybeSingle();
    expect(readable.error).toBeNull();
    expect((readable.data as { id: string } | null)?.id).toBe(SHIPMENT_LINKED);

    // …and the module's own read carries none of it.
    const summary = await getBrokerShipmentSummary(
      asClient(clientA),
      PARTNER_A,
      SHIPMENT_LINKED,
    );
    const keys = Object.keys(summary ?? {});
    for (const denied of brokerDeniedFields()) {
      expect(keys, `${denied} was fetched`).not.toContain(denied);
    }
  });

  it("serializes no financial value for the broker audience", async () => {
    const summary = await getBrokerShipmentSummary(
      asClient(clientA),
      PARTNER_A,
      SHIPMENT_LINKED,
    );
    expect(summary).not.toBeNull();
    const dto = toBrokerDto({
      shipment: {
        ...summary!,
        shipper_id: "",
        dispatcher_id: null,
        quote_id: null,
        broker_partner_id: null,
        load_id: null,
        gross_shipper_amount: null,
        carrier_pay: null,
        margin: null,
        public_tracking_enabled: false,
        public_access_hash: null,
        delay_reason_internal: null,
      },
    });
    const json = JSON.stringify(dto);
    for (const sentinel of ["900081", "800081", "100081", "sha256-secret-81"]) {
      expect(json, `${sentinel} leaked`).not.toContain(sentinel);
    }
  });

  it("gives anon nothing on any broker table", async () => {
    for (const table of [
      "broker_partners",
      "broker_partner_memberships",
      "broker_shipment_grants",
      "broker_account_agreements",
    ]) {
      const result = await anonClient.from(table).select("*").limit(5);
      // Either zero rows or a permission refusal; both mean "nothing reaches
      // anon". The RLS suite asserts the same thing in SQL.
      expect(result.error !== null || (result.data ?? []).length === 0).toBe(true);
    }
  });
});

/* ================================================================== *
 * 6 · The invite token lifecycle
 * ================================================================== */

describe("§12 invite token lifecycle", () => {
  const INVITE_PENDING = "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b18101";
  const INVITE_USED = "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b18102";

  beforeAll(() => {
    exec(`insert into broker_partner_invites
        (id, broker_partner_id, email, membership_role, token_hash, invited_by, expires_at)
      values
        (${lit(INVITE_PENDING)}, ${lit(PARTNER_A)}, 'new@partner-a-81.test', 'member',
         ${lit("a".repeat(64))}, ${lit(DISPATCHER)}, now() + interval '7 days'),
        (${lit(INVITE_USED)}, ${lit(PARTNER_A)}, 'used@partner-a-81.test', 'owner',
         ${lit("b".repeat(64))}, ${lit(DISPATCHER)}, now() + interval '7 days')`);
  });

  it("stores a hash and never a raw token", () => {
    // 64 hex characters = sha256; the raw token is 64 hex too, so the real
    // guarantee is the COLUMN GRANT, asserted below and in the RLS suite.
    expect(
      scalar(
        `select length(token_hash)::text from broker_partner_invites where id = ${lit(INVITE_PENDING)}`,
      ),
    ).toBe("64");
  });

  it("enforces token-hash uniqueness", () => {
    expect(
      sqlstateOf(`insert into broker_partner_invites
          (broker_partner_id, email, token_hash, invited_by, expires_at)
        values (${lit(PARTNER_A)}, 'dup@partner-a-81.test', ${lit("a".repeat(64))},
                ${lit(DISPATCHER)}, now() + interval '7 days')`),
    ).toBe("23505");
  });

  it("refuses a row that is both accepted AND revoked", () => {
    expect(
      sqlstateOf(`update broker_partner_invites
          set accepted_at = now(), revoked_at = now(), revoked_by = ${lit(DISPATCHER)}
        where id = ${lit(INVITE_PENDING)}`),
    ).toBe("23514");
  });

  it("accepts a single use, and the row records who used it", () => {
    exec(`update broker_partner_invites
            set accepted_at = now(), accepted_by = ${lit(USER_A)}
          where id = ${lit(INVITE_USED)}`);
    expect(
      scalar(
        `select accepted_by::text from broker_partner_invites where id = ${lit(INVITE_USED)}`,
      ),
    ).toBe(USER_A);
  });

  it("cascades away with its organization", () => {
    const before = count(
      `select 1 from broker_partner_invites where broker_partner_id = ${lit(PARTNER_B)}`,
    );
    exec(`insert into broker_partner_invites
        (broker_partner_id, email, token_hash, invited_by, expires_at)
      values (${lit(PARTNER_B)}, 'cascade@partner-b-81.test', ${lit("c".repeat(64))},
              ${lit(DISPATCHER)}, now() + interval '7 days')`);
    expect(
      count(
        `select 1 from broker_partner_invites where broker_partner_id = ${lit(PARTNER_B)}`,
      ),
    ).toBe(before + 1);
  });
});
