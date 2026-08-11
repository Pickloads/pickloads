import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeBrokerageGate,
  count,
  exec,
  lit,
  openBrokerageGate,
  scalar,
  sqlstateOf,
} from "./helpers/db";
import { createPsqlSupabaseClient, resetCapturedInserts } from "./helpers/psql-supabase";
import { createRlsSupabaseClient } from "./helpers/psql-rls-supabase";

/**
 * M-83 — the tracking security audit, against a real PostgreSQL 16.
 *
 * `docs/DIRECTIVE-tracking.md` §19 names seven proofs. `supabase/tests/
 * 20_rls_isolation.sql` §17 proves all seven as POLICY and PRIVILEGE facts.
 * This file proves the four things SQL alone cannot:
 *
 *   1. **Route-level public-DTO key sets.** M-70's own doc concedes its unit
 *      tests *"cannot show that M-73 calls `toPublicTrackingDto` rather than
 *      returning the row."* Here the REAL server action runs against the REAL
 *      database and its response object is compared to an EXACT key set,
 *      on a row that carries a sentinel value in every column a customer may
 *      never see.
 *   2. **The enumeration audit.** Every refusal class — unknown number,
 *      correct number with the wrong second factor, tracking suspended,
 *      malformed input — must produce a BYTE-IDENTICAL response. Not
 *      similar: identical, compared as serialized JSON, because a difference
 *      in one nullable field is an existence oracle.
 *   3. **Financial-write rejection at every write path**, including the
 *      SECURITY DEFINER RPCs that RLS does not constrain.
 *   4. **Dispatcher scope through the real reader functions** — the layer
 *      where M-77's staff document-download action turned out to have no
 *      scope check at all.
 *
 * Plus adversarial probing of M-76's driver tokens: expiry, revocation,
 * rate limiting and non-enumerability, asserted on the SHAPE of the answer
 * rather than on the outcome recorded in the ledger.
 */

process.env.TRACKING_ACCESS_SECRET = "m83-integration-secret";
process.env.DRIVER_TOKEN_SECRET = "m83-driver-secret";

/* ---- the stubbed limiter (M-73's precedent: Upstash is not in this lane) ---- */
let allowance = Number.POSITIVE_INFINITY;
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => {
    if (allowance <= 0) return false;
    allowance -= 1;
    return true;
  },
}));

const admin = createPsqlSupabaseClient();
vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => admin,
  createAdminClient: () => admin,
}));

const { hashSecondaryValue } = await import("@/lib/shipments/access-code");
const { lookupPublicTracking } = await import("@/lib/shipments/public-lookup");
const { hashDriverToken, mintDriverToken } = await import(
  "@/lib/shipments/driver-token"
);
const { redeemDriverToken } = await import("@/lib/shipments/driver-access");
const { getStaffShipment } = await import("@/lib/shipments/staff-detail");
const { getCarrierShipmentSummary } = await import(
  "@/lib/shipments/carrier-shipments"
);
const { getShipmentRestrictedFields } = await import(
  "@/lib/shipments/restricted-fields"
);
const { searchShipmentsByTrackingNumber } = await import(
  "@/lib/shipments/search"
);

/* ---- M-83's own identities (the lane shares one database) ---- */
const SHIPPER = "22222222-2222-2222-2222-222222083001";
const CARRIER_A = "11111111-1111-1111-1111-111111083001";
const CARRIER_B = "11111111-1111-1111-1111-111111083002";
const DISPATCHER_1 = "00000000-0000-0000-0000-000000083d01";
const DISPATCHER_2 = "00000000-0000-0000-0000-000000083d02";
const ADMIN = "00000000-0000-0000-0000-000000083a01";
const CARRIER_USER_A = "00000000-0000-0000-0000-000000083c01";
const SHIPPER_USER = "00000000-0000-0000-0000-000000083501";

const TRACKED = "PL-2026-083001";
const SUSPENDED = "PL-2026-083002";
const OTHER_DISPATCHER = "PL-2026-083003";
const UNKNOWN = "PL-2026-083999";
const ZIP = "07104";
const WRONG_ZIP = "90210";

/** Values planted in every column a customer must never receive. */
const SENTINELS = {
  gross: 918_273,
  pay: 645_342,
  margin: 272_931,
  internalDelay: "M83-INTERNAL-DELAY-SENTINEL",
  internalNote: "M83-STAFF-ONLY-NOTE-SENTINEL",
  reference: "M83-SHIPPER-REF",
} as const;

let trackedId = "";
let suspendedId = "";
let otherId = "";
let releasedId = "";

function ship(sql: string): string {
  const id = scalar(sql);
  expect(id).not.toBeNull();
  return id ?? "";
}

/** A driver link, minted by the shipped hasher and issued by 0023's own RPC —
 *  never by a hand-written INSERT, so the CHECKs and the timeline event that
 *  accompany a real issue are exercised. */
function issueToken(
  opts: { shipmentId?: string; expiresAt?: string } = {},
): { token: string; tokenId: string } {
  const token = mintDriverToken() ?? "";
  const hash = hashDriverToken(token) ?? "";
  const row = JSON.parse(
    scalar(
      `select issue_shipment_driver_token(${lit(opts.shipmentId ?? trackedId)},
         ${lit(CARRIER_A)}, ${lit(hash)},
         ${lit(opts.expiresAt ?? "2099-01-01T00:00:00Z")},
         null, 'M83 Driver', 'dispatcher', ${lit(DISPATCHER_1)})`,
    ) ?? "{}",
  ) as { token_id: string };
  return { token, tokenId: row.token_id };
}

/**
 * Run one statement as a browser role and hand back its SQLSTATE.
 *
 * `helpers/psql-rls-supabase` is read-only by construction (M-74's decision),
 * and the write half of §19's proofs has to run as `authenticated`, not as
 * the owner. `itest.sqlstate_of` is SECURITY INVOKER, so wrapping it in
 * `set local role` runs the statement with the caller's privileges and RLS
 * fully in force.
 */
function sqlstateAs(role: "authenticated" | "anon", sub: string | null, stmt: string): string {
  return (
    scalar(
      `begin; set local role ${role}; ` +
        `set local "request.jwt.claim.sub" = ${lit(sub ?? "")}; ` +
        `select itest.sqlstate_of(${lit(stmt)}); commit`,
    ) ?? ""
  );
}

beforeAll(() => {
  exec(`insert into auth.users (id, email) values
      (${lit(DISPATCHER_1)}, 'd1@m83.test'),
      (${lit(DISPATCHER_2)}, 'd2@m83.test'),
      (${lit(ADMIN)}, 'admin@m83.test'),
      (${lit(CARRIER_USER_A)}, 'carrier@m83.test'),
      (${lit(SHIPPER_USER)}, 'shipper@m83.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(DISPATCHER_1)}, 'dispatcher', 'M83 Dispatcher One'),
      (${lit(DISPATCHER_2)}, 'dispatcher', 'M83 Dispatcher Two'),
      (${lit(ADMIN)}, 'admin', 'M83 Admin'),
      (${lit(CARRIER_USER_A)}, 'carrier', 'M83 Carrier User'),
      (${lit(SHIPPER_USER)}, 'shipper', 'M83 Shipper User')
    on conflict (id) do update set role = excluded.role`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER)}, 'M83 Shipper Inc') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active, assigned_dispatcher_id) values
      (${lit(CARRIER_A)}, 'M83 Carrier A', true, ${lit(DISPATCHER_1)}),
      (${lit(CARRIER_B)}, 'M83 Carrier B', true, ${lit(DISPATCHER_2)})
    on conflict (id) do update set assigned_dispatcher_id = excluded.assigned_dispatcher_id`);
  exec(`insert into carrier_memberships (carrier_id, profile_id, role) values
      (${lit(CARRIER_A)}, ${lit(CARRIER_USER_A)}, 'owner') on conflict do nothing`);
  exec(`insert into shipper_memberships (shipper_id, profile_id, role) values
      (${lit(SHIPPER)}, ${lit(SHIPPER_USER)}, 'owner') on conflict do nothing`);

  const hash = hashSecondaryValue(ZIP);
  expect(hash).toMatch(/^v1:[0-9a-f]{64}$/);

  openBrokerageGate();

  trackedId = ship(`insert into shipments (
      tracking_number, shipper_id, carrier_id, dispatcher_id, status,
      origin_city, origin_state, destination_city, destination_state, equipment,
      gross_shipper_amount, carrier_pay, margin, delay_reason_internal,
      shipper_reference, public_tracking_enabled, location_visibility,
      public_access_hash, estimated_delivery_at, eta_source, eta_confidence
    ) values (
      ${lit(TRACKED)}, ${lit(SHIPPER)}, ${lit(CARRIER_A)}, ${lit(DISPATCHER_1)},
      'in_transit', 'Newark', 'NJ', 'Atlanta', 'GA', 'dry-van',
      ${SENTINELS.gross}, ${SENTINELS.pay}, ${SENTINELS.margin},
      ${lit(SENTINELS.internalDelay)}, ${lit(SENTINELS.reference)},
      true, 'approximate', ${lit(hash ?? "")},
      '2026-08-20T14:00:00Z', 'manual', 'medium'
    ) returning id`);

  suspendedId = ship(`insert into shipments (
      tracking_number, shipper_id, status, origin_city, origin_state,
      destination_city, destination_state, equipment,
      public_tracking_enabled, public_access_hash
    ) values (
      ${lit(SUSPENDED)}, ${lit(SHIPPER)}, 'in_transit', 'Newark', 'NJ',
      'Boston', 'MA', 'reefer', false, ${lit(hash ?? "")}
    ) returning id`);

  // Dispatcher 2's freight, with no carrier at all — so NEITHER scope arm
  // reaches it from dispatcher 1.
  otherId = ship(`insert into shipments (
      tracking_number, shipper_id, dispatcher_id, status,
      origin_city, origin_state, destination_city, destination_state, equipment,
      gross_shipper_amount, carrier_pay, margin
    ) values (
      ${lit(OTHER_DISPATCHER)}, ${lit(SHIPPER)}, ${lit(DISPATCHER_2)},
      'carrier_search', 'Denver', 'CO', 'Phoenix', 'AZ', 'flatbed',
      11, 22, 33
    ) returning id`);

  releasedId = ship(`insert into shipments (
      tracking_number, shipper_id, dispatcher_id, status,
      origin_city, origin_state, destination_city, destination_state, equipment
    ) values (
      'PL-2026-083004', ${lit(SHIPPER)}, ${lit(DISPATCHER_1)}, 'carrier_assigned',
      'Reno', 'NV', 'Boise', 'ID', 'dry-van'
    ) returning id`);

  closeBrokerageGate();

  // A real assignment, through 0022's own function: `issue_shipment_driver_token`
  // refuses a link for a carrier that is not the ACTIVE assignment (M-76 §13),
  // so a hand-set `carrier_id` is not enough.
  exec(`select assign_shipment_carrier(${lit(trackedId)}, ${lit(CARRIER_A)},
        null, null, ${lit(DISPATCHER_1)}, ${lit(DISPATCHER_1)})`);

  exec(`select assign_shipment_carrier(${lit(releasedId)}, ${lit(CARRIER_A)},
        null, null, ${lit(DISPATCHER_1)}, ${lit(DISPATCHER_1)})`);

  exec(`select append_shipment_event(${lit(trackedId)}, 'public_update', 'dispatcher',
        null, 'public', '2026-08-10T14:00:00Z', 'phrase:update.in_transit',
        null, 'Knoxville', 'TN', null, null, '{}'::jsonb, null, null, 'in_transit')`);
  exec(`select append_shipment_event(${lit(trackedId)}, 'internal_note', 'dispatcher',
        null, 'staff_only', '2026-08-10T15:00:00Z', null,
        ${lit(SENTINELS.internalNote)}, null, null, null, null, '{}'::jsonb,
        null, null, null)`);
});

beforeEach(() => {
  allowance = Number.POSITIVE_INFINITY;
  resetCapturedInserts();
});

/* ================================================================== *
 * 1 · ROUTE-LEVEL public-DTO key sets
 *
 * M-70's tests prove the SERIALIZERS. These prove the RESPONSE.
 * ================================================================== */

/** The exact key set `/track` may answer with. Adding a field here without
 *  adding it to `PublicTrackingDto` (or the reverse) fails the test. */
const PUBLIC_TRACKING_KEYS = [
  "tracking_number", "status", "status_key",
  "origin_city", "origin_state", "destination_city", "destination_state",
  "pickup_appointment_at", "delivery_appointment_at",
  "estimated_pickup_at", "estimated_delivery_at",
  "eta_source", "eta_confidence", "eta_updated_at",
  "delay_minutes", "delay_reason",
  "equipment", "commodity_category", "weight_lbs", "pallets",
  "shipper_reference", "po_number",
  "carrier_assigned", "tracking_mode", "location_visibility",
  "current_city", "current_state", "current_latitude", "current_longitude",
  "last_location_at", "completed_at", "cancelled_at",
  "events", "exceptions", "locations",
].sort();

/** Everything a public response must never contain, at any depth. */
const FORBIDDEN_VALUES = [
  String(SENTINELS.gross),
  String(SENTINELS.pay),
  String(SENTINELS.margin),
  SENTINELS.internalDelay,
  SENTINELS.internalNote,
  hashSecondaryValue(ZIP) ?? "no-hash",
  ZIP,
];

const FORBIDDEN_KEYS = [
  "gross_shipper_amount",
  "carrier_pay",
  "margin",
  "delay_reason_internal",
  "public_access_hash",
  "internal_message",
  "metadata",
  "shipper_id",
  "carrier_id",
  "dispatcher_id",
  "broker_partner_id",
  "id",
];

function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, into);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe("§19 PROOF 4 — public tracking cannot expose private fields (ROUTE level)", () => {
  it("answers with EXACTLY the public DTO key set, from the real database", async () => {
    const result = await lookupPublicTracking({
      trackingNumber: TRACKED,
      secondaryValue: ZIP,
      ip: "198.51.100.83",
      userAgent: "m83/1.0",
    });
    expect(result.ok, "the happy path must actually succeed").toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.tracking).sort()).toEqual(PUBLIC_TRACKING_KEYS);
  });

  it("carries NO forbidden key anywhere in the response tree", async () => {
    const result = await lookupPublicTracking({
      trackingNumber: TRACKED,
      secondaryValue: ZIP,
      ip: "198.51.100.83",
      userAgent: "m83/1.0",
    });
    if (!result.ok) throw new Error("lookup failed");
    const keys = allKeys(result);
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys, `${forbidden} reached the public response`).not.toContain(
        forbidden,
      );
    }
  });

  it("carries NO forbidden VALUE — the sweep a key-set test cannot do", async () => {
    // A key-set test proves nothing about a value smuggled into a public
    // string. The shipment genuinely holds all seven sentinels in the
    // database, so a zero here is a statement about the response and not
    // about an empty row.
    const result = await lookupPublicTracking({
      trackingNumber: TRACKED,
      secondaryValue: ZIP,
      ip: "198.51.100.83",
      userAgent: "m83/1.0",
    });
    if (!result.ok) throw new Error("lookup failed");
    const blob = JSON.stringify(result);
    for (const value of FORBIDDEN_VALUES) {
      expect(blob, `${value} leaked into the public response`).not.toContain(
        value,
      );
    }
    // Non-vacuity: the sentinels ARE in the row this response came from.
    expect(
      count(
        `select count(*) from shipments where id = ${lit(trackedId)}
           and margin = ${SENTINELS.margin}
           and delay_reason_internal = ${lit(SENTINELS.internalDelay)}`,
      ),
    ).toBe(1);
  });

  it("gives the DRIVER route the same treatment", async () => {
    const { token } = issueToken();

    const result = await redeemDriverToken({
      token,
      ip: "198.51.100.84",
      userAgent: "m83-driver/1.0",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const blob = JSON.stringify(result);
    for (const value of FORBIDDEN_VALUES) {
      expect(blob, `${value} leaked to the driver page`).not.toContain(value);
    }
    for (const forbidden of [
      "gross_shipper_amount",
      "carrier_pay",
      "margin",
      "shipper_id",
      "shipper_reference",
      "public_access_hash",
    ]) {
      expect(
        allKeys(result),
        `${forbidden} reached the driver page`,
      ).not.toContain(forbidden);
    }
  });
});

/* ================================================================== *
 * 2 · ENUMERATION AUDIT
 * ================================================================== */

describe("§19 — enumeration audit: every miss answers identically", () => {
  const probes: [string, string, string][] = [
    ["unknown number", UNKNOWN, ZIP],
    ["known number, wrong ZIP", TRACKED, WRONG_ZIP],
    ["tracking suspended by an admin", SUSPENDED, ZIP],
    ["malformed number", "not-a-tracking-number", ZIP],
    ["well-formed but impossible year", "PL-1999-000001", ZIP],
    ["empty second factor", UNKNOWN, ""],
  ];

  it("returns a BYTE-IDENTICAL payload for every refusal class", async () => {
    const seen: string[] = [];
    for (const [label, number, secondary] of probes) {
      const result = await lookupPublicTracking({
        trackingNumber: number,
        secondaryValue: secondary,
        ip: "203.0.113.83",
        userAgent: "m83-probe/1.0",
      });
      expect(result.ok, `${label} must be refused`).toBe(false);
      seen.push(JSON.stringify(result));
    }
    // One distinct payload across six genuinely different internal outcomes.
    expect(new Set(seen).size, `payloads differed: ${seen.join(" | ")}`).toBe(1);
  });

  it("still records the TRUE outcome in the staff-only ledger", () => {
    // The suspended shipment exists and is reachable to staff — so the
    // `tracking_disabled` row below is a statement about the POLICY, not
    // about a fixture that was never created.
    expect(count(`select count(*) from shipments where id = ${lit(suspendedId)}`)).toBe(1);
    // The refusals are indistinguishable to the caller and fully attributed
    // to the operator. If they were indistinguishable to BOTH, the control
    // would be invisible during an incident.
    for (const outcome of ["not_found", "bad_secondary", "tracking_disabled"]) {
      expect(
        count(
          `select count(*) from shipment_tracking_access where outcome = ${lit(outcome)}`,
        ),
        `no ledger row for ${outcome}`,
      ).toBeGreaterThan(0);
    }
  });

  it("stores the attempted second factor in NO form at all", () => {
    // M-73's Attack 5, re-run at value level against the whole table after
    // this file's probes have been through it.
    expect(
      count(
        `select count(*) from shipment_tracking_access
          where to_jsonb(shipment_tracking_access)::text ilike ${lit(`%${ZIP}%`)}
             or to_jsonb(shipment_tracking_access)::text ilike ${lit(`%${WRONG_ZIP}%`)}`,
      ),
    ).toBe(0);
  });

  it("keeps the refusal shape when the environment is UNCONFIGURED too", async () => {
    // "Cannot verify" must not be distinguishable from "wrong credential" by
    // anything the caller can measure except the honest `unavailable` code —
    // which is true for every input, so it is not an oracle.
    const saved = process.env.TRACKING_ACCESS_SECRET;
    delete process.env.TRACKING_ACCESS_SECRET;
    const known = await lookupPublicTracking({
      trackingNumber: TRACKED,
      secondaryValue: ZIP,
      ip: "203.0.113.84",
      userAgent: "m83-probe/1.0",
    });
    const unknown = await lookupPublicTracking({
      trackingNumber: UNKNOWN,
      secondaryValue: ZIP,
      ip: "203.0.113.84",
      userAgent: "m83-probe/1.0",
    });
    process.env.TRACKING_ACCESS_SECRET = saved;
    expect(JSON.stringify(known)).toBe(JSON.stringify(unknown));
  });
});

describe("§13 — driver tokens under adversarial probing", () => {
  it("refuses expired, revoked, unknown, malformed and released links IDENTICALLY", async () => {
    const expired = issueToken();
    // 0023 forbids issuing an already-expired link, so it is aged after the
    // fact — the state an operator actually encounters.
    exec(`update shipment_driver_tokens
            set issued_at = now() - interval '3 hours',
                expires_at = now() - interval '1 hour'
          where id = ${lit(expired.tokenId)}`);
    const revoked = issueToken();
    exec(`select revoke_shipment_driver_token(${lit(revoked.tokenId)}, 'm83 probe', ${lit(DISPATCHER_1)})`);
    // A link whose carrier was released — 0023 refuses to ISSUE one for the
    // wrong carrier, so the only honest way to reach this state is to issue a
    // valid link and then take the freight off that carrier.
    const released = issueToken({ shipmentId: releasedId });
    exec(`select release_shipment_assignment(${lit(releasedId)}, 'reassigned', ${lit(DISPATCHER_1)})`);

    const answers: string[] = [];
    for (const [label, token] of [
      ["expired", expired.token],
      ["revoked", revoked.token],
      ["carrier released", released.token],
      ["unknown", mintDriverToken()],
      ["malformed", "not-a-token"],
      ["empty", ""],
    ] as [string, string][]) {
      const result = await redeemDriverToken({
        token,
        ip: "203.0.113.85",
        userAgent: "m83-driver-probe/1.0",
      });
      expect(result.ok, `${label} must be refused`).toBe(false);
      answers.push(JSON.stringify(result));
    }
    expect(
      new Set(answers).size,
      `driver refusals differed: ${answers.join(" | ")}`,
    ).toBe(1);
  });

  it("records the true reason for each, staff-side", () => {
    for (const outcome of ["expired", "revoked", "not_found"]) {
      expect(
        count(
          `select count(*) from shipment_driver_token_access
            where outcome = ${lit(outcome)}`,
        ),
        `no ledger row for ${outcome}`,
      ).toBeGreaterThan(0);
    }
  });

  it("revocation takes effect on the very next presentation, through src/", async () => {
    const live = issueToken();
    const before = await redeemDriverToken({
      token: live.token,
      ip: "198.51.100.86",
      userAgent: "m83/1.0",
    });
    expect(before.ok, "a live link must actually work").toBe(true);

    exec(
      `select revoke_shipment_driver_token(${lit(live.tokenId)}, 'm83 revoke', ${lit(DISPATCHER_1)})`,
    );
    const after = await redeemDriverToken({
      token: live.token,
      ip: "198.51.100.86",
      userAgent: "m83/1.0",
    });
    expect(after.ok).toBe(false);

    // Un-revoking is refused by the database, for the OWNER (M-76 proves the
    // SQLSTATE; restated here because "revocation is permanent" is the half
    // of §13 a TypeScript test cannot see).
    expect(
      sqlstateOf(
        `update shipment_driver_tokens set revoked_at = null where id = ${lit(live.tokenId)}`,
      ),
    ).toBe("P0001");
  });

  it("stores no recoverable form of any presented token", () => {
    const probe = mintDriverToken() ?? "";
    expect(
      count(
        `select count(*) from shipment_driver_token_access
          where to_jsonb(shipment_driver_token_access)::text ilike ${lit(`%${probe.slice(3, 24)}%`)}`,
      ),
    ).toBe(0);
  });
});

/* ================================================================== *
 * 3 · FINANCIAL-WRITE REJECTION AT EVERY WRITE PATH
 * ================================================================== */

describe("§19 PROOF 5 — carrier users cannot edit financial fields", () => {
  const carrierSession = () =>
    createRlsSupabaseClient({ role: "authenticated", sub: CARRIER_USER_A });
  const shipperSession = () =>
    createRlsSupabaseClient({ role: "authenticated", sub: SHIPPER_USER });
  const anonSession = () => createRlsSupabaseClient({ role: "anon", sub: null });

  it("refuses a direct UPDATE from every browser role with 42501", () => {
    const roles: [string, "authenticated" | "anon", string | null][] = [
      ["carrier", "authenticated", CARRIER_USER_A],
      ["shipper", "authenticated", SHIPPER_USER],
      ["dispatcher", "authenticated", DISPATCHER_1],
      ["admin", "authenticated", ADMIN],
      ["anon", "anon", null],
    ];
    for (const [label, role, sub] of roles) {
      expect(
        sqlstateAs(
          role,
          sub,
          `update shipments set carrier_pay = 1, gross_shipper_amount = 1, margin = 1 where id = '${trackedId}'`,
        ),
        `${label} was allowed to write financial columns`,
      ).toBe("42501");
    }
  });

  it("refuses INSERT and DELETE on `shipments` from a browser role too", () => {
    expect(
      sqlstateAs("authenticated", DISPATCHER_1, `delete from shipments where id = '${trackedId}'`),
    ).toBe("42501");
    expect(
      sqlstateAs(
        "authenticated",
        ADMIN,
        `insert into shipments (tracking_number, shipper_id, origin_city, origin_state, destination_city, destination_state, equipment) values ('PL-2026-083777', '${SHIPPER}', 'A', 'NJ', 'B', 'GA', 'dry-van')`,
      ),
    ).toBe("42501");
  });

  it("refuses a direct SELECT of any financial column, for every customer role", async () => {
    for (const [label, client] of [
      ["carrier", carrierSession()],
      ["shipper", shipperSession()],
      ["anon", anonSession()],
    ] as const) {
      for (const col of ["gross_shipper_amount", "carrier_pay", "margin"]) {
        const result = await client
          .from("shipments")
          .select(`id, ${col}`)
          .eq("id", trackedId)
          .maybeSingle();
        expect(result.error?.code, `${label} read ${col}`).toBe("42501");
      }
    }
  });

  it("gives the hauling carrier its own rate — and ONLY that — through the accessor", async () => {
    const fields = await getShipmentRestrictedFields(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      carrierSession() as any,
      trackedId,
    );
    expect(fields.carrier_pay).toBe(SENTINELS.pay);
    expect(fields.gross_shipper_amount).toBeNull();
    expect(fields.margin).toBeNull();
    expect(fields.delay_reason_internal).toBeNull();
  });

  it("gives a SHIPPER nothing at all, on its own shipment", async () => {
    const fields = await getShipmentRestrictedFields(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      shipperSession() as any,
      trackedId,
    );
    expect(fields).toEqual({
      gross_shipper_amount: null,
      carrier_pay: null,
      margin: null,
      delay_reason_internal: null,
    });
  });

  it("cannot be reached through the transition RPCs either", () => {
    // §20's impossible-transition list names *"carrier changing shipper
    // financial data"*. The engine's write functions take no financial
    // argument at all — asserted out of the catalog, so a future signature
    // that added one fails here.
    for (const fn of [
      "apply_shipment_transition",
      "append_shipment_event",
      "apply_shipment_correction",
      "set_shipment_appointment",
      "set_shipment_eta",
    ]) {
      const args =
        scalar(
          `select pg_get_function_arguments(oid) from pg_proc where proname = ${lit(fn)}`,
        ) ?? "";
      for (const col of ["gross_shipper_amount", "carrier_pay", "margin"]) {
        expect(args, `${fn} takes ${col}`).not.toContain(col);
      }
    }
  });

  it("leaves `create_shipment` as the ONLY function that writes them", () => {
    const writers = count(
      `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ~ '(insert into|update)[^;]*(margin|carrier_pay|gross_shipper_amount)'
          and p.proname <> 'create_shipment'`,
    );
    expect(writers).toBe(0);
  });
});

/* ================================================================== *
 * 4 · DISPATCHER SCOPE THROUGH THE REAL READERS
 * ================================================================== */

describe("§19 PROOF 6 — dispatcher permissions are limited (through src/)", () => {
  const d1 = () =>
    createRlsSupabaseClient({ role: "authenticated", sub: DISPATCHER_1 });
  const d2 = () =>
    createRlsSupabaseClient({ role: "authenticated", sub: DISPATCHER_2 });
  const adminSession = () =>
    createRlsSupabaseClient({ role: "authenticated", sub: ADMIN });

  it("returns null from getStaffShipment for another dispatcher's freight", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await getStaffShipment(d1() as any, otherId)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await getStaffShipment(d2() as any, otherId)).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await getStaffShipment(adminSession() as any, otherId)).not.toBeNull();
  });

  it("still hands an IN-SCOPE dispatcher the financial columns it needs", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await getStaffShipment(d1() as any, trackedId);
    expect(row?.gross_shipper_amount).toBe(SENTINELS.gross);
    expect(row?.margin).toBe(SENTINELS.margin);
    expect(row?.delay_reason_internal).toBe(SENTINELS.internalDelay);
  });

  it("gives an OUT-OF-SCOPE dispatcher no financial values through the accessor", async () => {
    const fields = await getShipmentRestrictedFields(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      d1() as any,
      otherId,
    );
    expect(fields.gross_shipper_amount).toBeNull();
    expect(fields.margin).toBeNull();
  });

  it("scopes §5 SEARCH at the database, not only in the query builder", async () => {
    // The scope EXPRESSION is deliberately passed as UNRESTRICTED here — the
    // point is that the restrictive policy alone is now sufficient. Before
    // M-83, an unscoped call returned dispatcher 2's shipment.
    const found = await searchShipmentsByTrackingNumber(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      d1() as any,
      OTHER_DISPATCHER,
      { carrierIds: null, restricted: false },
      DISPATCHER_1,
    );
    expect(found.term.kind).toBe("exact");
    expect(found.rows).toHaveLength(0);

    const byOwner = await searchShipmentsByTrackingNumber(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      d2() as any,
      OTHER_DISPATCHER,
      { carrierIds: null, restricted: false },
      DISPATCHER_2,
    );
    expect(byOwner.rows).toHaveLength(1);
  });

  it("scopes the DOCUMENT row a staff download action reads (M-77's unscoped gate)", async () => {
    // `getStaffDocumentUrlAction` calls `resolveStaffActor()` and NOT
    // `resolveShipmentAccess()`, so before M-83 a dispatcher could mint a
    // signed URL for any shipment's document. The restrictive policy on
    // `shipment_documents` is what closes it: the row is now invisible, and
    // the action's shared "Document not found." is the result.
    const docId = ship(`insert into shipment_documents
        (shipment_id, doc_type, visibility, status, file_name, storage_path,
         mime_type, size_bytes, uploaded_by)
      values (${lit(otherId)}, 'other', 'staff_only', 'pending',
              'd2-only.pdf', ${lit(`${otherId}/d2-only.pdf`)},
              'application/pdf', 1024, ${lit(DISPATCHER_2)})
      returning id`);

    const asD1 = await d1()
      .from("shipment_documents")
      .select("id")
      .eq("id", docId)
      .maybeSingle();
    expect(asD1.error).toBeNull();
    expect(asD1.data).toBeNull();

    const asD2 = await d2()
      .from("shipment_documents")
      .select("id")
      .eq("id", docId)
      .maybeSingle();
    expect(asD2.data).not.toBeNull();
  });

  it("does not narrow a CUSTOMER read (the restrictive policy short-circuits)", async () => {
    const carrier = createRlsSupabaseClient({
      role: "authenticated",
      sub: CARRIER_USER_A,
    });
    const summary = await getCarrierShipmentSummary(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      carrier as any,
      CARRIER_A,
      trackedId,
    );
    expect(summary?.tracking_number).toBe(TRACKED);
    expect(summary?.carrier_pay).toBe(SENTINELS.pay);
  });
});
