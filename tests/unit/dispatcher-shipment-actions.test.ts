import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOT_STAFF_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
  SHIPMENT_MISSING_MESSAGE,
  isShipmentId,
} from "@/lib/shipments/staff-access";

/**
 * M-75 — the gate every §14 action passes through, asserted over the ACTIONS
 * THEMSELVES rather than over the helper.
 *
 * WHY IT IS WRITTEN THIS WAY. There are fifteen exported server actions. A
 * test of `resolveShipmentAccess` proves the helper works; it proves nothing
 * about the fourteenth action that forgot to call it — and that action is
 * indistinguishable from the thirteen that did by reading. So this suite
 * enumerates the module's exports and drives EACH ONE through three scenarios:
 * no session, an out-of-scope shipment, and (as the non-vacuity control) an
 * in-scope admin, which must NOT be refused for an authorization reason.
 *
 * The Supabase clients are stubs. What is proved is the LAYER — that a refusal
 * happens before any write — not that the SQL is right; the integration lane
 * owns that.
 */

/* ------------------------------------------------------------------ *
 * Stubs
 * ------------------------------------------------------------------ */

interface Scenario {
  /** null = no session at all. */
  user: { id: string } | null;
  role: "admin" | "dispatcher" | "shipper";
  status: "active" | "suspended";
  /** null = the shipment id does not resolve. */
  shipment: {
    id: string;
    status: string;
    tracking_number: string;
    shipper_id: string;
    carrier_id: string | null;
    dispatcher_id: string | null;
  } | null;
  /** Carriers assigned to this dispatcher. */
  carrierIds: string[];
  /** §20's `carrier_assigned` precondition, as the facts RPC would report it. */
  activeAssignmentId: string | null;
  /** M-78 — does the chosen exception belong to the gated shipment? */
  exceptionOnShipment: boolean;
}

let scenario: Scenario;
let conflictOnTransition = false;
const rpcCalls: string[] = [];
const writes: string[] = [];

function serverClient() {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: scenario.user } }),
    },
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return Promise.resolve({
            data: scenario.carrierIds.map((id) => ({ id })),
          });
        },
        order() {
          return builder;
        },
        limit() {
          return Promise.resolve({
            data: scenario.carrierIds.map((id) => ({ id })),
          });
        },
        maybeSingle() {
          if (table === "profiles") {
            return Promise.resolve({
              data: {
                role: scenario.role,
                status: scenario.status,
                full_name: "Staff",
                created_at: "2026-01-01T00:00:00Z",
              },
            });
          }
          if (table === "shipments") {
            return Promise.resolve({ data: scenario.shipment });
          }
          /* M-78 — the ownership check the two §21 lifecycle actions run
           * BEFORE writing: does the chosen exception belong to the shipment
           * the §19 scope gate just approved? Read under the caller's own
           * session, so 0025's staff policy answers as well.
           * `scenario.exceptionOnShipment = false` makes it say no, which is
           * the non-vacuity case asserted below. */
          if (table === "shipment_exceptions") {
            return Promise.resolve({
              data: scenario.exceptionOnShipment ? { id: "ex-1" } : null,
            });
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
      if (name === "shipment_transition_facts") {
        return Promise.resolve({
          data: {
            status: scenario.shipment?.status ?? "carrier_search",
            tracking_number: "PL-2026-000458",
            carrier_id: scenario.shipment?.carrier_id ?? null,
            active_assignment_id: scenario.activeAssignmentId,
            pickup_confirmed_at: null,
            delivered_at: null,
            approved_pod_document_id: null,
          },
          error: null,
        });
      }
      if (conflictOnTransition && name === "apply_shipment_transition") {
        return Promise.resolve({
          data: null,
          error: { code: "PL409", message: "status changed under us" },
        });
      }
      return Promise.resolve({
        data: { shipment_id: "sh-1", event_id: "ev-1", status: "carrier_search" },
        error: null,
      });
    },
    from(table: string) {
      writes.push(`admin:${table}`);
      /* M-78 widened this builder: `setShipmentEta` now reads the shipment
       * row (distance / shipper / tracking number) before writing, for the
       * `calculated` source and the §10 customer notification. `eq()` is a
       * CHAINABLE that is also awaitable, so the pre-existing `.update().eq()`
       * write path and the new `.select().eq().maybeSingle()` read path both
       * work against one stub. */
      const b = {
        update: () => b,
        insert: () => Promise.resolve({ error: null }),
        eq: () => b,
        select: () => b,
        not: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "shipments"
                ? {
                    distance_miles: 480,
                    shipper_id: "22222222-2222-4222-8222-222222222222",
                    tracking_number: "PL-2026-000458",
                  }
                : null,
            error: null,
          }),
        then: (resolve: (value: { error: null; data: null }) => unknown) =>
          resolve({ error: null, data: null }),
      };
      return b;
    },
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null } }) } },
  }),
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: () => {
    writes.push("audit");
    return Promise.resolve();
  },
}));

vi.mock("@/lib/company-settings", () => ({
  getBooleanSetting: () => Promise.resolve(true),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

// `@/lib/auth` (real, and the source of `isStaffRole` below) reaches
// next-intl's client navigation for its redirect helpers, which does not
// resolve outside a Next runtime. Only the routing half is stubbed — the role
// predicate the gate actually uses stays the real one.
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string }) => href,
  Link: () => null,
  redirect: () => undefined,
  useRouter: () => ({ refresh: () => undefined }),
  usePathname: () => "/",
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  },
  notFound: () => {
    throw new Error("unexpected notFound");
  },
}));

const actions = await import("@/app/actions/dispatcher-shipments");

// RFC-4122 v4 shapes: Zod's `z.uuid()` validates the version and variant
// nibbles, so a "11111111-…" placeholder is rejected as malformed input
// before any action logic runs.
const SHIPMENT_ID = "11111111-1111-4111-8111-111111111111";

/** The action exports, discovered rather than listed — a new one is covered. */
const ACTION_NAMES = Object.keys(actions).filter((k) =>
  k.endsWith("Action"),
) as (keyof typeof actions)[];

/**
 * The two actions that operate WITHOUT a shipment id (creation and quote
 * conversion). They pass `resolveStaffActor`, not `resolveShipmentAccess`, so
 * the out-of-scope scenario does not apply to them — they are still covered by
 * the no-session scenario.
 */
const SHIPMENTLESS = new Set(["createShipmentAction", "convertQuoteAction"]);

function formData(): FormData {
  const fd = new FormData();
  fd.set("shipment_id", SHIPMENT_ID);
  fd.set("quote_id", "22222222-2222-4222-8222-222222222222");
  return fd;
}

beforeEach(() => {
  rpcCalls.length = 0;
  writes.length = 0;
  conflictOnTransition = false;
  scenario = {
    user: { id: "u-1" },
    role: "admin",
    status: "active",
    shipment: {
      id: SHIPMENT_ID,
      status: "carrier_search",
      tracking_number: "PL-2026-000458",
      shipper_id: "s-1",
      carrier_id: null,
      dispatcher_id: "u-1",
    },
    carrierIds: [],
    activeAssignmentId: "as-1",
    exceptionOnShipment: true,
  };
});

describe("§14 actions — the gate, proved per action", () => {
  it("exports the §14 actions the plan and directive name, plus M-76's two §13 driver-link actions and M-78's two §21 lifecycle actions", () => {
    expect(ACTION_NAMES.sort()).toEqual(
      [
        "addNoteAction",
        "assignCarrierAction",
        "assignDispatcherAction",
        "convertQuoteAction",
        "correctStatusAction",
        "createShipmentAction",
        "logExceptionAction",
        "recordCallAction",
        "recordEmailAction",
        "releaseCarrierAction",
        "requestPodAction",
        "resendNotificationAction",
        "setAppointmentAction",
        "updateEtaAction",
        "updateStatusAction",
        // M-76 — §13 permits a dispatcher OR the carrier to issue a driver
        // link, so the dispatcher half lands on this surface. Both go through
        // the same `resolveShipmentAccess` gate as the fifteen above, which
        // the scenarios below prove per action rather than by assertion.
        "issueDriverTokenAction",
        "revokeDriverTokenAction",
        // M-78 — §14's "resolve exception", which M-75 named as M-78's and
        // did not build ("resolving needs a row to resolve"), plus §21's
        // triage fields. Both go through the same gate.
        "resolveExceptionAction",
        "triageExceptionAction",
      ].sort(),
    );
  });

  it.each(ACTION_NAMES)("%s refuses with NO session and writes nothing", async (name) => {
    scenario.user = null;
    const action = actions[name] as (
      p: unknown,
      f: FormData,
    ) => Promise<{ status: string; message?: string }>;
    const result = await action({ status: "idle" }, formData());
    expect(result.status).toBe("error");
    expect(result.message).toBe(NOT_STAFF_MESSAGE);
    expect(rpcCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it.each(ACTION_NAMES)("%s refuses a SHIPPER session", async (name) => {
    scenario.role = "shipper";
    const action = actions[name] as (
      p: unknown,
      f: FormData,
    ) => Promise<{ status: string; message?: string }>;
    const result = await action({ status: "idle" }, formData());
    expect(result.status).toBe("error");
    expect(result.message).toBe(NOT_STAFF_MESSAGE);
    expect(rpcCalls).toEqual([]);
  });

  it.each(ACTION_NAMES)("%s refuses a SUSPENDED staff session", async (name) => {
    scenario.status = "suspended";
    const action = actions[name] as (
      p: unknown,
      f: FormData,
    ) => Promise<{ status: string; message?: string }>;
    const result = await action({ status: "idle" }, formData());
    expect(result.status).toBe("error");
    expect(rpcCalls).toEqual([]);
  });

  it.each(ACTION_NAMES.filter((n) => !SHIPMENTLESS.has(n)))(
    "%s refuses dispatcher A acting on dispatcher B's shipment (§19)",
    async (name) => {
      scenario.role = "dispatcher";
      scenario.carrierIds = ["c-1"];
      scenario.shipment = {
        id: SHIPMENT_ID,
        status: "carrier_search",
        tracking_number: "PL-2026-000458",
        shipper_id: "s-1",
        // Owned by another dispatcher, hauled by a carrier we are not assigned.
        carrier_id: "c-9",
        dispatcher_id: "u-2",
      };
      const action = actions[name] as (
        p: unknown,
        f: FormData,
      ) => Promise<{ status: string; message?: string }>;
      const result = await action({ status: "idle" }, formData());
      expect(result.status).toBe("error");
      expect(result.message).toBe(OUT_OF_SCOPE_MESSAGE);
      expect(rpcCalls).toEqual([]);
      expect(writes).toEqual([]);
    },
  );

  it.each(ACTION_NAMES.filter((n) => !SHIPMENTLESS.has(n)))(
    "%s refuses a shipment id that does not resolve",
    async (name) => {
      scenario.shipment = null;
      const action = actions[name] as (
        p: unknown,
        f: FormData,
      ) => Promise<{ status: string; message?: string }>;
      const result = await action({ status: "idle" }, formData());
      expect(result.status).toBe("error");
      expect(result.message).toBe(SHIPMENT_MISSING_MESSAGE);
      expect(rpcCalls).toEqual([]);
    },
  );

  it.each(ACTION_NAMES.filter((n) => !SHIPMENTLESS.has(n)))(
    "%s refuses a malformed shipment id before any query",
    async (name) => {
      const fd = formData();
      fd.set("shipment_id", "not-a-uuid");
      const action = actions[name] as (
        p: unknown,
        f: FormData,
      ) => Promise<{ status: string; message?: string }>;
      const result = await action({ status: "idle" }, fd);
      expect(result.status).toBe("error");
      expect(rpcCalls).toEqual([]);
    },
  );

  it.each(ACTION_NAMES.filter((n) => !SHIPMENTLESS.has(n)))(
    "%s does NOT refuse an in-scope admin for an authorization reason (control)",
    async (name) => {
      // The non-vacuity control for every refusal above: with a valid session
      // and an in-scope shipment, no action returns an AUTHORIZATION message.
      // Some still fail on validation (an empty form), which is correct and is
      // a different message.
      const action = actions[name] as (
        p: unknown,
        f: FormData,
      ) => Promise<{ status: string; message?: string }>;
      const result = await action({ status: "idle" }, formData());
      expect(result.message).not.toBe(NOT_STAFF_MESSAGE);
      expect(result.message).not.toBe(OUT_OF_SCOPE_MESSAGE);
      expect(result.message).not.toBe(SHIPMENT_MISSING_MESSAGE);
    },
  );
});

describe("§20 admin correction is admin-only at the surface too", () => {
  it("refuses a dispatcher with the §20 sentence, before any write", async () => {
    scenario.role = "dispatcher";
    scenario.carrierIds = [];
    scenario.shipment = {
      id: SHIPMENT_ID,
      status: "carrier_search",
      tracking_number: "PL-2026-000458",
      shipper_id: "s-1",
      carrier_id: null,
      // In scope — so the ONLY reason for the refusal is the admin rule.
      dispatcher_id: "u-1",
    };
    const fd = formData();
    fd.set("expected_status", "carrier_search");
    fd.set("corrected_status", "carrier_assigned");
    fd.set("reason", "keyed the wrong status this morning");
    const result = await actions.correctStatusAction({ status: "idle" }, fd);
    expect(result.status).toBe("error");
    expect(result.message).toContain("Only an admin");
    expect(rpcCalls).toEqual([]);
  });

  it("demands a real reason, not a keystroke (§20)", async () => {
    const fd = formData();
    fd.set("expected_status", "carrier_search");
    fd.set("corrected_status", "carrier_assigned");
    fd.set("reason", "x");
    const result = await actions.correctStatusAction({ status: "idle" }, fd);
    expect(result.status).toBe("error");
    expect(result.message).toContain("written reason");
    expect(rpcCalls).toEqual([]);
  });

  it("calls M-72's correction RPC — it does not reimplement the flow", async () => {
    const fd = formData();
    fd.set("expected_status", "carrier_search");
    fd.set("corrected_status", "carrier_assigned");
    fd.set("reason", "keyed the wrong status this morning");
    const result = await actions.correctStatusAction({ status: "idle" }, fd);
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual(["apply_shipment_correction"]);
  });
});

describe("the §14 actions call the engine, never a raw write", () => {
  it("a status update goes through apply_shipment_transition, never a raw update", async () => {
    const fd = formData();
    fd.set("expected_status", "carrier_search");
    fd.set("to", "carrier_assigned");
    const result = await actions.updateStatusAction({ status: "idle" }, fd);
    expect(result.status).toBe("success");
    expect(rpcCalls).toEqual([
      "shipment_transition_facts",
      "apply_shipment_transition",
    ]);
    expect(writes.filter((w) => w.startsWith("admin:shipments"))).toEqual([]);
  });

  it("a §20 precondition refusal costs ONE read and ZERO writes", async () => {
    // `carrier_assigned` requires a carrier assignment. Without one, M-72's
    // engine refuses before the RPC — the whole reason validation runs first.
    scenario.activeAssignmentId = null;
    const fd = formData();
    fd.set("expected_status", "carrier_search");
    fd.set("to", "carrier_assigned");
    const result = await actions.updateStatusAction({ status: "idle" }, fd);
    expect(result.status).toBe("error");
    expect(result.message).toContain("no open carrier assignment");
    expect(rpcCalls).toEqual(["shipment_transition_facts"]);
  });

  it("surfaces a compare-and-swap loss as 'reload', not as a generic error (M-72 R-4)", async () => {
    conflictOnTransition = true;
    const fd = formData();
    fd.set("expected_status", "carrier_search");
    fd.set("to", "carrier_assigned");
    const result = await actions.updateStatusAction({ status: "idle" }, fd);
    expect(result.status).toBe("error");
    expect(result.message).toContain("Somebody else moved this shipment");
    expect(result.message).toContain("Reload");
  });

  it("an appointment goes through M-72's event-sourced path", async () => {
    const fd = formData();
    fd.set("kind", "pickup");
    fd.set("appointment_at", "2026-09-01T08:00");
    await actions.setAppointmentAction({ status: "idle" }, fd);
    expect(rpcCalls).toEqual(["set_shipment_appointment"]);
  });

  it("record call / record email / note / POD all append events", async () => {
    const cases: [keyof typeof actions, Record<string, string>][] = [
      ["recordCallAction", { direction: "inbound", party: "carrier", summary: "Driver is loaded" }],
      [
        "recordEmailAction",
        { direction: "outbound", party: "shipper", subject: "Pickup confirmed" },
      ],
      ["addNoteAction", { band: "internal", body: "Watch the receiver hours" }],
      ["requestPodAction", {}],
    ];
    for (const [name, fields] of cases) {
      rpcCalls.length = 0;
      const fd = formData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const action = actions[name] as (
        p: unknown,
        f: FormData,
      ) => Promise<{ status: string; message?: string }>;
      const result = await action({ status: "idle" }, fd);
      expect(result.status, `${name}: ${result.message}`).toBe("success");
      expect(rpcCalls, String(name)).toEqual(["append_shipment_event"]);
    }
  });

  /* M-78 — logging an exception LEFT the generic append path. It is now
   * `open_shipment_exception()`, which writes the §21 row AND the identical
   * `exception_opened` event in one transaction, so the customer timeline is
   * unchanged and the lifecycle exists behind it. Asserted as its own case,
   * because "one RPC, and it is the atomic one" is the property that matters. */
  it("logging an exception goes through the atomic 0025 function, not a bare append", async () => {
    const fd = formData();
    fd.set("exception_type", "pickup_delay");
    fd.set("severity", "medium");
    fd.set("internal_description", "Shipper not ready at the dock");
    const result = await actions.logExceptionAction({ status: "idle" }, fd);
    expect(result.status, result.message).toBe("success");
    expect(rpcCalls).toEqual(["open_shipment_exception"]);
  });

  it("resolving an exception goes through the atomic 0025 function", async () => {
    const fd = formData();
    fd.set("exception_id", "88888888-8888-4888-8888-888888888888");
    fd.set("resolution", "Dock cleared; driver loaded at 14:10.");
    const result = await actions.resolveExceptionAction({ status: "idle" }, fd);
    expect(result.status, result.message).toBe("success");
    expect(rpcCalls).toEqual(["resolve_shipment_exception"]);
  });

  /* NON-VACUITY, and a real §19 hole if it ever regressed: the §19 scope gate
   * keys on the SHIPMENT, so a dispatcher legitimately scoped to shipment A
   * could otherwise resolve an exception on shipment B by editing one hidden
   * field. The second check refuses BEFORE any RPC is issued. */
  it("REFUSES to resolve an exception that is not on the gated shipment, and writes nothing", async () => {
    scenario.exceptionOnShipment = false;
    const fd = formData();
    fd.set("exception_id", "88888888-8888-4888-8888-888888888888");
    fd.set("resolution", "Dock cleared.");
    const result = await actions.resolveExceptionAction({ status: "idle" }, fd);
    expect(result.status).toBe("error");
    expect(result.message).toContain("not on this shipment");
    expect(rpcCalls).toEqual([]);
  });

  it("REFUSES to triage an exception that is not on the gated shipment", async () => {
    scenario.exceptionOnShipment = false;
    const fd = formData();
    fd.set("exception_id", "88888888-8888-4888-8888-888888888888");
    fd.set("severity", "high");
    const result = await actions.triageExceptionAction({ status: "idle" }, fd);
    expect(result.status).toBe("error");
    expect(rpcCalls).toEqual([]);
  });

  it("an ETA update goes through set_shipment_eta", async () => {
    const fd = formData();
    fd.set("kind", "delivery");
    fd.set("eta_at", "2026-09-03T17:00");
    fd.set("eta_source", "manual");
    await actions.updateEtaAction({ status: "idle" }, fd);
    expect(rpcCalls).toEqual(["set_shipment_eta"]);
  });

  it("an assignment goes through the atomic 0022 function", async () => {
    const fd = formData();
    fd.set("carrier_id", "33333333-3333-4333-8333-333333333333");
    await actions.assignCarrierAction({ status: "idle" }, fd);
    expect(rpcCalls).toEqual(["assign_shipment_carrier"]);
  });

  it("a dispatcher cannot assign a carrier outside their scope", async () => {
    scenario.role = "dispatcher";
    scenario.carrierIds = ["44444444-4444-4444-8444-444444444444"];
    const fd = formData();
    fd.set("carrier_id", "33333333-3333-4333-8333-333333333333");
    const result = await actions.assignCarrierAction({ status: "idle" }, fd);
    expect(result.status).toBe("error");
    expect(result.message).toContain("not assigned to you");
    expect(rpcCalls).toEqual([]);
  });
});

describe("isShipmentId", () => {
  it("accepts a UUID and refuses everything else, before any query", () => {
    expect(isShipmentId(SHIPMENT_ID)).toBe(true);
    for (const bad of ["", "not-a-uuid", "1; drop table shipments", 42, null, undefined]) {
      expect(isShipmentId(bad)).toBe(false);
    }
  });
});
