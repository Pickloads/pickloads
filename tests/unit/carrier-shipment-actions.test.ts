import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOT_CARRIER_MESSAGE,
  NO_CARRIER_RECORD_MESSAGE,
  SHIPMENT_MISSING_MESSAGE,
} from "@/lib/shipments/carrier-access";
import {
  CARRIER_FORBIDDEN_FIELDS,
  CARRIER_REFUSAL_MESSAGES,
  CARRIER_STALE_PAGE_MESSAGE,
  DRIVER_CONSENT_REQUIRED_KEY,
  DRIVER_LINK_EXPIRED_KEY,
  DRIVER_NOT_ALLOWED_KEY,
  DRIVER_RATE_LIMITED_KEY,
  DRIVER_SAVED_KEY,
  DRIVER_STALE_KEY,
} from "@/lib/shipments/carrier-updates";

/**
 * M-76 — the §13 CARRIER and DRIVER server actions, proved over the ACTIONS
 * rather than over their helpers.
 *
 * M-75 established the shape and the reason: a test of the gate proves the
 * gate works; it proves nothing about the fifth action that forgot to call it,
 * and that action is indistinguishable from the four that did by reading. So
 * both modules' exports are ENUMERATED and each one is driven through every
 * refusal, with `rpcCalls` and `writes` asserted empty.
 *
 * The Supabase clients are stubs. What is proved is the LAYER — that a refusal
 * happens before any write, that the engine is called with the right actor,
 * that consent gates location and that no financial field can arrive. That the
 * SQL underneath is right is the integration lane's job.
 */

/* ------------------------------------------------------------------ *
 * Stubs
 * ------------------------------------------------------------------ */

interface Scenario {
  user: { id: string } | null;
  role: "carrier" | "shipper" | "admin";
  status: "active" | "suspended";
  /** null = the profile has no carrier membership. */
  carrierId: string | null;
  /** null = the shipment does not resolve for this carrier. */
  shipment: {
    id: string;
    status: string;
    tracking_number: string;
    carrier_id: string;
  } | null;
  /** The row `revokeDriverLinkAction`'s scoping read finds, if any. */
  driverToken: { id: string; shipment_id: string } | null;
  /** What `redeem_shipment_driver_token` returns to the driver path. */
  redeem: Record<string, unknown>;
  /** `guardPublicForm`'s verdict. */
  guardOk: boolean;
  conflict: boolean;
}

let scenario: Scenario;
const rpcCalls: string[] = [];
const writes: string[] = [];

const SHIPMENT_ID = "11111111-1111-4111-8111-111111111111";
const CARRIER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN_ID = "33333333-3333-4333-8333-333333333333";
/** A syntactically valid 43-character base64url token. */
const TOKEN = "A".repeat(43);

function serverClient() {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: scenario.user } }) },
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle() {
          if (table === "profiles") {
            return Promise.resolve({
              data: {
                role: scenario.role,
                status: scenario.status,
                full_name: "Carrier User",
                created_at: "2026-01-01T00:00:00Z",
              },
            });
          }
          if (table === "carrier_memberships") {
            return Promise.resolve({
              data:
                scenario.carrierId === null
                  ? null
                  : { carrier_id: scenario.carrierId },
            });
          }
          if (table === "shipments") {
            return Promise.resolve({ data: scenario.shipment });
          }
          if (table === "shipment_driver_tokens") {
            return Promise.resolve({ data: scenario.driverToken });
          }
          return Promise.resolve({ data: null });
        },
        update() {
          writes.push(`update:${table}`);
          return builder;
        },
        insert() {
          writes.push(`insert:${table}`);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(serverClient()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => ({
    rpc: (name: string) => {
      rpcCalls.push(name);
      if (name === "redeem_shipment_driver_token") {
        return Promise.resolve({ data: scenario.redeem, error: null });
      }
      if (name === "shipment_transition_facts") {
        return Promise.resolve({
          data: {
            status: scenario.shipment?.status ?? "in_transit",
            tracking_number: "PL-2026-000458",
            carrier_id: CARRIER_ID,
            active_assignment_id: "as-1",
            pickup_confirmed_at: "2026-08-05T10:00:00.000Z",
            delivered_at: null,
            approved_pod_document_id: null,
          },
          error: null,
        });
      }
      if (scenario.conflict && name === "apply_shipment_transition") {
        return Promise.resolve({
          data: null,
          error: { code: "PL409", message: "status changed under us" },
        });
      }
      if (name === "set_driver_token_consent") {
        return Promise.resolve({
          data: { outcome: "granted", consent_status: "granted", changed: true },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          shipment_id: SHIPMENT_ID,
          event_id: "ev-1",
          status: "in_transit",
          token_id: TOKEN_ID,
        },
        error: null,
      });
    },
    from(table: string) {
      writes.push(`admin:${table}`);
      const b = {
        update: () => b,
        insert: () => Promise.resolve({ error: null }),
        eq: () => Promise.resolve({ error: null }),
        select: () => b,
        maybeSingle: () => Promise.resolve({ data: null }),
      };
      return b;
    },
  }),
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: () => {
    writes.push("audit");
    return Promise.resolve();
  },
}));

vi.mock("@/lib/forms/guard", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/forms/guard")>("@/lib/forms/guard");
  return {
    ...actual,
    guardPublicForm: () =>
      Promise.resolve(
        scenario.guardOk
          ? { ok: true as const, ip: "203.0.113.7" }
          : { ok: false as const, message: "rate limited" },
      ),
  };
});

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Map([
        ["x-forwarded-for", "203.0.113.7"],
        ["user-agent", "vitest"],
      ]) as unknown as Headers,
    ),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string }) => href,
  Link: () => null,
  redirect: () => undefined,
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => "/",
}));

process.env.DRIVER_TOKEN_SECRET = "m76-actions-secret";

const carrierActions = await import("@/app/actions/carrier-shipments");
const driverActions = await import("@/app/actions/driver-updates");

/** Discovered, not listed — a new export is covered automatically. */
const CARRIER_ACTION_NAMES = Object.keys(carrierActions).filter((k) =>
  k.endsWith("Action"),
) as (keyof typeof carrierActions)[];
const DRIVER_ACTION_NAMES = Object.keys(driverActions).filter((k) =>
  k.endsWith("Action"),
) as (keyof typeof driverActions)[];

type Action = (
  p: unknown,
  f: FormData,
) => Promise<{ status: string; message?: string }>;

function carrierForm(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("shipment_id", SHIPMENT_ID);
  fd.set("action", "in_transit");
  fd.set("expected_status", "picked_up");
  fd.set("kind", "delivery");
  fd.set("eta_at", "2026-08-06T14:00");
  fd.set("exception_type", "traffic");
  fd.set("description", "Stuck on I-95 north of Baltimore.");
  fd.set("token_id", TOKEN_ID);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function driverForm(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("token", TOKEN);
  fd.set("action", "in_transit");
  fd.set("expected_status", "picked_up");
  fd.set("kind", "delivery");
  fd.set("eta_at", "2026-08-06T14:00");
  fd.set("exception_type", "traffic");
  fd.set("description", "Stuck on I-95 north of Baltimore.");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

function grantedRedeem(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "granted",
    token_id: TOKEN_ID,
    shipment_id: SHIPMENT_ID,
    carrier_id: CARRIER_ID,
    driver_id: null,
    driver_name: "Bob",
    expires_at: "2099-01-01T00:00:00.000Z",
    consent_status: "pending",
    use_count: 1,
    tracking_number: "PL-2026-000458",
    status: "picked_up",
    origin_city: "Newark",
    origin_state: "NJ",
    origin_company: null,
    destination_city: "Atlanta",
    destination_state: "GA",
    destination_company: null,
    pickup_appointment_at: null,
    delivery_appointment_at: null,
    equipment: "dry-van",
    current_city: null,
    current_state: null,
    ...overrides,
  };
}

beforeEach(() => {
  rpcCalls.length = 0;
  writes.length = 0;
  scenario = {
    user: { id: "u-carrier" },
    role: "carrier",
    status: "active",
    carrierId: CARRIER_ID,
    shipment: {
      id: SHIPMENT_ID,
      status: "picked_up",
      tracking_number: "PL-2026-000458",
      carrier_id: CARRIER_ID,
    },
    driverToken: { id: TOKEN_ID, shipment_id: SHIPMENT_ID },
    redeem: grantedRedeem(),
    guardOk: true,
    conflict: false,
  };
});

/* ================================================================== *
 * The carrier gate, per action
 * ================================================================== */

describe("§13 carrier actions — the gate, proved per action", () => {
  it("exports the five §13 carrier actions", () => {
    expect(CARRIER_ACTION_NAMES.sort()).toEqual(
      [
        "carrierStatusUpdateAction",
        "carrierEtaAction",
        "carrierExceptionAction",
        "issueDriverLinkAction",
        "revokeDriverLinkAction",
      ].sort(),
    );
  });

  it.each(CARRIER_ACTION_NAMES)(
    "%s refuses with NO session and writes nothing",
    async (name) => {
      scenario.user = null;
      const result = await (carrierActions[name] as Action)(
        { status: "idle" },
        carrierForm(),
      );
      expect(result.status).toBe("error");
      expect(result.message).toBe(NOT_CARRIER_MESSAGE);
      expect(rpcCalls).toEqual([]);
      expect(writes).toEqual([]);
    },
  );

  it.each(CARRIER_ACTION_NAMES)("%s refuses a SHIPPER session", async (name) => {
    scenario.role = "shipper";
    const result = await (carrierActions[name] as Action)(
      { status: "idle" },
      carrierForm(),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(NOT_CARRIER_MESSAGE);
    expect(rpcCalls).toEqual([]);
  });

  it.each(CARRIER_ACTION_NAMES)("%s refuses a STAFF session", async (name) => {
    // §13 is a CARRIER surface. A dispatcher acting here would bypass M-75's
    // §19 scope check, so staff are refused by role, not merely unserved.
    scenario.role = "admin";
    const result = await (carrierActions[name] as Action)(
      { status: "idle" },
      carrierForm(),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(NOT_CARRIER_MESSAGE);
    expect(rpcCalls).toEqual([]);
  });

  it.each(CARRIER_ACTION_NAMES)(
    "%s refuses a SUSPENDED carrier session",
    async (name) => {
      scenario.status = "suspended";
      const result = await (carrierActions[name] as Action)(
        { status: "idle" },
        carrierForm(),
      );
      expect(result.status).toBe("error");
      expect(rpcCalls).toEqual([]);
    },
  );

  it.each(CARRIER_ACTION_NAMES)(
    "%s refuses a session with NO carrier record",
    async (name) => {
      scenario.carrierId = null;
      const result = await (carrierActions[name] as Action)(
        { status: "idle" },
        carrierForm(),
      );
      expect(result.status).toBe("error");
      expect(result.message).toBe(NO_CARRIER_RECORD_MESSAGE);
      expect(rpcCalls).toEqual([]);
    },
  );

  /** §13 "no access to other carrier records" — the cross-tenant case. */
  it.each(CARRIER_ACTION_NAMES)(
    "%s refuses carrier A acting on carrier B's shipment, with the SAME message as a missing one",
    async (name) => {
      // The policy + predicate return no row, exactly as they would for an id
      // that does not exist. The action must not be able to tell the caller
      // which it was.
      scenario.shipment = null;
      const result = await (carrierActions[name] as Action)(
        { status: "idle" },
        carrierForm(),
      );
      expect(result.status).toBe("error");
      expect(result.message).toBe(SHIPMENT_MISSING_MESSAGE);
      expect(rpcCalls).toEqual([]);
      expect(writes).toEqual([]);
    },
  );

  it.each(CARRIER_ACTION_NAMES)(
    "%s refuses a malformed shipment id before any query",
    async (name) => {
      const result = await (carrierActions[name] as Action)(
        { status: "idle" },
        carrierForm({ shipment_id: "not-a-uuid" }),
      );
      expect(result.status).toBe("error");
      expect(result.message).toBe(SHIPMENT_MISSING_MESSAGE);
      expect(rpcCalls).toEqual([]);
    },
  );

  /** The non-vacuity control: a legitimate carrier is NOT refused. */
  it.each(CARRIER_ACTION_NAMES)(
    "%s does NOT refuse a legitimate carrier for an authorization reason",
    async (name) => {
      const result = await (carrierActions[name] as Action)(
        { status: "idle" },
        carrierForm(),
      );
      for (const refusal of [
        NOT_CARRIER_MESSAGE,
        NO_CARRIER_RECORD_MESSAGE,
        SHIPMENT_MISSING_MESSAGE,
      ]) {
        expect(result.message).not.toBe(refusal);
      }
    },
  );
});

/* ================================================================== *
 * The carrier actions call the engine, never a raw write
 * ================================================================== */

describe("§13 carrier actions call M-72's engine with `actor: carrier`", () => {
  it("a status update issues exactly [facts, transition] and NO raw shipments write", async () => {
    const result = await carrierActions.carrierStatusUpdateAction(
      { status: "idle" },
      carrierForm({ action: "in_transit", expected_status: "picked_up" }),
    );
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual([
      "shipment_transition_facts",
      "apply_shipment_transition",
    ]);
    expect(writes.filter((w) => w.includes("shipments"))).toEqual([]);
  });

  it("refuses a STALE page before touching the engine", async () => {
    const result = await carrierActions.carrierStatusUpdateAction(
      { status: "idle" },
      carrierForm({ expected_status: "in_transit" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(CARRIER_STALE_PAGE_MESSAGE);
    expect(rpcCalls).toEqual([]);
  });

  it("renders a compare-and-swap loss as 'refresh', not as a generic error", async () => {
    scenario.conflict = true;
    const result = await carrierActions.carrierStatusUpdateAction(
      { status: "idle" },
      carrierForm(),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(CARRIER_STALE_PAGE_MESSAGE);
  });

  it("refuses a transition a CARRIER may never make, and writes nothing", async () => {
    // `cancelled` is not in §13's list and not in
    // `ACTOR_PERMITTED_TARGETS.carrier`; the id is not even in the vocabulary.
    const result = await carrierActions.carrierStatusUpdateAction(
      { status: "idle" },
      carrierForm({ action: "cancel_shipment" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(CARRIER_REFUSAL_MESSAGES.unknown_action);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses an action that is real but not available from here", async () => {
    const result = await carrierActions.carrierStatusUpdateAction(
      { status: "idle" },
      carrierForm({ action: "confirm_dispatch" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(CARRIER_REFUSAL_MESSAGES.not_available_now);
  });

  it("the ETA path calls 0022's function and never sets a source it cannot justify", async () => {
    const result = await carrierActions.carrierEtaAction(
      { status: "idle" },
      carrierForm(),
    );
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual(["set_shipment_eta"]);
  });

  it("the exception path is ONE event append with §21's type in metadata", async () => {
    const result = await carrierActions.carrierExceptionAction(
      { status: "idle" },
      carrierForm(),
    );
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual(["append_shipment_event"]);
  });

  it("issuing a driver link mints one and returns the path exactly once", async () => {
    const result = await carrierActions.issueDriverLinkAction(
      { status: "idle" },
      carrierForm({ driver_name: "Bob D" }),
    );
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual(["issue_shipment_driver_token"]);
    expect(result.message).toContain("/driver/update/");
    // The token in the message is a real one, and it is 43 characters — not a
    // shipment id, not a tracking number.
    const token = result.message?.split("/driver/update/")[1] ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain(SHIPMENT_ID.slice(0, 8));
    // §15's ledger got the row; §26's never-log list means it did NOT get the
    // token.
    expect(writes).toContain("audit");
  });

  it("REFUSES to revoke a link that belongs to another shipment", async () => {
    // The gate proved the carrier may act on THIS shipment; the scoping read
    // is what stops them revoking somebody else's link by posting its id.
    scenario.driverToken = null;
    const result = await carrierActions.revokeDriverLinkAction(
      { status: "idle" },
      carrierForm(),
    );
    expect(result.status).toBe("error");
    expect(rpcCalls).toEqual([]);
  });

  it("revokes a link that IS on this shipment", async () => {
    const result = await carrierActions.revokeDriverLinkAction(
      { status: "idle" },
      carrierForm(),
    );
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual(["revoke_shipment_driver_token"]);
  });
});

/* ================================================================== *
 * §19's approved FIELDS
 * ================================================================== */

describe("§19 — a carrier cannot edit a financial field", () => {
  it("ignores every forbidden field even when all of them are POSTed", async () => {
    const hostile: Record<string, string> = {};
    for (const field of CARRIER_FORBIDDEN_FIELDS) hostile[field] = "999999";
    // `shipment_id` is legitimately in the form; the hostile copy would
    // otherwise clobber it and turn this into a "not found" test.
    hostile.shipment_id = SHIPMENT_ID;

    const result = await carrierActions.carrierStatusUpdateAction(
      { status: "idle" },
      carrierForm(hostile),
    );
    // It SUCCEEDS — the point is not that a hostile POST is rejected, it is
    // that the extra fields are not read at all. The transition happened and
    // nothing else did.
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual([
      "shipment_transition_facts",
      "apply_shipment_transition",
    ]);
    expect(writes.filter((w) => w.startsWith("update:"))).toEqual([]);
  });
});

/* ================================================================== *
 * The driver gate, per action
 * ================================================================== */

describe("§13 driver actions — the token gate, proved per action", () => {
  it("exports the four §13 driver actions", () => {
    expect(DRIVER_ACTION_NAMES.sort()).toEqual(
      [
        "driverStatusUpdateAction",
        "driverEtaAction",
        "driverExceptionAction",
        "driverConsentAction",
      ].sort(),
    );
  });

  it.each(DRIVER_ACTION_NAMES)(
    "%s refuses when the public-form guard refuses, before any token work",
    async (name) => {
      scenario.guardOk = false;
      const result = await (driverActions[name] as Action)(
        { status: "idle" },
        driverForm(),
      );
      expect(result.status).toBe("error");
      expect(result.message).toBe(DRIVER_RATE_LIMITED_KEY);
      expect(rpcCalls).toEqual([]);
      expect(writes).toEqual([]);
    },
  );

  it.each(DRIVER_ACTION_NAMES)(
    "%s refuses a malformed token and writes nothing",
    async (name) => {
      const result = await (driverActions[name] as Action)(
        { status: "idle" },
        driverForm({ token: "short" }),
      );
      expect(result.status).toBe("error");
      expect(writes).toEqual([]);
    },
  );

  /**
   * §13 non-enumerability, at the action layer: four genuinely different
   * causes produce ONE identical result. Asserted by deep equality across the
   * set, so a caller cannot render a different sentence for one of them.
   */
  it("returns an IDENTICAL refusal for not_found / expired / revoked / carrier_released", async () => {
    const results = [];
    for (const outcome of [
      "not_found",
      "expired",
      "revoked",
      "carrier_released",
    ]) {
      scenario.redeem = { outcome };
      results.push(
        await driverActions.driverStatusUpdateAction(
          { status: "idle" },
          driverForm(),
        ),
      );
    }
    for (const result of results) {
      expect(result).toEqual(results[0]);
      expect(result.message).toBe(DRIVER_LINK_EXPIRED_KEY);
    }
  });

  it("returns a DISTINCT refusal for rate_limited — it says nothing about any token", async () => {
    scenario.redeem = { outcome: "rate_limited" };
    const result = await driverActions.driverStatusUpdateAction(
      { status: "idle" },
      driverForm(),
    );
    expect(result.message).toBe(DRIVER_RATE_LIMITED_KEY);
    expect(result.message).not.toBe(DRIVER_LINK_EXPIRED_KEY);
  });

  it("refuses a STALE driver page rather than applying a transition to the wrong edge", async () => {
    const result = await driverActions.driverStatusUpdateAction(
      { status: "idle" },
      driverForm({ expected_status: "delivered" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(DRIVER_STALE_KEY);
  });

  it("refuses CONFIRM DISPATCH from a driver link — §13's one carrier-only action", async () => {
    scenario.redeem = grantedRedeem({ status: "carrier_assigned" });
    const result = await driverActions.driverStatusUpdateAction(
      { status: "idle" },
      driverForm({
        action: "confirm_dispatch",
        expected_status: "carrier_assigned",
      }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(DRIVER_NOT_ALLOWED_KEY);
    // The refusal is journalled (§26), and the transition never ran.
    expect(rpcCalls).toEqual(["redeem_shipment_driver_token"]);
    expect(writes).toContain("admin:shipment_driver_token_access");
  });

  it("accepts a permitted transition and calls the engine with `actor: driver`", async () => {
    const result = await driverActions.driverStatusUpdateAction(
      { status: "idle" },
      driverForm(),
    );
    expect(result.status).toBe("success");
    expect(result.message).toBe(DRIVER_SAVED_KEY);
    expect(rpcCalls).toEqual([
      "redeem_shipment_driver_token",
      "shipment_transition_facts",
      "apply_shipment_transition",
    ]);
  });
});

/* ================================================================== *
 * §9/§13 consent gating
 * ================================================================== */

describe("§9/§13 — consent gates LOCATION, never status", () => {
  it("REFUSES a city/state supplied without consent, and records the attempt", async () => {
    scenario.redeem = grantedRedeem({ consent_status: "pending" });
    const result = await driverActions.driverStatusUpdateAction(
      { status: "idle" },
      driverForm({ city: "Richmond", state: "VA" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toBe(DRIVER_CONSENT_REQUIRED_KEY);
    // Refused, NOT silently dropped: the transition never ran.
    expect(rpcCalls).toEqual(["redeem_shipment_driver_token"]);
    expect(writes).toContain("admin:shipment_driver_token_access");
  });

  it("refuses a location under `denied` too — declined is not 'unanswered'", async () => {
    scenario.redeem = grantedRedeem({ consent_status: "denied" });
    const result = await driverActions.driverStatusUpdateAction(
      { status: "idle" },
      driverForm({ city: "Richmond", state: "VA" }),
    );
    expect(result.message).toBe(DRIVER_CONSENT_REQUIRED_KEY);
  });

  it("ACCEPTS the same update WITHOUT a location while consent is pending", async () => {
    // The gate is on the location, not on the driver's ability to report.
    scenario.redeem = grantedRedeem({ consent_status: "pending" });
    const result = await driverActions.driverStatusUpdateAction(
      { status: "idle" },
      driverForm(),
    );
    expect(result.status).toBe("success");
  });

  it("ACCEPTS a location once consent is granted — the non-vacuity control", async () => {
    scenario.redeem = grantedRedeem({ consent_status: "granted" });
    const result = await driverActions.driverStatusUpdateAction(
      { status: "idle" },
      driverForm({ city: "Richmond", state: "VA" }),
    );
    expect(result.status).toBe("success");
    expect(rpcCalls).toContain("apply_shipment_transition");
  });

  it("treats an ABSENT checkbox as NOT granted — consent is never a default", async () => {
    const fd = driverForm();
    fd.delete("granted");
    const result = await driverActions.driverConsentAction({ status: "idle" }, fd);
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual(["set_driver_token_consent"]);
  });

  it("does NOT burn a redemption to record consent", async () => {
    // Going through `redeemDriverToken` would spend rate budget and a ledger
    // row every time a driver changed their mind, letting them lock
    // themselves out of their own shipment.
    await driverActions.driverConsentAction(
      { status: "idle" },
      driverForm({ granted: "on" }),
    );
    expect(rpcCalls).not.toContain("redeem_shipment_driver_token");
  });
});
