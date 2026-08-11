import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AUDIENCE_EVENT_VISIBILITY } from "@/lib/shipments/dto";
import {
  ACTOR_PERMITTED_TARGETS,
  actorMayAssert,
  actorMayCorrect,
  availableTransitions,
  evaluateTransition,
  graphIntegrityProblems,
  IMPOSSIBLE_TRANSITIONS,
  isLegalEdge,
  isTerminalStatus,
  nextStatuses,
  NO_TRANSITION_FACTS,
  OUT_OF_GRAPH_PROHIBITIONS,
  SHIPMENT_TRANSITIONS,
  STATUS_PRECONDITIONS,
  TERMINAL_SHIPMENT_STATUSES,
  TRANSITION_ACTORS,
  unmetPreconditions,
  type TransitionActor,
  type TransitionFacts,
} from "@/lib/shipments/transitions";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/shipments/types";

/**
 * M-72 — the §20 status-transition engine.
 *
 * Structure mirrors the directive rather than the file: the graph, the
 * preconditions, the impossible-transition list, the §19 actor gate, and the
 * exhaustiveness guards that make a nineteenth status a compile error rather
 * than a silent hole. The last block is a drift guard between migration
 * 0019's RLS bands and `dto.ts`'s audience matrix — two copies of §7's
 * visibility rule that must not diverge.
 */

/** Facts with everything established — the base for "the edge is what fails". */
const ALL_FACTS: TransitionFacts = {
  activeAssignmentId: "assignment-1",
  pickupConfirmedAt: "2026-08-05T12:00:00.000Z",
  deliveryTimestamp: "2026-08-06T18:00:00.000Z",
  deliveredAt: "2026-08-06T18:00:00.000Z",
  approvedPodDocumentId: "doc-1",
  closeoutCompletedAt: "2026-08-07T09:00:00.000Z",
  cancellationReason: "shipper withdrew the load",
};

/* ------------------------------------------------------------------ *
 * 1 · Exhaustiveness — a new status must be a compile error, and stay one
 * ------------------------------------------------------------------ */

describe("exhaustiveness", () => {
  /**
   * `SHIPMENT_TRANSITIONS` is declared `Record<ShipmentStatus, …>`, so a
   * nineteenth status without a transition list does not compile. This is the
   * runtime half of the same guarantee: a compile-time rule nobody tests is
   * one `as never` away from being disabled.
   */
  it("every one of §6's 18 statuses has a transition list", () => {
    expect(SHIPMENT_STATUSES).toHaveLength(18);
    for (const status of SHIPMENT_STATUSES) {
      expect(SHIPMENT_TRANSITIONS[status]).toBeDefined();
      expect(Array.isArray(SHIPMENT_TRANSITIONS[status])).toBe(true);
    }
    expect(Object.keys(SHIPMENT_TRANSITIONS).sort()).toEqual(
      [...SHIPMENT_STATUSES].sort(),
    );
  });

  it("every status has an explicit precondition list (possibly empty)", () => {
    expect(Object.keys(STATUS_PRECONDITIONS).sort()).toEqual(
      [...SHIPMENT_STATUSES].sort(),
    );
  });

  it("every actor has an explicit permitted-target list", () => {
    expect(Object.keys(ACTOR_PERMITTED_TARGETS).sort()).toEqual(
      [...TRANSITION_ACTORS].sort(),
    );
  });

  it("no transition targets a status that does not exist", () => {
    expect(graphIntegrityProblems()).toEqual([]);
  });

  it("every actor's permitted targets are real statuses", () => {
    for (const actor of TRANSITION_ACTORS) {
      const targets = ACTOR_PERMITTED_TARGETS[actor];
      if (targets === "*") continue;
      for (const target of targets) {
        expect(SHIPMENT_STATUSES).toContain(target);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2 · The full transition matrix
 * ------------------------------------------------------------------ */

describe("the transition matrix", () => {
  /**
   * THE headline assertion: every edge the graph declares is actually
   * accepted, given a dispatcher and satisfied preconditions. Without this,
   * an over-eager precondition could make a legal edge permanently
   * unreachable and every "illegal transition rejected" test would still pass.
   */
  it("accepts EVERY declared edge (dispatcher, all preconditions met)", () => {
    const accepted: string[] = [];
    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_TRANSITIONS[from]) {
        const decision = evaluateTransition({
          from,
          to,
          actor: "dispatcher",
          facts: ALL_FACTS,
        });
        expect(
          decision.ok,
          `${from} → ${to} should be legal but was refused: ${
            decision.ok ? "" : decision.message
          }`,
        ).toBe(true);
        accepted.push(`${from}->${to}`);
      }
    }
    // 18 statuses, 47 edges. Pinned so a silent widening of the graph shows
    // up here rather than in production.
    expect(accepted).toHaveLength(47);
  });

  it("refuses EVERY edge the graph does not declare", () => {
    let refused = 0;
    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_STATUSES) {
        if (from === to) continue;
        if (isLegalEdge(from, to)) continue;
        const decision = evaluateTransition({
          from,
          to,
          actor: "admin",
          facts: ALL_FACTS,
        });
        expect(decision.ok, `${from} → ${to} must be refused`).toBe(false);
        if (!decision.ok) {
          expect(["illegal_transition", "terminal_status"]).toContain(
            decision.code,
          );
        }
        refused += 1;
      }
    }
    // 18 × 17 ordered pairs = 306, minus the 47 legal edges.
    expect(refused).toBe(306 - 47);
  });

  it("refuses a transition to the same status with `same_status`", () => {
    for (const status of SHIPMENT_STATUSES) {
      const decision = evaluateTransition({
        from: status,
        to: status,
        actor: "admin",
        facts: ALL_FACTS,
      });
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.code).toBe("same_status");
    }
  });

  it("treats `completed` and `cancelled` as terminal", () => {
    expect(TERMINAL_SHIPMENT_STATUSES).toEqual(["completed", "cancelled"]);
    for (const status of TERMINAL_SHIPMENT_STATUSES) {
      expect(isTerminalStatus(status)).toBe(true);
      expect(nextStatuses(status)).toEqual([]);
      const decision = evaluateTransition({
        from: status,
        to: "in_transit",
        actor: "admin",
        facts: ALL_FACTS,
      });
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.code).toBe("terminal_status");
    }
  });

  /**
   * M-70's warning, encoded: declaration order is NOT the graph. If somebody
   * ever "simplifies" the table into `SHIPMENT_STATUSES[i] → [i+1]`, these
   * three facts break.
   */
  it("is not the declaration order (`delayed`/`cancelled` are states)", () => {
    // `delayed` sits at index 11 but is reachable from `dispatched` (index 5)
    // and returns to statuses BEFORE it in the list.
    expect(isLegalEdge("dispatched", "delayed")).toBe(true);
    expect(isLegalEdge("delayed", "en_route_to_pickup")).toBe(true);
    // `in_transit` (10) does not lead to `delayed`'s successor by ordinal.
    expect(isLegalEdge("in_transit", "arrived_at_delivery")).toBe(true);
    // `cancelled` is the last declared status and reachable from most of them,
    // which an ordinal reading could never express.
    expect(isLegalEdge("quote_requested", "cancelled")).toBe(true);
  });

  it("§20's own example — `quote_accepted` may move to `carrier_search`", () => {
    expect(isLegalEdge("quote_accepted", "carrier_search")).toBe(true);
  });

  it("supports §6's carrier reassignment (back to the search desk)", () => {
    expect(isLegalEdge("carrier_assigned", "carrier_search")).toBe(true);
    expect(isLegalEdge("dispatched", "carrier_search")).toBe(true);
  });

  it("supports §6's missing-POD case (`delivered` → `completed`)", () => {
    expect(isLegalEdge("delivered", "completed")).toBe(true);
    expect(isLegalEdge("delivered", "pod_uploaded")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 3 · The impossible-transition list (§20)
 * ------------------------------------------------------------------ */

describe("§20's impossible transitions", () => {
  it("names `delivered` → `carrier_search` first, as the directive does", () => {
    expect(IMPOSSIBLE_TRANSITIONS[0]).toEqual(["delivered", "carrier_search"]);
  });

  it("refuses every listed pair, with a typed code and a message", () => {
    for (const [from, to] of IMPOSSIBLE_TRANSITIONS) {
      const decision = evaluateTransition({
        from,
        to,
        actor: "admin",
        facts: ALL_FACTS,
      });
      expect(decision.ok, `${from} → ${to} must be impossible`).toBe(false);
      if (!decision.ok) {
        expect(["illegal_transition", "terminal_status"]).toContain(
          decision.code,
        );
        expect(decision.message.length).toBeGreaterThan(0);
        expect(decision.from).toBe(from);
        expect(decision.to).toBe(to);
      }
    }
  });

  it("records the three prohibitions that are not graph edges", () => {
    expect(OUT_OF_GRAPH_PROHIBITIONS).toEqual([
      "public_user_marks_paid",
      "carrier_edits_shipper_financials",
      "driver_updates_another_carriers_shipment",
    ]);
    // "public user marking a shipment paid" is impossible because `paid` is
    // not a shipment status at all — it belongs to `loads` (plan §1).
    expect(SHIPMENT_STATUSES as readonly string[]).not.toContain("paid");
  });
});

/* ------------------------------------------------------------------ *
 * 4 · Preconditions (§20), one describe per directive sentence
 * ------------------------------------------------------------------ */

describe("§20 preconditions", () => {
  function refusal(
    from: ShipmentStatus,
    to: ShipmentStatus,
    facts: TransitionFacts,
    actor: TransitionActor = "dispatcher",
  ) {
    const decision = evaluateTransition({ from, to, actor, facts });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error("expected a refusal");
    return decision;
  }

  it("`carrier_assigned` requires a carrier assignment", () => {
    const decision = refusal("carrier_search", "carrier_assigned", {
      ...ALL_FACTS,
      activeAssignmentId: null,
    });
    expect(decision.code).toBe("precondition_failed");
    expect(decision.preconditions).toEqual(["carrier_assignment_required"]);

    expect(
      evaluateTransition({
        from: "carrier_search",
        to: "carrier_assigned",
        actor: "dispatcher",
        facts: { ...ALL_FACTS, activeAssignmentId: "assignment-9" },
      }).ok,
    ).toBe(true);
  });

  it("`picked_up` requires pickup confirmation", () => {
    const decision = refusal("loading", "picked_up", {
      ...ALL_FACTS,
      pickupConfirmedAt: null,
    });
    expect(decision.preconditions).toEqual(["pickup_confirmation_required"]);
  });

  it("`delivered` requires a delivery timestamp", () => {
    const decision = refusal("unloading", "delivered", {
      ...ALL_FACTS,
      deliveryTimestamp: null,
    });
    expect(decision.preconditions).toEqual(["delivery_timestamp_required"]);
  });

  /**
   * §20: "`pod_uploaded` requires an approved POD document." M-77 owns
   * documents, so the fact is null today and the transition is REFUSED —
   * which is the honest behaviour. A precondition that cannot be evaluated
   * must fail, never pass. This test is also the tripwire: when M-77 teaches
   * `shipment_transition_facts()` to resolve the document, the refusal below
   * stays true for a shipment with no approved POD.
   */
  it("`pod_uploaded` requires an approved POD document (M-77 supplies it)", () => {
    const decision = refusal("delivered", "pod_uploaded", {
      ...ALL_FACTS,
      approvedPodDocumentId: null,
    });
    expect(decision.preconditions).toEqual(["approved_pod_required"]);
    expect(decision.message).toContain("M-77");

    // With a document id it is accepted — so the refusal is about the fact,
    // not about the edge.
    expect(
      evaluateTransition({
        from: "delivered",
        to: "pod_uploaded",
        actor: "dispatcher",
        facts: ALL_FACTS,
      }).ok,
    ).toBe(true);
  });

  it("`completed` requires BOTH delivery and closeout, and says which is missing", () => {
    const neither = refusal("delivered", "completed", {
      ...ALL_FACTS,
      deliveredAt: null,
      closeoutCompletedAt: null,
    });
    expect(neither.preconditions).toEqual([
      "delivery_required",
      "closeout_required",
    ]);

    const closeoutOnly = refusal("delivered", "completed", {
      ...ALL_FACTS,
      closeoutCompletedAt: null,
    });
    expect(closeoutOnly.preconditions).toEqual(["closeout_required"]);
  });

  it("`cancelled` must record a cancellation reason", () => {
    const decision = refusal("in_transit", "cancelled", {
      ...ALL_FACTS,
      cancellationReason: null,
    });
    expect(decision.preconditions).toEqual(["cancellation_reason_required"]);
  });

  it("treats a blank reason as no reason (whitespace is not a justification)", () => {
    const decision = refusal("in_transit", "cancelled", {
      ...ALL_FACTS,
      cancellationReason: "   ",
    });
    expect(decision.preconditions).toEqual(["cancellation_reason_required"]);
  });

  it("`unmetPreconditions` is empty for a status with no preconditions", () => {
    expect(unmetPreconditions("in_transit", NO_TRANSITION_FACTS)).toEqual([]);
  });

  it("evaluates the edge BEFORE the preconditions", () => {
    // `in_transit → completed` is not an edge at all; the operator should be
    // told that, not that closeout is missing.
    const decision = evaluateTransition({
      from: "in_transit",
      to: "completed",
      actor: "admin",
      facts: NO_TRANSITION_FACTS,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("illegal_transition");
  });
});

/* ------------------------------------------------------------------ *
 * 5 · §19 actor gate — "carrier updates limited to approved transitions"
 * ------------------------------------------------------------------ */

describe("§19 actor gate", () => {
  it("lets admin and dispatcher assert anything the graph allows", () => {
    expect(ACTOR_PERMITTED_TARGETS.admin).toBe("*");
    expect(ACTOR_PERMITTED_TARGETS.dispatcher).toBe("*");
    for (const status of SHIPMENT_STATUSES) {
      expect(actorMayAssert("admin", status)).toBe(true);
      expect(actorMayAssert("dispatcher", status)).toBe(true);
    }
  });

  it("lets a carrier report operational progress", () => {
    for (const to of [
      "en_route_to_pickup",
      "picked_up",
      "in_transit",
      "delivered",
      "delayed",
    ] as const) {
      expect(actorMayAssert("carrier", to)).toBe(true);
    }
  });

  it("refuses a carrier the commercial statuses", () => {
    for (const to of [
      "quote_sent",
      "quote_accepted",
      "carrier_search",
      "carrier_assigned",
      "pod_uploaded",
      "completed",
      "cancelled",
    ] as const) {
      expect(actorMayAssert("carrier", to)).toBe(false);
    }
    const decision = evaluateTransition({
      from: "unloading",
      to: "cancelled",
      actor: "carrier",
      facts: ALL_FACTS,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("actor_not_permitted");
  });

  /*
   * M-76 broke the identity this test used to assert, deliberately. §13's
   * carrier list opens with "confirm dispatch" (`carrier_assigned →
   * dispatched`), which M-72 had not granted to either actor; M-76 grants it
   * to `carrier` ONLY, because confirming dispatch commits a company to
   * freight and the driver token is a leakable bearer credential in a truck.
   *
   * The assertion is therefore now the STRICT-SUBSET one, plus the single
   * named difference — which is stronger than the equality it replaces: an
   * accidental widening of `driver` fails here, and so does a second
   * divergence somebody adds without saying so.
   */
  it("gives a driver a STRICT SUBSET of the carrier's set — dispatch is the only difference", () => {
    const carrier = ACTOR_PERMITTED_TARGETS.carrier as readonly string[];
    const driver = ACTOR_PERMITTED_TARGETS.driver as readonly string[];
    for (const to of driver) expect(carrier).toContain(to);
    expect(carrier.filter((to) => !driver.includes(to))).toEqual([
      "dispatched",
    ]);
    expect(actorMayAssert("carrier", "dispatched")).toBe(true);
    expect(actorMayAssert("driver", "dispatched")).toBe(false);
    const decision = evaluateTransition({
      from: "carrier_assigned",
      to: "dispatched",
      actor: "driver",
      facts: ALL_FACTS,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("actor_not_permitted");
  });

  it("lets a shipper accept a quote and nothing else", () => {
    expect(ACTOR_PERMITTED_TARGETS.shipper).toEqual(["quote_accepted"]);
    expect(
      evaluateTransition({
        from: "quote_sent",
        to: "quote_accepted",
        actor: "shipper",
        facts: ALL_FACTS,
      }).ok,
    ).toBe(true);
    const decision = evaluateTransition({
      from: "unloading",
      to: "delivered",
      actor: "shipper",
      facts: ALL_FACTS,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("actor_not_permitted");
  });

  it("lets automation raise a delay and nothing else", () => {
    expect(ACTOR_PERMITTED_TARGETS.system).toEqual(["delayed"]);
  });

  it("reserves §20's correction flow for admins", () => {
    expect(actorMayCorrect("admin")).toBe(true);
    for (const actor of TRANSITION_ACTORS.filter((a) => a !== "admin")) {
      expect(actorMayCorrect(actor)).toBe(false);
    }
  });

  it("checks the actor AFTER the edge, so the message names the real problem", () => {
    const decision = evaluateTransition({
      from: "in_transit",
      to: "quote_accepted",
      actor: "carrier",
      facts: ALL_FACTS,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("illegal_transition");
  });
});

/* ------------------------------------------------------------------ *
 * 6 · availableTransitions — what a surface may offer
 * ------------------------------------------------------------------ */

describe("availableTransitions", () => {
  it("narrows by actor and by facts", () => {
    // A dispatcher with nothing established can still cancel — if they supply
    // a reason. With no reason, cancellation drops out of the offered set.
    expect(
      availableTransitions("carrier_search", "dispatcher", NO_TRANSITION_FACTS),
    ).toEqual([]);
    expect(
      availableTransitions("carrier_search", "dispatcher", {
        ...NO_TRANSITION_FACTS,
        activeAssignmentId: "a1",
        cancellationReason: "shipper withdrew",
      }),
    ).toEqual(["carrier_assigned", "cancelled"]);
  });

  it("offers a carrier only their own subset", () => {
    expect(availableTransitions("in_transit", "carrier", ALL_FACTS)).toEqual([
      "arrived_at_delivery",
      "delayed",
    ]);
    expect(availableTransitions("in_transit", "dispatcher", ALL_FACTS)).toEqual([
      "arrived_at_delivery",
      "delayed",
      "cancelled",
    ]);
  });

  it("offers nothing from a terminal status", () => {
    expect(availableTransitions("completed", "admin", ALL_FACTS)).toEqual([]);
    expect(availableTransitions("cancelled", "admin", ALL_FACTS)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 7 · Rejections are explainable — never a silent no-op
 * ------------------------------------------------------------------ */

describe("every rejection is typed and explainable", () => {
  it("never throws, for any ordered pair and any actor", () => {
    for (const from of SHIPMENT_STATUSES) {
      for (const to of SHIPMENT_STATUSES) {
        for (const actor of TRANSITION_ACTORS) {
          expect(() =>
            evaluateTransition({ from, to, actor, facts: NO_TRANSITION_FACTS }),
          ).not.toThrow();
        }
      }
    }
  });

  it("carries a code, the edge, the actor and a non-empty message", () => {
    const decision = evaluateTransition({
      from: "delivered",
      to: "carrier_search",
      actor: "carrier",
      facts: NO_TRANSITION_FACTS,
    });
    expect(decision).toMatchObject({
      ok: false,
      code: "illegal_transition",
      from: "delivered",
      to: "carrier_search",
      actor: "carrier",
    });
    if (!decision.ok) {
      expect(decision.message).toContain("delivered → carrier_search");
    }
  });

  it("lists the legal alternatives in the illegal-transition message", () => {
    const decision = evaluateTransition({
      from: "loading",
      to: "delivered",
      actor: "dispatcher",
      facts: ALL_FACTS,
    });
    if (decision.ok) throw new Error("expected a refusal");
    expect(decision.message).toContain("picked_up");
  });
});

/* ------------------------------------------------------------------ *
 * 8 · Drift guard — 0019's RLS bands vs `dto.ts`'s audience matrix
 * ------------------------------------------------------------------ */

describe("§7 visibility bands are written once", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL(
        "../../supabase/migrations/0019_shipment_events.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  /**
   * Migration 0019's three customer policies each carry a
   * `visibility in ('…','…')` list. `dto.ts` carries the same rule as
   * `AUDIENCE_EVENT_VISIBILITY`. Two copies of §7's model is one too many, so
   * this parses the SQL and compares. If either side is widened, this fails.
   */
  function policyBands(role: "shipper" | "carrier" | "broker"): string[] {
    const marker = `create policy "${role} member read shipment events"`;
    const start = migration.indexOf(marker);
    expect(start, `policy for ${role} not found in 0019`).toBeGreaterThan(-1);
    const body = migration.slice(start, start + 600);
    const match = body.match(/visibility in \(([^)]*)\)/);
    expect(match, `no visibility list in the ${role} policy`).not.toBeNull();
    return (match?.[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
  }

  for (const role of ["shipper", "carrier", "broker"] as const) {
    it(`0019's ${role} policy matches AUDIENCE_EVENT_VISIBILITY.${role}`, () => {
      expect(policyBands(role).sort()).toEqual(
        [...AUDIENCE_EVENT_VISIBILITY[role]].sort(),
      );
    });
  }

  it("no customer policy in 0019 mentions staff_only (§7's absolute rule)", () => {
    for (const role of ["shipper", "carrier", "broker"] as const) {
      expect(policyBands(role)).not.toContain("staff_only");
    }
  });

  it("0019 creates no anon policy (§19)", () => {
    expect(migration).not.toMatch(/create policy[^;]*\bto anon\b/);
    expect(migration).not.toMatch(/for select\s+to anon/);
  });

  it("0019 grants EXECUTE on the write functions to service_role only", () => {
    const grants = migration.match(/grant execute on function[\s\S]*?;/g) ?? [];
    expect(grants.length).toBe(5);
    for (const grant of grants) {
      expect(grant).toContain("to service_role");
      expect(grant).not.toContain("authenticated");
      expect(grant).not.toContain("anon");
    }
  });
});
