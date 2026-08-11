import { beforeAll, describe, expect, it } from "vitest";

import {
  closeBrokerageGate,
  count,
  exec,
  json,
  lit,
  litOrNull,
  openBrokerageGate,
  scalar,
  sqlstateOf,
} from "./helpers/db";
import { buildCreatePayload } from "@/lib/shipments/create";
import {
  evaluateTransition,
  NO_TRANSITION_FACTS,
  type TransitionActor,
  type TransitionFacts,
} from "@/lib/shipments/transitions";
import {
  offeredCarrierActions,
  refuseCarrierAction,
  carrierAction,
} from "@/lib/shipments/carrier-updates";
import {
  DRIVER_TOKEN_FAIL_LIMIT,
  DRIVER_TOKEN_TOTAL_LIMIT,
  DRIVER_TOKEN_WINDOW_MINUTES,
} from "@/lib/shipments/driver-access";
import type { ShipmentStatus } from "@/lib/shipments/types";

/**
 * M-76 — the §13 carrier and driver update path, against a real PostgreSQL 16.
 *
 * WHAT MAKES THIS AN INTEGRATION TEST. Every decision is made by code imported
 * from `src/` — the real §13 action list, the real transition engine, the real
 * token hasher, the real rate-limit constants — and every write goes through
 * the real migration-0023 and -0019 functions. The unit lane mocks the client
 * and can prove none of that; the RLS lane is pure SQL and imports no
 * TypeScript. This is the only lane where the two halves have to agree.
 *
 * It covers the six behaviours the module is accountable for:
 *
 *   carrier updates its own shipment · carrier A cannot touch carrier B's ·
 *   an EXPIRED token is refused · a REVOKED token is refused · the RATE LIMIT
 *   trips · an AUDIT row is written
 *
 * plus §27's carrier flow end to end and the §9/§13 consent lifecycle.
 *
 * ── THE TOKEN HASHER IS THE REAL ONE ─────────────────────────────────────
 *
 * `DRIVER_TOKEN_SECRET` is set below and `hashDriverToken` is imported, so the
 * value this lane stores is the value the server would store. That is the
 * point: 0023's `token_hash` CHECK, its unique index and its lookup all see a
 * digest produced by the shipped code rather than by a fixture.
 */

process.env.DRIVER_TOKEN_SECRET = "m76-integration-secret";
const { hashDriverToken, mintDriverToken, driverTokenExpiry } = await import(
  "@/lib/shipments/driver-token"
);

/** M-76's OWN identities — the lane shares one database (see M-75's note). */
const SHIPPER = "22222222-2222-2222-2222-222222076001";
const CARRIER_A = "11111111-1111-1111-1111-111111076001";
const CARRIER_B = "11111111-1111-1111-1111-111111076002";
const DISPATCHER = "00000000-0000-0000-0000-000000076d01";
const CARRIER_USER_A = "00000000-0000-0000-0000-000000076c01";
const CARRIER_USER_B = "00000000-0000-0000-0000-000000076c02";
const DRIVER_A = "0d0d0d0d-0000-0000-0000-000000076001";
const DRIVER_B = "0d0d0d0d-0000-0000-0000-000000076002";

function jsonLit(value: unknown): string {
  return `${lit(JSON.stringify(value))}::jsonb`;
}

/**
 * DETERMINISTIC tracking numbers, in this module's own `076xxx` band.
 *
 * `generateTrackingNumber()` is random by design (§5), which is right for the
 * product and wrong for a lane that shares one database with four other
 * files: M-75's §5 assertion "a hostile search value finds nothing" runs
 * `ilike 'PL%11'`, and a random number ending in `11` would fail somebody
 * else's test for a reason that has nothing to do with either module. This
 * suite creates ~25 shipments, so that was a one-in-five flake per run — it
 * showed up on the second CI-shaped repeat and is fixed here rather than
 * papered over with a retry.
 *
 * Numbers ending `11` are skipped explicitly, which is the whole point.
 */
let sequence = 20;
function trackingNumber(): string {
  do {
    sequence += 1;
  } while (String(sequence).padStart(3, "0").endsWith("11"));
  const year = new Date().getUTCFullYear();
  return `PL-${year}-076${String(sequence).padStart(3, "0")}`;
}

function createShipment(
  overrides: Record<string, unknown> = {},
): { shipmentId: string; trackingNumber: string } {
  const payload = buildCreatePayload(
    {
      shipper_id: SHIPPER,
      dispatcher_id: DISPATCHER,
      status: "carrier_search",
      origin_city: "Newark",
      origin_state: "NJ",
      destination_city: "Atlanta",
      destination_state: "GA",
      equipment: "dry-van",
      gross_shipper_amount: 2400,
      carrier_pay: 2000,
      ...overrides,
    } as never,
    trackingNumber(),
  );
  const row = json<{ shipment_id: string; tracking_number: string }>(
    `select create_shipment(${jsonLit(payload)}, ${lit(DISPATCHER)}, 'dispatcher')`,
  );
  return { shipmentId: row.shipment_id, trackingNumber: row.tracking_number };
}

function facts(shipmentId: string): TransitionFacts & { status: ShipmentStatus } {
  const row = json<{
    status: ShipmentStatus;
    active_assignment_id: string | null;
    pickup_confirmed_at: string | null;
    delivered_at: string | null;
    approved_pod_document_id: string | null;
  }>(`select shipment_transition_facts(${lit(shipmentId)})`);
  return {
    ...NO_TRANSITION_FACTS,
    status: row.status,
    activeAssignmentId: row.active_assignment_id,
    pickupConfirmedAt: row.pickup_confirmed_at,
    deliveredAt: row.delivered_at,
    approvedPodDocumentId: row.approved_pod_document_id,
  };
}

/**
 * The carrier/driver write path, exactly as the server actions run it: the
 * §13 action list decides, the engine decides, and only then does the RPC
 * write. If either refuses, nothing is written.
 */
function carrierUpdate(args: {
  shipmentId: string;
  actionId: string;
  actor: Extract<TransitionActor, "carrier" | "driver">;
  actorId?: string | null;
  city?: string | null;
  state?: string | null;
}): { ok: boolean; code?: string } {
  const state = facts(args.shipmentId);
  // The delivery timestamp is a fact about THIS request (§20), so the refusal
  // check sees it exactly as the server action does.
  const eventTime = new Date().toISOString();
  const refusal = refuseCarrierAction(
    args.actor,
    args.actionId,
    state.status,
    { ...state, deliveryTimestamp: eventTime },
  );
  if (refusal !== null) return { ok: false, code: refusal };

  const action = carrierAction(args.actionId);
  if (action === null || action.status === null) {
    return { ok: false, code: "unknown_action" };
  }

  const decision = evaluateTransition({
    from: state.status,
    to: action.status,
    actor: args.actor,
    facts: { ...state, deliveryTimestamp: eventTime },
  });
  if (!decision.ok) return { ok: false, code: decision.code };

  exec(
    `select apply_shipment_transition(${lit(args.shipmentId)}, ${lit(state.status)},
       ${lit(action.status)}, ${lit(args.actor)}, ${litOrNull(args.actorId ?? null)},
       'carrier', ${lit(eventTime)}, null, null,
       ${litOrNull(args.city ?? null)}, ${litOrNull(args.state ?? null)},
       null, null, ${jsonLit({ carrier_action: args.actionId })}, null, null, null,
       'status_change')`,
  );
  return { ok: true };
}

function issueToken(args: {
  shipmentId: string;
  carrierId: string;
  driverId?: string | null;
  expiresAt?: string;
}): { token: string; tokenId: string } {
  const token = mintDriverToken() ?? "";
  const hash = hashDriverToken(token) ?? "";
  const row = json<{ token_id: string }>(
    `select issue_shipment_driver_token(${lit(args.shipmentId)}, ${lit(args.carrierId)},
       ${lit(hash)}, ${lit(args.expiresAt ?? driverTokenExpiry())},
       ${litOrNull(args.driverId ?? null)}, 'Test Driver', 'dispatcher',
       ${lit(DISPATCHER)})`,
  );
  return { token, tokenId: row.token_id };
}

function redeem(
  token: string,
  ip: string | null = "198.51.100.10",
): Record<string, unknown> {
  const hash = hashDriverToken(token) ?? hashDriverToken("x".repeat(43)) ?? "";
  return json<Record<string, unknown>>(
    `select redeem_shipment_driver_token(${lit(hash)}, ${litOrNull(ip)}, 'itest',
       ${DRIVER_TOKEN_WINDOW_MINUTES}, ${DRIVER_TOKEN_FAIL_LIMIT},
       ${DRIVER_TOKEN_TOTAL_LIMIT})`,
  );
}

/** Move a shipment to a status through the ENGINE, as a dispatcher. */
function dispatchTo(shipmentId: string, to: ShipmentStatus): void {
  const state = facts(shipmentId);
  const eventTime = new Date().toISOString();
  const decision = evaluateTransition({
    from: state.status,
    to,
    actor: "dispatcher",
    facts: { ...state, deliveryTimestamp: eventTime },
  });
  if (!decision.ok) throw new Error(`setup transition refused: ${decision.message}`);
  exec(
    `select apply_shipment_transition(${lit(shipmentId)}, ${lit(state.status)},
       ${lit(to)}, 'dispatcher', ${lit(DISPATCHER)}, 'staff_only', ${lit(eventTime)},
       null, null, null, null, null, null, '{}'::jsonb, null, null, null,
       'status_change')`,
  );
}

function assignCarrier(shipmentId: string, carrierId: string, driverId: string | null) {
  exec(
    `select assign_shipment_carrier(${lit(shipmentId)}, ${lit(carrierId)},
       ${litOrNull(driverId)}, null, ${lit(DISPATCHER)}, ${lit(DISPATCHER)})`,
  );
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

beforeAll(() => {
  exec(`insert into auth.users (id, email) values
    (${lit(DISPATCHER)}, 'dispatch076@pickloads.test'),
    (${lit(CARRIER_USER_A)}, 'carrier-a076@pickloads.test'),
    (${lit(CARRIER_USER_B)}, 'carrier-b076@pickloads.test')
    on conflict do nothing`);
  exec(`update profiles set role = 'dispatcher', full_name = 'M76 Dispatcher'
          where id = ${lit(DISPATCHER)}`);
  exec(`update profiles set role = 'carrier', full_name = 'M76 Carrier A'
          where id = ${lit(CARRIER_USER_A)}`);
  exec(`update profiles set role = 'carrier', full_name = 'M76 Carrier B'
          where id = ${lit(CARRIER_USER_B)}`);

  exec(`insert into shippers (id, company_name) values
    (${lit(SHIPPER)}, 'M76 Shipper') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, mc_number, active) values
    (${lit(CARRIER_A)}, 'M76 Carrier A', 'MC-076001', true),
    (${lit(CARRIER_B)}, 'M76 Carrier B', 'MC-076002', true)
    on conflict do nothing`);
  exec(`insert into carrier_memberships (carrier_id, profile_id, role) values
    (${lit(CARRIER_A)}, ${lit(CARRIER_USER_A)}, 'owner'),
    (${lit(CARRIER_B)}, ${lit(CARRIER_USER_B)}, 'owner')
    on conflict do nothing`);
  exec(`insert into drivers (id, carrier_id, full_name) values
    (${lit(DRIVER_A)}, ${lit(CARRIER_A)}, 'Driver A'),
    (${lit(DRIVER_B)}, ${lit(CARRIER_B)}, 'Driver B')
    on conflict do nothing`);

  openBrokerageGate();
});

/* ================================================================== *
 * §27's carrier flow, end to end
 * ================================================================== */

describe("§27 carrier flow — view assigned → en route → pickup → delivered", () => {
  it("walks §13's action list from dispatch to delivered, through the engine", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    dispatchTo(shipmentId, "carrier_assigned");

    // §13's list, in §13's order, each one through `refuseCarrierAction` +
    // `evaluateTransition` + the real RPC.
    const walk = [
      "confirm_dispatch",
      "en_route_to_pickup",
      "arrived_at_pickup",
      "loaded",
      "departed_pickup",
      "in_transit",
      "arrived_at_delivery",
      "unloading",
      "delivered",
    ];
    for (const actionId of walk) {
      const result = carrierUpdate({
        shipmentId,
        actionId,
        actor: "carrier",
        actorId: CARRIER_USER_A,
      });
      expect(result, `${actionId}: ${result.code}`).toEqual({ ok: true });
    }

    expect(scalar(`select status from shipments where id = ${lit(shipmentId)}`)).toBe(
      "delivered",
    );
    // Every step wrote its own event, at the `carrier` band — never `public`,
    // because D-6 governs what reaches a five-locale customer timeline.
    expect(
      count(
        `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}
           and source = 'carrier' and visibility = 'carrier'`,
      ),
    ).toBe(walk.length);
  });

  it("REFUSES the two §13 actions that would close the shipment — a carrier does neither", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    dispatchTo(shipmentId, "carrier_assigned");
    dispatchTo(shipmentId, "dispatched");
    dispatchTo(shipmentId, "en_route_to_pickup");

    // `cancelled` and `completed` are not §13 actions at all, so the list
    // refuses them before the engine is consulted.
    for (const id of ["cancel", "complete", "correct_status", "upload_pod"]) {
      expect(carrierUpdate({ shipmentId, actionId: id, actor: "carrier" })).toEqual({
        ok: false,
        code: "unknown_action",
      });
    }
    // And the engine refuses them independently, for a carrier actor.
    for (const to of ["cancelled", "completed", "pod_uploaded"] as const) {
      const state = facts(shipmentId);
      const decision = evaluateTransition({
        from: state.status,
        to,
        actor: "carrier",
        facts: { ...state, cancellationReason: "x", closeoutCompletedAt: "x" },
      });
      expect(decision.ok, `carrier → ${to}`).toBe(false);
    }
  });

  it("offers a CARRIER `confirm_dispatch` and a DRIVER nothing of the sort", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    dispatchTo(shipmentId, "carrier_assigned");
    const state = facts(shipmentId);

    expect(
      offeredCarrierActions("carrier", state.status, state).map((a) => a.id),
    ).toContain("confirm_dispatch");
    expect(
      offeredCarrierActions("driver", state.status, state).map((a) => a.id),
    ).not.toContain("confirm_dispatch");

    // Proved against the REAL write, not only against the list.
    expect(
      carrierUpdate({ shipmentId, actionId: "confirm_dispatch", actor: "driver" }),
    ).toEqual({ ok: false, code: "actor_not_permitted" });
    expect(
      carrierUpdate({
        shipmentId,
        actionId: "confirm_dispatch",
        actor: "carrier",
        actorId: CARRIER_USER_A,
      }),
    ).toEqual({ ok: true });
  });
});

/* ================================================================== *
 * §13 / §19 — carrier A cannot touch carrier B's freight
 * ================================================================== */

describe("§13 — no access to other carrier records", () => {
  it("REFUSES to issue a driver link for a carrier that is not the assigned one", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);

    const token = mintDriverToken() ?? "";
    const hash = hashDriverToken(token) ?? "";
    expect(
      sqlstateOf(
        `select issue_shipment_driver_token(${lit(shipmentId)}, ${lit(CARRIER_B)},
           ${lit(hash)}, ${lit(driverTokenExpiry())})`,
      ),
    ).toBe("PL422");
    // Nothing was written.
    expect(
      count(`select count(*) from shipment_driver_tokens where shipment_id = ${lit(shipmentId)}`),
    ).toBe(0);
  });

  it("REFUSES a driver from another carrier's fleet", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const token = mintDriverToken() ?? "";
    const hash = hashDriverToken(token) ?? "";
    expect(
      sqlstateOf(
        `select issue_shipment_driver_token(${lit(shipmentId)}, ${lit(CARRIER_A)},
           ${lit(hash)}, ${lit(driverTokenExpiry())}, ${lit(DRIVER_B)})`,
      ),
    ).toBe("PL422");
  });

  it("REFUSES a link on a shipment with no carrier at all", () => {
    const { shipmentId } = createShipment();
    const token = mintDriverToken() ?? "";
    const hash = hashDriverToken(token) ?? "";
    expect(
      sqlstateOf(
        `select issue_shipment_driver_token(${lit(shipmentId)}, ${lit(CARRIER_A)},
           ${lit(hash)}, ${lit(driverTokenExpiry())})`,
      ),
    ).toBe("PL422");
  });

  /**
   * §13 across TIME, not only across companies: a link issued to carrier A
   * stops working the moment the freight is reassigned, even though it is
   * neither expired nor revoked.
   */
  it("STOPS WORKING when the carrier is released or replaced", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token } = issueToken({ shipmentId, carrierId: CARRIER_A });
    expect(redeem(token).outcome).toBe("granted");

    exec(
      `select release_shipment_assignment(${lit(shipmentId)}, 'reassigned', ${lit(DISPATCHER)})`,
    );
    assignCarrier(shipmentId, CARRIER_B, DRIVER_B);

    expect(redeem(token).outcome).toBe("carrier_released");
    // The ledger records the truth even though the caller sees one refusal.
    expect(
      count(
        `select count(*) from shipment_driver_token_access
           where shipment_id = ${lit(shipmentId)} and outcome = 'carrier_released'`,
      ),
    ).toBe(1);
  });

  it("scopes a link to ONE shipment — the immutability trigger refuses to move it", () => {
    const { shipmentId } = createShipment();
    const other = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });

    // As the table OWNER, so the refusal can only be the trigger.
    expect(
      sqlstateOf(
        `update shipment_driver_tokens set shipment_id = ${lit(other.shipmentId)} where id = ${lit(tokenId)}`,
      ),
    ).toBe("P0001");
    expect(
      sqlstateOf(
        `update shipment_driver_tokens set carrier_id = ${lit(CARRIER_B)} where id = ${lit(tokenId)}`,
      ),
    ).toBe("P0001");
    expect(
      sqlstateOf(
        `update shipment_driver_tokens set token_hash = ${lit("v1:" + "a".repeat(64))} where id = ${lit(tokenId)}`,
      ),
    ).toBe("P0001");
  });
});

/* ================================================================== *
 * §13 — expiry and revocation
 * ================================================================== */

describe("§13 — expired and revoked links are refused", () => {
  it("REFUSES an expired link, and the refusal is indistinguishable in shape", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token, tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });
    expect(redeem(token).outcome).toBe("granted");

    // Age it out. `expires_at` is writable (only shipment/carrier/hash are
    // frozen) but 0023's `check (expires_at > issued_at)` means BOTH have to
    // move — which is the constraint doing its job: a link cannot be given an
    // expiry that precedes its own issue.
    exec(
      `update shipment_driver_tokens
          set issued_at = now() - interval '2 hours',
              expires_at = now() - interval '1 minute'
        where id = ${lit(tokenId)}`,
    );
    const refusal = redeem(token);
    expect(refusal.outcome).toBe("expired");
    // The payload carries NOTHING about the shipment — no id, no tracking
    // number, no status. That is what makes the four refusals identical to a
    // caller.
    expect(Object.keys(refusal)).toEqual(["outcome"]);
  });

  it("REFUSES a revoked link, and revocation is ONE-WAY", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token, tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });
    expect(redeem(token).outcome).toBe("granted");

    const revoked = json<{ already_revoked: boolean }>(
      `select revoke_shipment_driver_token(${lit(tokenId)}, 'driver went home', ${lit(DISPATCHER)})`,
    );
    expect(revoked.already_revoked).toBe(false);
    expect(redeem(token).outcome).toBe("revoked");

    // Idempotent: pressing the button twice is not an error.
    const again = json<{ already_revoked: boolean }>(
      `select revoke_shipment_driver_token(${lit(tokenId)})`,
    );
    expect(again.already_revoked).toBe(true);

    // And un-revoking is refused for the table OWNER.
    expect(
      sqlstateOf(
        `update shipment_driver_tokens set revoked_at = null where id = ${lit(tokenId)}`,
      ),
    ).toBe("P0001");
    expect(redeem(token).outcome).toBe("revoked");
  });

  it("REVOKED outranks EXPIRED — SQL agrees with `driverTokenState`", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token, tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });
    exec(
      `update shipment_driver_tokens
          set issued_at = now() - interval '3 hours',
              revoked_at = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'
        where id = ${lit(tokenId)}`,
    );
    expect(redeem(token).outcome).toBe("revoked");
  });

  it("REFUSES an unknown token and records it as the enumeration case", () => {
    const before = count(
      `select count(*) from shipment_driver_token_access where outcome = 'not_found'`,
    );
    expect(redeem(mintDriverToken() ?? "", "203.0.113.99").outcome).toBe("not_found");
    expect(
      count(
        `select count(*) from shipment_driver_token_access where outcome = 'not_found'`,
      ),
    ).toBe(before + 1);
    // The unmatched row carries NO shipment id — that is what makes the
    // enumeration feed countable.
    expect(
      count(
        `select count(*) from shipment_driver_token_access
           where outcome = 'not_found' and shipment_id is not null`,
      ),
    ).toBe(0);
  });

  it("refuses a link that expires in the past at ISSUE time", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const hash = hashDriverToken(mintDriverToken() ?? "") ?? "";
    expect(
      sqlstateOf(
        `select issue_shipment_driver_token(${lit(shipmentId)}, ${lit(CARRIER_A)},
           ${lit(hash)}, ${lit(new Date(Date.now() - 60_000).toISOString())})`,
      ),
    ).toBe("PL422");
  });
});

/* ================================================================== *
 * §13 — the rate limit
 * ================================================================== */

describe("§13 — the rate limit trips", () => {
  it("refuses everything from an IP after DRIVER_TOKEN_FAIL_LIMIT failures", () => {
    const ip = "192.0.2.77";
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token } = issueToken({ shipmentId, carrierId: CARRIER_A });

    // A working link works first, so the refusal below is the LIMIT and not
    // the token.
    expect(redeem(token, ip).outcome).toBe("granted");

    for (let i = 0; i < DRIVER_TOKEN_FAIL_LIMIT; i++) {
      const outcome = redeem(mintDriverToken() ?? "", ip).outcome;
      expect(["not_found", "rate_limited"]).toContain(outcome);
    }

    // The budget is spent — even the VALID token is now refused.
    expect(redeem(token, ip).outcome).toBe("rate_limited");

    // The refusal is itself journalled (§13 "audit logged"), so an operator
    // can see the burst rather than a gap where it was.
    expect(
      count(
        `select count(*) from shipment_driver_token_access
           where ip = ${lit(ip)} and outcome = 'rate_limited'`,
      ),
    ).toBeGreaterThan(0);
  });

  it("does NOT punish a different network — the limit is per IP", () => {
    // The non-vacuity control for the test above: if the limiter were global,
    // this would fail.
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token } = issueToken({ shipmentId, carrierId: CARRIER_A });
    expect(redeem(token, "192.0.2.200").outcome).toBe("granted");
  });

  it("counts the WINDOW, not all history — an old burst does not lock anybody out", () => {
    const ip = "192.0.2.88";
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token } = issueToken({ shipmentId, carrierId: CARRIER_A });

    // A burst that happened an HOUR ago, written straight into the ledger —
    // INSERT is permitted (only UPDATE and DELETE are refused), so this is
    // the honest way to produce history the window should ignore.
    for (let i = 0; i < DRIVER_TOKEN_FAIL_LIMIT * 3; i++) {
      exec(
        `insert into shipment_driver_token_access (outcome, ip, user_agent, accessed_at)
           values ('not_found', ${lit(ip)}, 'itest', now() - interval '1 hour')`,
      );
    }
    // Far more failures than the limit, all outside the ten-minute window.
    expect(
      count(
        `select count(*) from shipment_driver_token_access
           where ip = ${lit(ip)} and outcome <> 'granted'`,
      ),
    ).toBeGreaterThan(DRIVER_TOKEN_FAIL_LIMIT);
    expect(redeem(token, ip).outcome).toBe("granted");

    // The non-vacuity control: the SAME rows inside a wide enough window DO
    // trip the limit, so the pass above is the window and not luck.
    const wide = json<{ outcome: string }>(
      `select redeem_shipment_driver_token(${lit(hashDriverToken(token) ?? "")},
         ${lit(ip)}, 'itest', 120, ${DRIVER_TOKEN_FAIL_LIMIT}, ${DRIVER_TOKEN_TOTAL_LIMIT})`,
    );
    expect(wide.outcome).toBe("rate_limited");
  });

  it("bounds a flood of SUCCESSFUL presentations too", () => {
    const ip = "192.0.2.150";
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token } = issueToken({ shipmentId, carrierId: CARRIER_A });
    let sawLimit = false;
    for (let i = 0; i < DRIVER_TOKEN_TOTAL_LIMIT + 2; i++) {
      if (redeem(token, ip).outcome === "rate_limited") {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });
});

/* ================================================================== *
 * §13 — audit logging
 * ================================================================== */

describe("§13 — every presentation is audit logged", () => {
  it("writes ONE ledger row per presentation, granted or not", () => {
    const ip = "198.51.100.55";
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token, tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });

    const before = count(
      `select count(*) from shipment_driver_token_access where ip = ${lit(ip)}`,
    );
    redeem(token, ip);
    redeem(token, ip);
    expect(
      count(`select count(*) from shipment_driver_token_access where ip = ${lit(ip)}`),
    ).toBe(before + 2);

    const row = json<{ token_id: string; outcome: string; user_agent: string }>(
      `select to_jsonb(t) from (
         select token_id, outcome, user_agent from shipment_driver_token_access
          where ip = ${lit(ip)} order by accessed_at desc limit 1) t`,
    );
    expect(row.token_id).toBe(tokenId);
    expect(row.outcome).toBe("granted");
    expect(row.user_agent).toBe("itest");
  });

  it("bumps `use_count` and `last_used_at` on a grant and on nothing else", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token, tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });
    redeem(token, "198.51.100.60");
    redeem(token, "198.51.100.60");
    expect(
      count(`select use_count from shipment_driver_tokens where id = ${lit(tokenId)}`),
    ).toBe(2);

    exec(
      `update shipment_driver_tokens set revoked_at = now() where id = ${lit(tokenId)}`,
    );
    redeem(token, "198.51.100.60");
    expect(
      count(`select use_count from shipment_driver_tokens where id = ${lit(tokenId)}`),
    ).toBe(2);
  });

  it("is APPEND-ONLY, for the table OWNER", () => {
    expect(
      sqlstateOf(`update shipment_driver_token_access set outcome = 'granted'`),
    ).toBe("P0001");
    expect(sqlstateOf(`delete from shipment_driver_token_access`)).toBe("P0001");
  });

  it("stores NO form of the presented token — there is no column for one", () => {
    const columns = scalar(
      `select string_agg(column_name, ',' order by ordinal_position)
         from information_schema.columns
        where table_schema = 'public' and table_name = 'shipment_driver_token_access'`,
    );
    expect(columns).toBe(
      "id,token_id,shipment_id,outcome,detail,ip,user_agent,accessed_at",
    );
  });

  it("puts the issue and the revocation on the shipment TIMELINE too", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });
    exec(`select revoke_shipment_driver_token(${lit(tokenId)}, 'done', ${lit(DISPATCHER)})`);

    // Both at the `carrier` band: the carrier may see that a link on their
    // freight exists and was killed; the shipper is not a party to it.
    expect(
      count(
        `select count(*) from shipment_events
           where shipment_id = ${lit(shipmentId)} and event_type = 'internal_note'
             and visibility = 'carrier'
             and metadata ->> 'driver_token_id' = ${lit(tokenId)}`,
      ),
    ).toBe(2);
    // And NOT at the public or shipper band.
    expect(
      count(
        `select count(*) from shipment_events
           where shipment_id = ${lit(shipmentId)}
             and metadata ->> 'driver_token_id' = ${lit(tokenId)}
             and visibility in ('public','shipper')`,
      ),
    ).toBe(0);
  });
});

/* ================================================================== *
 * §9/§13 — consent
 * ================================================================== */

describe("§9/§13 — driver consent", () => {
  it("starts PENDING — never granted by default", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token, tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });
    expect(
      scalar(`select consent_status from shipment_driver_tokens where id = ${lit(tokenId)}`),
    ).toBe("pending");
    expect(
      scalar(`select consent_at from shipment_driver_tokens where id = ${lit(tokenId)}`),
    ).toBeNull();
    expect(redeem(token).consent_status).toBe("pending");
  });

  it("records GRANTED and DENIED as first-class, reversible choices", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token, tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });
    const hash = hashDriverToken(token) ?? "";

    let result = json<{ outcome: string; consent_status: string; changed: boolean }>(
      `select set_driver_token_consent(${lit(hash)}, true, '198.51.100.7', 'itest')`,
    );
    expect(result).toMatchObject({ outcome: "granted", consent_status: "granted", changed: true });
    expect(
      scalar(`select consent_at from shipment_driver_tokens where id = ${lit(tokenId)}`),
    ).not.toBeNull();

    // Re-granting is a no-op rather than a second event.
    result = json(`select set_driver_token_consent(${lit(hash)}, true)`);
    expect(result.changed).toBe(false);

    // And the driver can take it back.
    result = json(`select set_driver_token_consent(${lit(hash)}, false)`);
    expect(result).toMatchObject({ consent_status: "denied", changed: true });
    expect(redeem(token).consent_status).toBe("denied");
  });

  it("writes a timeline event for the decision, at the `carrier` band", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token } = issueToken({ shipmentId, carrierId: CARRIER_A });
    exec(`select set_driver_token_consent(${lit(hashDriverToken(token) ?? "")}, true)`);
    expect(
      count(
        `select count(*) from shipment_events
           where shipment_id = ${lit(shipmentId)} and source = 'driver'
             and visibility = 'carrier'
             and metadata ->> 'consent_status' = 'granted'`,
      ),
    ).toBe(1);
  });

  it("REFUSES to record consent against an expired or revoked link", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    const { token, tokenId } = issueToken({ shipmentId, carrierId: CARRIER_A });
    const hash = hashDriverToken(token) ?? "";
    exec(`select revoke_shipment_driver_token(${lit(tokenId)})`);
    expect(
      json<{ outcome: string }>(`select set_driver_token_consent(${lit(hash)}, true)`)
        .outcome,
    ).toBe("revoked");
    expect(
      scalar(`select consent_status from shipment_driver_tokens where id = ${lit(tokenId)}`),
    ).toBe("pending");
  });

  it("REFUSES an unknown token without saying so differently", () => {
    expect(
      json<{ outcome: string }>(
        `select set_driver_token_consent(${lit(hashDriverToken(mintDriverToken() ?? "") ?? "")}, true)`,
      ).outcome,
    ).toBe("not_found");
  });
});

/* ================================================================== *
 * The grant payload — §13's "no financial data", proved in SQL
 * ================================================================== */

describe("§13 — no financial data leaves the database", () => {
  it("names NO financial column in the redeem payload, on a shipment that HAS them", () => {
    const { shipmentId } = createShipment({
      gross_shipper_amount: 9999,
      carrier_pay: 8888,
    });
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    // The shipment really does carry money — the non-vacuity control.
    expect(
      count(`select gross_shipper_amount from shipments where id = ${lit(shipmentId)}`),
    ).toBe(9999);

    const { token } = issueToken({ shipmentId, carrierId: CARRIER_A });
    const payload = redeem(token);
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "gross_shipper_amount",
      "carrier_pay",
      "margin",
      "delay_reason_internal",
      "public_access_hash",
      "shipper_id",
      "9999",
      "8888",
    ]) {
      expect(serialized, `payload leaks ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ================================================================== *
 * §2 — the brokerage gate is INSERT-only, so in-flight freight stays operable
 * ================================================================== */

describe("§2 — the gate does not strand in-flight freight", () => {
  it("lets a carrier keep updating a shipment after brokerage is switched off", () => {
    const { shipmentId } = createShipment();
    assignCarrier(shipmentId, CARRIER_A, DRIVER_A);
    dispatchTo(shipmentId, "carrier_assigned");

    closeBrokerageGate();
    try {
      expect(
        carrierUpdate({
          shipmentId,
          actionId: "confirm_dispatch",
          actor: "carrier",
          actorId: CARRIER_USER_A,
        }),
      ).toEqual({ ok: true });
      // And a driver link still works — refusing them would strand real
      // freight, which is M-71's stated reason for the gate being INSERT-only.
      const { token } = issueToken({ shipmentId, carrierId: CARRIER_A });
      expect(redeem(token, "198.51.100.201").outcome).toBe("granted");
    } finally {
      openBrokerageGate();
    }
  });
});
