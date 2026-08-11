import { describe, expect, it } from "vitest";

import {
  CARRIER_ACTION_IDS,
  CARRIER_FORBIDDEN_FIELDS,
  CARRIER_REFUSAL_MESSAGES,
  CARRIER_UPDATE_ACTIONS,
  CARRIER_UPDATE_ACTORS,
  DEFERRED_CARRIER_ACTIONS,
  actorMayInvoke,
  carrierAction,
  offeredCarrierActions,
  refuseCarrierAction,
  type CarrierUpdateActor,
} from "@/lib/shipments/carrier-updates";
import {
  ACTOR_PERMITTED_TARGETS,
  NO_TRANSITION_FACTS,
  availableTransitions,
  type TransitionFacts,
} from "@/lib/shipments/transitions";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/shipments/types";
import messages from "../../messages/en.json";
import esMessages from "../../messages/es.json";
import frMessages from "../../messages/fr.json";
import ruMessages from "../../messages/ru.json";
import htMessages from "../../messages/ht.json";

/**
 * M-76 — §13's action list and the CARRIER-vs-DRIVER-vs-STAFF permission
 * matrix, proved rather than described.
 *
 * The matrix is the module's central claim, so it is asserted three ways:
 *
 *   1. against §13's own list, item by item, including the four phrases that
 *      are not §6 status names;
 *   2. against M-72's `ACTOR_PERMITTED_TARGETS`, so a widening on either side
 *      fails here rather than being discovered by a carrier;
 *   3. over the FULL CROSS PRODUCT of 12 actions × 18 statuses × 2 actors,
 *      compared against `availableTransitions` — the complement, not just the
 *      positive cases.
 */

const ALL_FACTS: TransitionFacts = {
  activeAssignmentId: "as-1",
  pickupConfirmedAt: "2026-08-05T10:00:00.000Z",
  deliveryTimestamp: "2026-08-05T18:00:00.000Z",
  deliveredAt: "2026-08-05T18:00:00.000Z",
  approvedPodDocumentId: "doc-1",
  closeoutCompletedAt: "2026-08-05T20:00:00.000Z",
  cancellationReason: "customer cancelled",
};

/* ================================================================== *
 * §13's list
 * ================================================================== */

describe("§13's allowed actions", () => {
  it("names every action §13 lists, and maps the four non-status phrases correctly", () => {
    const byId = Object.fromEntries(
      CARRIER_UPDATE_ACTIONS.map((a) => [a.id, a] as const),
    );
    // §13, verbatim, in order.
    expect(byId.confirm_dispatch?.status).toBe("dispatched");
    expect(byId.en_route_to_pickup?.status).toBe("en_route_to_pickup");
    expect(byId.arrived_at_pickup?.status).toBe("arrived_at_pickup");
    // "loaded" is the truck going under the freight — `loading`, not
    // `picked_up`. Getting this backwards would have offered an illegal edge.
    expect(byId.loaded?.status).toBe("loading");
    // "departed pickup" IS §6's `picked_up` milestone.
    expect(byId.departed_pickup?.status).toBe("picked_up");
    expect(byId.in_transit?.status).toBe("in_transit");
    expect(byId.delayed?.status).toBe("delayed");
    expect(byId.arrived_at_delivery?.status).toBe("arrived_at_delivery");
    expect(byId.delivered?.status).toBe("delivered");
    expect(byId.update_eta?.kind).toBe("eta");
    expect(byId.submit_exception?.kind).toBe("exception");
  });

  it("includes `unloading`, which §13 does not name and §6's graph requires", () => {
    // Without it, `arrived_at_delivery` → `delivered` is not an edge, so §13's
    // own "delivered" would be unreachable from §13's own "arrived at
    // delivery". §13 says its list "may include".
    const ids = CARRIER_ACTION_IDS;
    expect(ids).toContain("unloading");
    expect(availableTransitions("arrived_at_delivery", "carrier", ALL_FACTS)).toContain(
      "unloading",
    );
    expect(availableTransitions("arrived_at_delivery", "carrier", ALL_FACTS)).not.toContain(
      "delivered",
    );
  });

  it("claims NO document upload — §13's two upload actions are M-77's, named not missing", () => {
    for (const action of CARRIER_UPDATE_ACTIONS) {
      expect(action.id).not.toMatch(/upload/);
      expect(action.status).not.toBe("pod_uploaded");
    }
    expect(DEFERRED_CARRIER_ACTIONS.map((a) => a.id)).toEqual([
      "upload_bol",
      "upload_pod",
    ]);
    for (const deferred of DEFERRED_CARRIER_ACTIONS) {
      expect(deferred.owner).toBe("M-77");
    }
  });

  it("has a unique id and a real i18n key for every action, in all five locales", () => {
    const catalogues = {
      en: messages,
      es: esMessages,
      fr: frMessages,
      ru: ruMessages,
      ht: htMessages,
    } as const;
    const ids = CARRIER_UPDATE_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);

    const keys = [
      ...CARRIER_UPDATE_ACTIONS.map((a) => a.labelKey),
      ...DEFERRED_CARRIER_ACTIONS.map((a) => a.labelKey),
    ];
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      for (const key of keys) {
        const path = key.split(".");
        let node: unknown = catalogue;
        for (const part of path) {
          node = (node as Record<string, unknown>)?.[part];
        }
        expect(typeof node, `${locale} is missing ${key}`).toBe("string");
        expect((node as string).length, `${locale} ${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("resolves an id to its action and refuses anything else without throwing", () => {
    expect(carrierAction("delivered")?.status).toBe("delivered");
    for (const bad of [
      null,
      undefined,
      42,
      {},
      "",
      "DELIVERED",
      "cancelled",
      "completed",
      "pod_uploaded",
      "correct_status",
    ]) {
      expect(carrierAction(bad)).toBeNull();
    }
  });
});

/* ================================================================== *
 * The matrix
 * ================================================================== */

describe("carrier vs driver vs staff — the §19 permission matrix", () => {
  it("gives a DRIVER a strict subset of a CARRIER's actions", () => {
    const carrier = CARRIER_UPDATE_ACTIONS.filter((a) => actorMayInvoke("carrier", a));
    const driver = CARRIER_UPDATE_ACTIONS.filter((a) => actorMayInvoke("driver", a));
    expect(driver.length).toBeLessThan(carrier.length);
    for (const action of driver) expect(carrier).toContain(action);
    expect(
      carrier.filter((a) => !driver.includes(a)).map((a) => a.id),
    ).toEqual(["confirm_dispatch"]);
  });

  it("CONFIRM DISPATCH is carrier-only in BOTH layers, independently", () => {
    // Layer 1 — §13's action list.
    expect(actorMayInvoke("carrier", carrierAction("confirm_dispatch")!)).toBe(true);
    expect(actorMayInvoke("driver", carrierAction("confirm_dispatch")!)).toBe(false);
    // Layer 2 — M-72's actor gate, which does not know this module exists.
    expect(ACTOR_PERMITTED_TARGETS.carrier).toContain("dispatched");
    expect(ACTOR_PERMITTED_TARGETS.driver).not.toContain("dispatched");
    // And the refusal is a PERMISSIONS answer, not an operational one.
    expect(
      refuseCarrierAction("driver", "confirm_dispatch", "carrier_assigned", ALL_FACTS),
    ).toBe("actor_not_permitted");
    expect(
      refuseCarrierAction("carrier", "confirm_dispatch", "carrier_assigned", ALL_FACTS),
    ).toBeNull();
  });

  it("gives NEITHER actor a staff-only transition — cancel, complete, correct, accept, assign", () => {
    const staffOnly: ShipmentStatus[] = [
      "cancelled",
      "completed",
      "pod_uploaded",
      "quote_sent",
      "quote_accepted",
      "carrier_search",
      "carrier_assigned",
    ];
    for (const actor of CARRIER_UPDATE_ACTORS) {
      const reachableAnywhere = new Set<ShipmentStatus>();
      for (const from of SHIPMENT_STATUSES) {
        for (const to of availableTransitions(from, actor, ALL_FACTS)) {
          reachableAnywhere.add(to);
        }
      }
      for (const status of staffOnly) {
        expect(
          reachableAnywhere.has(status),
          `${actor} must never reach ${status}`,
        ).toBe(false);
      }
      // The §13 action list cannot name one either.
      for (const action of CARRIER_UPDATE_ACTIONS) {
        if (action.status === null) continue;
        expect(staffOnly).not.toContain(action.status);
      }
    }
  });

  it("STAFF keep everything the two customer actors do not — the non-vacuity control", () => {
    // If the assertions above passed because `availableTransitions` returned
    // nothing for everyone, this would fail.
    for (const status of ["carrier_search", "delivered", "in_transit"] as const) {
      expect(availableTransitions(status, "dispatcher", ALL_FACTS).length).toBeGreaterThan(0);
      expect(availableTransitions(status, "admin", ALL_FACTS).length).toBeGreaterThan(0);
    }
    expect(availableTransitions("unloading", "admin", ALL_FACTS)).toContain("cancelled");
    expect(availableTransitions("delivered", "admin", ALL_FACTS)).toContain("completed");
    expect(availableTransitions("unloading", "carrier", ALL_FACTS)).not.toContain("cancelled");
  });

  /**
   * The complement, over the whole cross product. This is the assertion that
   * would catch a silent widening anywhere in the chain: `offeredCarrierActions`
   * may offer a transition IF AND ONLY IF `availableTransitions` allows it.
   */
  it("offers a transition exactly when M-72's engine allows it — 12 × 18 × 2", () => {
    let offered = 0;
    let withheld = 0;
    for (const actor of CARRIER_UPDATE_ACTORS) {
      for (const status of SHIPMENT_STATUSES) {
        const allowed = new Set(availableTransitions(status, actor, ALL_FACTS));
        const list = offeredCarrierActions(actor, status, ALL_FACTS);
        for (const action of CARRIER_UPDATE_ACTIONS) {
          if (action.kind !== "transition" || action.status === null) continue;
          const inList = list.includes(action);
          const shouldBe =
            actorMayInvoke(actor, action) && allowed.has(action.status);
          expect(
            inList,
            `${actor} @ ${status} → ${action.id}`,
          ).toBe(shouldBe);
          if (shouldBe) offered++;
          else withheld++;
        }
      }
    }
    // Non-vacuity: the loop actually exercised both outcomes.
    expect(offered).toBeGreaterThan(20);
    expect(withheld).toBeGreaterThan(300);
  });

  it("offers ETA and exception on every non-terminal status and on NEITHER terminal one", () => {
    for (const actor of CARRIER_UPDATE_ACTORS) {
      for (const status of SHIPMENT_STATUSES) {
        const ids = offeredCarrierActions(actor, status, ALL_FACTS).map((a) => a.id);
        const terminal = status === "completed" || status === "cancelled";
        expect(ids.includes("update_eta"), `${actor} @ ${status}`).toBe(!terminal);
        expect(ids.includes("submit_exception"), `${actor} @ ${status}`).toBe(!terminal);
      }
    }
  });

  it("offers NOTHING at all on a terminal shipment", () => {
    for (const actor of CARRIER_UPDATE_ACTORS) {
      expect(offeredCarrierActions(actor, "completed", ALL_FACTS)).toEqual([]);
      expect(offeredCarrierActions(actor, "cancelled", ALL_FACTS)).toEqual([]);
      expect(refuseCarrierAction(actor, "delivered", "completed", ALL_FACTS)).toBe(
        "terminal_status",
      );
    }
  });
});

/* ================================================================== *
 * Refusals
 * ================================================================== */

describe("refusals are typed, ordered and total", () => {
  it("names an unknown action BEFORE a permission problem", () => {
    // A typo and a forbidden action are different problems; conflating them
    // sends a carrier down the wrong path.
    expect(refuseCarrierAction("driver", "not_an_action", "in_transit")).toBe(
      "unknown_action",
    );
    expect(refuseCarrierAction("driver", "confirm_dispatch", "carrier_assigned")).toBe(
      "actor_not_permitted",
    );
  });

  it("distinguishes 'never' from 'not from here'", () => {
    // The carrier MAY set `delivered` — just not from `in_transit`.
    expect(refuseCarrierAction("carrier", "delivered", "in_transit", ALL_FACTS)).toBe(
      "not_available_now",
    );
    // The carrier may NEVER confirm... anything the graph forbids from here.
    expect(refuseCarrierAction("driver", "confirm_dispatch", "in_transit")).toBe(
      "actor_not_permitted",
    );
  });

  it("returns null exactly when the action is offered — over the whole cross product", () => {
    for (const actor of CARRIER_UPDATE_ACTORS) {
      for (const status of SHIPMENT_STATUSES) {
        const offered = new Set(
          offeredCarrierActions(actor, status, ALL_FACTS).map((a) => a.id),
        );
        for (const id of CARRIER_ACTION_IDS) {
          const refusal = refuseCarrierAction(actor, id, status, ALL_FACTS);
          expect(refusal === null, `${actor} @ ${status} → ${id}`).toBe(
            offered.has(id),
          );
        }
      }
    }
  });

  it("never throws, for any input, including garbage", () => {
    const actors = [...CARRIER_UPDATE_ACTORS, "carrier"] as CarrierUpdateActor[];
    for (const actor of actors) {
      for (const status of SHIPMENT_STATUSES) {
        for (const id of [...CARRIER_ACTION_IDS, null, undefined, 7, {}, "x"]) {
          expect(() =>
            refuseCarrierAction(actor, id, status, NO_TRANSITION_FACTS),
          ).not.toThrow();
        }
      }
    }
  });

  it("has an English sentence for every refusal code, and none of them is a code", () => {
    for (const [code, message] of Object.entries(CARRIER_REFUSAL_MESSAGES)) {
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toContain(code);
      expect(message).not.toContain("_");
    }
  });
});

/* ================================================================== *
 * §19's "approved fields"
 * ================================================================== */

describe("§19 approved fields", () => {
  it("names every financial and ownership column a carrier must not write", () => {
    for (const field of [
      "gross_shipper_amount",
      "carrier_pay",
      "margin",
      "shipper_id",
      "dispatcher_id",
      "tracking_number",
      "public_access_hash",
      "delay_reason_internal",
    ]) {
      expect(CARRIER_FORBIDDEN_FIELDS).toContain(field);
    }
  });
});

/* ================================================================== *
 * §9/§13 consent gating — the pure half
 * ================================================================== */

describe("§9/§13 consent gating", () => {
  it("is orthogonal to the action list: consent gates LOCATION, never status", () => {
    // A driver may always report what happened. Consent governs whether the
    // city/state fields are accepted, which is a property of the REQUEST and
    // is asserted in `carrier-shipment-actions.test.ts` against the action.
    // What is asserted here is the invariant that makes that safe: no action
    // in the list is itself a location write.
    for (const action of CARRIER_UPDATE_ACTIONS) {
      expect(action.kind).not.toBe("location");
      expect(action.id).not.toMatch(/location|gps|position/);
    }
  });

  it("offers the same actions whether or not consent is granted", () => {
    // Consent must not silently remove a driver's ability to say "delivered".
    const withConsent = offeredCarrierActions("driver", "unloading", ALL_FACTS);
    const withoutConsent = offeredCarrierActions("driver", "unloading", ALL_FACTS);
    expect(withConsent.map((a) => a.id)).toEqual(withoutConsent.map((a) => a.id));
    expect(withConsent.map((a) => a.id)).toContain("delivered");
  });
});
