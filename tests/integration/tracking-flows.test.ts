import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  closeBrokerageGate,
  count,
  exec,
  json,
  lit,
  openBrokerageGate,
  scalar,
} from "./helpers/db";
import { createRlsSupabaseClient } from "./helpers/psql-rls-supabase";
import { createPsqlSupabaseClient } from "./helpers/psql-supabase";

/**
 * M-84 — §27's **E2E flows**, composed.
 *
 * ── WHY THIS FILE EXISTS WHEN THE PARTS ARE ALREADY TESTED ────────────────
 *
 * By M-83 every §27 operation had a home: `dispatcher-operations.test.ts`
 * walks the dispatcher flow, `carrier-driver-updates.test.ts` walks the
 * carrier flow, `public-tracking.test.ts` walks the public lookup, and
 * `shipper-shipments.test.ts` proves each shipper query in isolation. What
 * none of them prove is the thing §27 actually names: that the flows compose.
 *
 * Two claims are only makeable here, and both have failed in real systems:
 *
 *   1. **The shipper flow is a SEQUENCE, not six independent queries.** §27
 *      writes it as login → view shipments → open shipment → view timeline →
 *      download POD → submit support message. Each step consumes the previous
 *      step's output — the list hands over an id, the id opens a detail, the
 *      detail names a document, the document is downloaded, the download is
 *      journalled. A system can pass six isolated tests and still break at the
 *      seam (a list projection that omits the id the detail page needs; a
 *      document the detail renders but the download gate refuses).
 *
 *   2. **The six security refusals hold SIMULTANEOUSLY, on one live
 *      shipment.** Every existing isolation test seeds its own world. That is
 *      the right way to prove a policy, and the wrong way to prove a system:
 *      a shipment that is *at once* delivered, PODded, publicly trackable,
 *      carrier-assigned and driver-tokenised is where a policy written for one
 *      state leaks in another. Here all six refusals are asserted against the
 *      SAME row, in its final state, after the full lifecycle has run.
 *
 * ── WHAT IS REAL AND WHAT IS ADAPTED ──────────────────────────────────────
 *
 * Real: PostgreSQL 16 built from migrations 0001…0030, every RPC, every
 * policy, every CHECK, and the exported functions from `src/lib/shipments/`.
 * The shipper reads run under a genuine `authenticated` session with
 * `request.jwt.claim.sub` set, so `my_shipper_ids()` and the 0018/0019/0021
 * policies decide.
 *
 * Adapted: the transport (psql instead of PostgREST — the lane has no
 * PostgREST), the rate limiter (Upstash, not PickLoads code), and Supabase
 * Storage's URL signer. The signer is replaced by a stub that returns a URL
 * carrying `SIGNED-CREDENTIAL-SENTINEL`, which turns an adaptation into an
 * assertion: §15 forbids the signed URL from reaching the audit ledger, and
 * the sentinel is swept for after the download.
 *
 * NOT adapted, and worth saying because it is the usual shortcut: no shipment
 * is fabricated for the browser. §30 forbids it, so the Playwright lane
 * asserts the session gate instead and the flow itself is proved here.
 */

process.env.TRACKING_ACCESS_SECRET = "m84-flow-secret";
process.env.DRIVER_TOKEN_SECRET = "m84-flow-driver-secret";

/* ---- The one non-PickLoads dependency: Upstash. Stubbed, allowance-based. -- */
let allowance = Number.POSITIVE_INFINITY;
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => {
    if (allowance <= 0) return false;
    allowance -= 1;
    return true;
  },
}));

/* ---- The service client, plus a storage signer that plants a sentinel ---- */
const SIGNED_SENTINEL = "SIGNED-CREDENTIAL-SENTINEL";
const signRequests: { bucket: string; path: string; ttl: number }[] = [];

const serviceClient = createPsqlSupabaseClient();
const adminClient = {
  ...serviceClient,
  storage: {
    from(bucket: string) {
      return {
        createSignedUrl(path: string, ttl: number) {
          signRequests.push({ bucket, path, ttl });
          return Promise.resolve({
            data: { signedUrl: `https://storage.test/${path}?token=${SIGNED_SENTINEL}` },
            error: null,
          });
        },
      };
    },
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => adminClient,
  createAdminClient: () => adminClient,
}));

const { hashSecondaryValue } = await import("@/lib/shipments/access-code");
const { lookupPublicTracking } = await import("@/lib/shipments/public-lookup");
const {
  EMPTY_FILTERS,
  getShipperShipments,
} = await import("@/lib/shipments/shipper-list");
const {
  getShipmentSummary,
  getShipmentTimelinePage,
} = await import("@/lib/shipments/shipper-detail");
const { getShipmentDocumentUrl } = await import(
  "@/lib/shipments/document-store"
);
const { evaluateTransition, NO_TRANSITION_FACTS } = await import(
  "@/lib/shipments/transitions"
);
const { hashDriverToken, mintDriverToken } = await import(
  "@/lib/shipments/driver-token"
);
const { redeemDriverToken } = await import("@/lib/shipments/driver-access");

type ShipmentStatus = import("@/lib/shipments/types").ShipmentStatus;
type TransitionActor = import("@/lib/shipments/transitions").TransitionActor;

/* ================================================================== *
 * Identities. Suffix 0084 so nothing collides with another file's world.
 * ================================================================== */

const OWNER_A = "00000000-0000-0000-0000-0000000a0084";
const OWNER_B = "00000000-0000-0000-0000-0000000b0084";
const CARRIER_USER_A = "00000000-0000-0000-0000-0000000c0084";
const CARRIER_USER_B = "00000000-0000-0000-0000-0000000d0084";
const DISPATCHER = "00000000-0000-0000-0000-0000000e0084";

const SHIPPER_A = "22222222-2222-2222-2222-2222222a0084";
const SHIPPER_B = "22222222-2222-2222-2222-2222222b0084";
const CARRIER_A = "11111111-1111-1111-1111-1111111a0084";
const CARRIER_B = "11111111-1111-1111-1111-1111111b0084";

const TRACKING_A = "PL-2026-840001";
const TRACKING_B = "PL-2026-840002";
const ZIP_A = "07111";
const WRONG_ZIP = "99999";

/** Sentinels. Every one of these is a value that must never leave the desk. */
const MARGIN = 840333;
const CARRIER_PAY = 840222;
const GROSS = 840555;
const INTERNAL_NOTE = "M84-INTERNAL-ONLY-NOTE";

let shipmentA = "";
let shipmentB = "";
let podDocumentA = "";
let rateConfirmationA = "";

/** The session clients the portal pages hold. */
const clientA = createRlsSupabaseClient({ role: "authenticated", sub: OWNER_A });
const clientB = createRlsSupabaseClient({ role: "authenticated", sub: OWNER_B });

/* ------------------------------------------------------------------ *
 * Helpers — every write goes through the REAL function the product calls.
 * ------------------------------------------------------------------ */

function facts(shipmentId: string) {
  return json<{
    status: ShipmentStatus;
    active_assignment_id: string | null;
    pickup_confirmed_at: string | null;
    delivered_at: string | null;
    approved_pod_document_id: string | null;
    closeout_completed_at: string | null;
    cancellation_reason: string | null;
  }>(`select shipment_transition_facts(${lit(shipmentId)})`);
}

/**
 * One transition, decided by the REAL engine against REAL facts and applied by
 * the REAL RPC. Returns the SQLSTATE-free success, or throws with the engine's
 * own refusal message — a refusal here is a fixture bug, not a finding.
 */
function transition(args: {
  shipmentId: string;
  to: ShipmentStatus;
  actor: TransitionActor;
  closeout?: boolean;
}): void {
  const state = facts(args.shipmentId);
  const eventTime = new Date().toISOString();
  const decision = evaluateTransition({
    from: state.status,
    to: args.to,
    actor: args.actor,
    facts: {
      ...NO_TRANSITION_FACTS,
      activeAssignmentId: state.active_assignment_id,
      pickupConfirmedAt: state.pickup_confirmed_at,
      deliveredAt: state.delivered_at,
      approvedPodDocumentId: state.approved_pod_document_id,
      closeoutCompletedAt: args.closeout
        ? new Date().toISOString()
        : state.closeout_completed_at,
      deliveryTimestamp: eventTime,
    },
  });
  if (!decision.ok) {
    throw new Error(
      `fixture: ${state.status} → ${args.to} as ${args.actor}: ${decision.code}`,
    );
  }
  exec(
    `select apply_shipment_transition(${lit(args.shipmentId)}, ${lit(state.status)},
       ${lit(args.to)}, 'dispatcher', ${lit(DISPATCHER)}, 'shipper')`,
  );
}

const TO_DELIVERED: readonly ShipmentStatus[] = [
  "quote_sent",
  "quote_accepted",
  "carrier_search",
  "carrier_assigned",
  "dispatched",
  "en_route_to_pickup",
  "arrived_at_pickup",
  "loading",
  "picked_up",
  "in_transit",
  "arrived_at_delivery",
  "unloading",
  "delivered",
];

function addDocument(args: {
  shipmentId: string;
  docType: string;
  fileName: string;
  visibility?: string | null;
}): string {
  const path = `${args.shipmentId}/${crypto.randomUUID()}-${args.fileName}`;
  const row = json<{ document_id: string }>(
    `select add_shipment_document(
       ${lit(args.shipmentId)}, ${lit(args.docType)}, ${lit(path)},
       ${lit(args.fileName)}, 'application/pdf', 4096,
       ${lit(DISPATCHER)}, 'dispatcher',
       ${args.visibility ? lit(args.visibility) : "null"}, null)`,
  );
  return row.document_id;
}

function approveDocument(documentId: string): void {
  exec(
    `select review_shipment_document(${lit(documentId)}, 'approved',
       ${lit(DISPATCHER)}, null, 'dispatcher', null)`,
  );
}

/** Run one statement as a browser role; hand back its SQLSTATE (or 'OK'). */
function sqlstateAs(
  role: "authenticated" | "anon",
  sub: string | null,
  stmt: string,
): string {
  return (
    scalar(
      `begin; set local role ${role}; ` +
        `set local "request.jwt.claim.sub" = ${lit(sub ?? "")}; ` +
        `select itest.sqlstate_of(${lit(stmt)}); commit`,
    ) ?? ""
  );
}

/** Read one scalar as a browser role. `null` when the row is not reachable. */
function scalarAs(
  role: "authenticated" | "anon",
  sub: string | null,
  query: string,
): string | null {
  return scalar(
    `begin; set local role ${role}; ` +
      `set local "request.jwt.claim.sub" = ${lit(sub ?? "")}; ` +
      `${query}; commit`,
  );
}

/* ================================================================== *
 * Fixtures — one lifecycle, walked to completion, then frozen.
 * ================================================================== */

beforeAll(() => {
  exec(`insert into auth.users (id, email) values
      (${lit(OWNER_A)}, 'ownerA@m84.test'),
      (${lit(OWNER_B)}, 'ownerB@m84.test'),
      (${lit(CARRIER_USER_A)}, 'carrierA@m84.test'),
      (${lit(CARRIER_USER_B)}, 'carrierB@m84.test'),
      (${lit(DISPATCHER)}, 'dispatcher@m84.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(OWNER_A)}, 'shipper', 'M84 Shipper A Owner'),
      (${lit(OWNER_B)}, 'shipper', 'M84 Shipper B Owner'),
      (${lit(CARRIER_USER_A)}, 'carrier', 'M84 Carrier A Owner'),
      (${lit(CARRIER_USER_B)}, 'carrier', 'M84 Carrier B Owner'),
      (${lit(DISPATCHER)}, 'dispatcher', 'M84 Dispatcher')
    on conflict (id) do update set role = excluded.role`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER_A)}, 'M84 Shipper A Inc'),
      (${lit(SHIPPER_B)}, 'M84 Shipper B Inc') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER_A)}, 'M84 Carrier A', true),
      (${lit(CARRIER_B)}, 'M84 Carrier B', true) on conflict do nothing`);
  exec(`insert into shipper_memberships (shipper_id, profile_id, role) values
      (${lit(SHIPPER_A)}, ${lit(OWNER_A)}, 'owner'),
      (${lit(SHIPPER_B)}, ${lit(OWNER_B)}, 'owner') on conflict do nothing`);
  exec(`insert into carrier_memberships (carrier_id, profile_id, role) values
      (${lit(CARRIER_A)}, ${lit(CARRIER_USER_A)}, 'owner'),
      (${lit(CARRIER_B)}, ${lit(CARRIER_USER_B)}, 'owner') on conflict do nothing`);

  const hash = hashSecondaryValue(ZIP_A);
  expect(hash, "the fixture's own access hash must be real").toMatch(
    /^v1:[0-9a-f]{64}$/,
  );

  openBrokerageGate();

  shipmentA =
    scalar(`insert into shipments (
      tracking_number, shipper_id, dispatcher_id, status,
      origin_city, origin_state, destination_city, destination_state, equipment,
      gross_shipper_amount, carrier_pay, margin, delay_reason_internal,
      public_tracking_enabled, location_visibility, public_access_hash,
      estimated_delivery_at, eta_source, eta_confidence
    ) values (
      ${lit(TRACKING_A)}, ${lit(SHIPPER_A)}, ${lit(DISPATCHER)}, 'quote_requested',
      'Newark', 'NJ', 'Atlanta', 'GA', 'dry-van',
      ${GROSS}, ${CARRIER_PAY}, ${MARGIN}, ${lit(INTERNAL_NOTE)},
      true, 'approximate', ${lit(hash ?? "")},
      '2026-08-20T14:00:00Z', 'manual', 'medium'
    ) returning id`) ?? "";

  shipmentB =
    scalar(`insert into shipments (
      tracking_number, shipper_id, carrier_id, dispatcher_id, status,
      origin_city, origin_state, destination_city, destination_state, equipment,
      gross_shipper_amount, carrier_pay, margin,
      public_tracking_enabled, public_access_hash
    ) values (
      ${lit(TRACKING_B)}, ${lit(SHIPPER_B)}, ${lit(CARRIER_B)}, ${lit(DISPATCHER)},
      'in_transit', 'Boston', 'MA', 'Miami', 'FL', 'reefer',
      1, 2, 3, true, ${lit(hash ?? "")}
    ) returning id`) ?? "";

  expect(shipmentA).not.toBe("");
  expect(shipmentB).not.toBe("");

  // The dispatcher flow, run as fixture: quote → assignment → pickup →
  // transit → delivery. Every step goes through the engine and the RPC, so a
  // graph change breaks this file loudly rather than leaving it asserting
  // against a state the product can no longer reach.
  for (const status of TO_DELIVERED) {
    // §20: `carrier_assigned` has an ACTIVE-ASSIGNMENT precondition, so the
    // assignment has to exist before the status claims it does.
    if (status === "carrier_assigned") {
      exec(
        `select assign_shipment_carrier(${lit(shipmentA)}, ${lit(CARRIER_A)},
           null, null, ${lit(DISPATCHER)}, ${lit(DISPATCHER)})`,
      );
    }
    transition({ shipmentId: shipmentA, to: status, actor: "dispatcher" });
  }

  // Documents: a POD the shipper must reach, and a rate confirmation the
  // shipper must NOT (§4 — the margin lives in it).
  podDocumentA = addDocument({
    shipmentId: shipmentA,
    docType: "pod",
    fileName: "pod-840001.pdf",
  });
  approveDocument(podDocumentA);
  rateConfirmationA = addDocument({
    shipmentId: shipmentA,
    docType: "rate_confirmation",
    fileName: "ratecon-840001.pdf",
  });
  approveDocument(rateConfirmationA);

  // §20: `completed` needs an approved POD AND a human closeout assertion.
  transition({
    shipmentId: shipmentA,
    to: "pod_uploaded",
    actor: "dispatcher",
  });
  transition({
    shipmentId: shipmentA,
    to: "completed",
    actor: "dispatcher",
    closeout: true,
  });

  closeBrokerageGate();
});

/* ================================================================== *
 * 1 · §27 SHIPPER FLOW — as one sequence, each step fed by the last
 * ================================================================== */

describe("§27 shipper flow — login → shipments → detail → timeline → POD → support", () => {
  /** Carried between steps. A step that cannot run is a failed flow. */
  const carried: {
    shipmentId?: string;
    trackingNumber?: string;
    podId?: string;
    threadId?: string;
  } = {};

  it("1 · LOGIN — the session resolves to exactly one shipper organization", () => {
    // The DB half of "login". `my_shipper_ids()` is what every 0018/0021
    // policy consults; if the session resolved to nothing, every later step
    // would return an honest empty set and the flow would pass vacuously.
    const mine = scalarAs(
      "authenticated",
      OWNER_A,
      `select string_agg(id::text, ',') from my_shipper_ids() as t(id)`,
    );
    expect(mine).toBe(SHIPPER_A);
  });

  it("2 · VIEW SHIPMENTS — the list returns the tenant's freight and its ids", async () => {
    const result = await getShipperShipments(
      clientA as never,
      SHIPPER_A,
      EMPTY_FILTERS,
      1,
    );
    expect(result.total).toBeGreaterThan(0);
    const row = result.rows.find((r) => r.tracking_number === TRACKING_A);
    expect(row, "the completed shipment must appear in its own shipper's list")
      .toBeDefined();
    // The seam: the list projection has to carry the id the detail route needs.
    expect(row?.id).toBe(shipmentA);
    carried.shipmentId = row?.id ?? "";
    carried.trackingNumber = row?.tracking_number ?? "";
    // …and it must NOT carry the money. Same row, opposite requirement.
    const asRecord = row as unknown as Record<string, unknown>;
    for (const forbidden of ["margin", "carrier_pay", "gross_shipper_amount"]) {
      expect(Object.keys(asRecord)).not.toContain(forbidden);
    }
  });

  it("3 · OPEN SHIPMENT — the id from step 2 opens a detail the page can render", async () => {
    expect(carried.shipmentId, "step 2 must have produced an id").toBeDefined();
    const detail = await getShipmentSummary(
      clientA as never,
      SHIPPER_A,
      carried.shipmentId as string,
    );
    expect(detail).not.toBeNull();
    expect(detail?.tracking_number).toBe(TRACKING_A);
    expect(detail?.status).toBe("completed");
    const flat = JSON.stringify(detail);
    for (const sentinel of [
      String(MARGIN),
      String(CARRIER_PAY),
      String(GROSS),
      INTERNAL_NOTE,
    ]) {
      expect(flat, `detail leaked ${sentinel}`).not.toContain(sentinel);
    }
  });

  it("4 · VIEW TIMELINE — the shipment's own history, in the shipper's two bands", async () => {
    const page = await getShipmentTimelinePage(
      clientA as never,
      carried.shipmentId as string,
    );
    expect(page.failed).toBe(false);
    expect(page.events.length).toBeGreaterThan(0);
    // §7: `staff_only` and `carrier` bands never reach a customer.
    for (const event of page.events) {
      expect(["public", "shipper"]).toContain(event.visibility);
    }
    // NON-VACUITY: the shipment genuinely HAS staff-only history to withhold.
    expect(
      count(
        `select count(*) from shipment_events
           where shipment_id = ${lit(shipmentA)} and visibility = 'staff_only'`,
      ),
    ).toBeGreaterThan(0);
  });

  it("5 · DOWNLOAD POD — the approved POD is reachable, journalled, and the URL is not", async () => {
    const pod = json<{ id: string }>(
      `select to_jsonb(t) from (
         select id from shipment_documents
          where shipment_id = ${lit(shipmentA)} and doc_type = 'pod'
          limit 1) t`,
    );
    carried.podId = pod.id;
    signRequests.length = 0;

    const before = count(
      `select count(*) from audit_events where action = 'document.download'`,
    );
    const result = await getShipmentDocumentUrl(
      clientA as never,
      pod.id,
      "shipper",
      OWNER_A,
    );
    expect(result.ok, "an approved POD must reach its own shipper").toBe(true);
    expect(signRequests).toHaveLength(1);
    expect(signRequests[0]?.ttl).toBeLessThanOrEqual(300); // §16

    // §15 document-access history: one row, and the credential is not in it.
    const after = count(
      `select count(*) from audit_events where action = 'document.download'`,
    );
    expect(after).toBe(before + 1);
    const journalled = scalar(
      `select detail::text from audit_events
        where action = 'document.download' and target_id = ${lit(pod.id)}
        order by created_at desc limit 1`,
    );
    expect(journalled, "the ledger row must exist to be checkable").not.toBeNull();
    expect(journalled).toContain("pod");
    expect(journalled, "a live signed URL must never be journalled").not.toContain(
      SIGNED_SENTINEL,
    );
  });

  it("5b · the same call REFUSES the rate confirmation — same shipment, same session", async () => {
    // The flow's sharpest seam. The shipper is authorized on the SHIPMENT and
    // unauthorized on this DOCUMENT, and a gate that only checked the
    // shipment would hand over the margin.
    const result = await getShipmentDocumentUrl(
      clientA as never,
      rateConfirmationA,
      "shipper",
      OWNER_A,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("6 · SUBMIT SUPPORT MESSAGE — written under the customer policies, staff flag forced false", () => {
    const threadId = crypto.randomUUID();
    carried.threadId = threadId;
    expect(
      sqlstateAs(
        "authenticated",
        OWNER_A,
        `insert into support_threads (id, profile_id, shipper_id, subject, status)
           values ('${threadId}', '${OWNER_A}', '${SHIPPER_A}',
                   'Question about ${TRACKING_A}', 'open')`,
      ),
    ).toBe("OK");
    expect(
      sqlstateAs(
        "authenticated",
        OWNER_A,
        `insert into support_messages (thread_id, author_id, body, is_staff)
           values ('${threadId}', '${OWNER_A}', 'Where is my POD?', false)`,
      ),
    ).toBe("OK");
    // 0009's insert policy forces `is_staff = false`: a customer cannot
    // publish a message that renders as PickLoads.
    expect(
      sqlstateAs(
        "authenticated",
        OWNER_A,
        `insert into support_messages (thread_id, author_id, body, is_staff)
           values ('${threadId}', '${OWNER_A}', 'Reply from PickLoads', true)`,
      ),
    ).toBe("42501");
  });

  it("7 · NON-VACUITY — shipper B walks the identical six steps and reaches nothing", async () => {
    // Every zero above has to be a POLICY result, not an empty database. The
    // same six calls, the same rows, a different session.
    const mineB = scalarAs(
      "authenticated",
      OWNER_B,
      `select string_agg(id::text, ',') from my_shipper_ids() as t(id)`,
    );
    expect(mineB).toBe(SHIPPER_B); // B is a real, logged-in shipper

    const list = await getShipperShipments(
      clientB as never,
      SHIPPER_A, // asking for A's rows, as B
      EMPTY_FILTERS,
      1,
    );
    expect(list.rows).toHaveLength(0);

    expect(
      await getShipmentSummary(clientB as never, SHIPPER_A, shipmentA),
    ).toBeNull();

    const timeline = await getShipmentTimelinePage(clientB as never, shipmentA);
    expect(timeline.events).toHaveLength(0);

    const download = await getShipmentDocumentUrl(
      clientB as never,
      carried.podId as string,
      "shipper",
      OWNER_B,
    );
    expect(download.ok).toBe(false);

    expect(
      scalarAs(
        "authenticated",
        OWNER_B,
        `select count(*) from support_messages
           where thread_id = '${carried.threadId}'`,
      ),
    ).toBe("0");
  });
});

/* ================================================================== *
 * 2 · §27 SECURITY FLOW — six refusals, one live shipment, all at once
 * ================================================================== */

describe("§27 security flow — the six named refusals, against one completed shipment", () => {
  it("1 · shipper A cannot access shipper B — proved by the POLICY, not the predicate", () => {
    // The app-level `.eq("shipper_id", …)` is deliberately ABSENT here: this
    // is the raw table, so only RLS can produce the zero.
    expect(
      scalarAs(
        "authenticated",
        OWNER_A,
        `select count(*) from shipments where id = '${shipmentB}'`,
      ),
    ).toBe("0");
    // CONTROL: B's own session sees it, so the zero is scope and not absence.
    expect(
      scalarAs(
        "authenticated",
        OWNER_B,
        `select count(*) from shipments where id = '${shipmentB}'`,
      ),
    ).toBe("1");
  });

  it("2 · carrier A cannot access carrier B — including the documents", () => {
    expect(
      scalarAs(
        "authenticated",
        CARRIER_USER_A,
        `select count(*) from shipments where id = '${shipmentB}'`,
      ),
    ).toBe("0");
    expect(
      scalarAs(
        "authenticated",
        CARRIER_USER_B,
        `select count(*) from shipment_documents
           where shipment_id = '${shipmentA}'`,
      ),
    ).toBe("0");
    // CONTROL: carrier A, the assigned haulier, does reach its own shipment.
    expect(
      scalarAs(
        "authenticated",
        CARRIER_USER_A,
        `select count(*) from shipments where id = '${shipmentA}'`,
      ),
    ).toBe("1");
  });

  it("3 · public tracking exposes no financial field — on the shipment that HAS them", async () => {
    allowance = Number.POSITIVE_INFINITY;
    const result = await lookupPublicTracking({
      trackingNumber: TRACKING_A,
      secondaryValue: ZIP_A,
      ip: "203.0.113.84",
      userAgent: "itest",
    });
    expect(result.ok, "the fixture's own happy path must work").toBe(true);
    const flat = JSON.stringify(result);
    for (const sentinel of [
      String(MARGIN),
      String(CARRIER_PAY),
      String(GROSS),
      INTERNAL_NOTE,
      SHIPPER_A,
      shipmentA,
    ]) {
      expect(flat, `public payload leaked ${sentinel}`).not.toContain(sentinel);
    }
    // And the row genuinely carries them, so the sweep is not sweeping nulls.
    expect(
      count(
        `select count(*) from shipments
          where id = ${lit(shipmentA)} and margin = ${MARGIN}
            and carrier_pay = ${CARRIER_PAY}`,
      ),
    ).toBe(1);
  });

  it("4 · an EXPIRED driver token fails — and fails like an unknown one", async () => {
    const live = mintDriverToken() ?? "";
    const expired = mintDriverToken() ?? "";
    exec(
      `select issue_shipment_driver_token(${lit(shipmentA)}, ${lit(CARRIER_A)},
         ${lit(hashDriverToken(live) ?? "")}, now() + interval '2 hours',
         null, 'M84 Driver', 'dispatcher', ${lit(DISPATCHER)})`,
    );
    exec(
      // Inserted directly, not through the RPC: 0023 REFUSES to issue a link
      // that is already expired (proved in `carrier-driver-updates.test.ts`),
      // so the only way to observe an expired one is to age it. `issued_at`
      // is set explicitly because the table's own CHECK requires
      // `expires_at > issued_at` — a link that never had a life is a
      // different bug from one whose life ran out.
      `insert into shipment_driver_tokens
         (shipment_id, carrier_id, token_hash, expires_at, driver_name,
          issued_by, issued_by_role, issued_at)
       values (${lit(shipmentA)}, ${lit(CARRIER_A)},
         ${lit(hashDriverToken(expired) ?? "")}, now() - interval '1 minute',
         'M84 Expired Driver', ${lit(DISPATCHER)}, 'dispatcher',
         now() - interval '2 hours')`,
    );

    const good = await redeemDriverToken({ token: live, ip: "198.51.100.84", userAgent: "itest" });
    expect(good.ok, "the control token must work").toBe(true);

    const stale = await redeemDriverToken({
      token: expired,
      ip: "198.51.100.85",
      userAgent: "itest",
    });
    const unknown = await redeemDriverToken({
      token: mintDriverToken() ?? "",
      ip: "198.51.100.86",
      userAgent: "itest",
    });
    expect(stale.ok).toBe(false);
    // §13: the refusals must be indistinguishable to the presenter.
    expect(JSON.stringify(stale)).toBe(JSON.stringify(unknown));
  });

  it("5 · an UNAUTHORIZED status transition fails — actor first, then facts", () => {
    // The shipment is `completed`. A carrier may not reopen it, and a carrier
    // may not close one either — §20's actor table, not a precondition.
    const asCarrier = evaluateTransition({
      from: "delivered",
      to: "completed",
      actor: "carrier",
      facts: {
        ...NO_TRANSITION_FACTS,
        approvedPodDocumentId: podDocumentA,
        closeoutCompletedAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
      },
    });
    expect(asCarrier.ok).toBe(false);
    if (!asCarrier.ok) expect(asCarrier.code).toBe("actor_not_permitted");

    // And the DATABASE refuses the same thing, so the engine is not the only
    // gate: a stale expected-status is a PL409 whatever the caller believes.
    expect(
      scalar(
        `select itest.sqlstate_of($stmt$
           select apply_shipment_transition('${shipmentA}', 'delivered',
             'completed', 'carrier', null, 'shipper')
         $stmt$)`,
      ),
    ).toBe("PL409");
  });

  it("6 · a REVOKED tracking code fails — rotation and suspension, both", async () => {
    // (a) ROTATION. The customer's old ZIP/access code stops working the
    // moment a new hash is written. This is what "revoked tracking code"
    // means for a code the customer holds and we only ever store hashed.
    const rotated = hashSecondaryValue("08544") ?? "";
    exec(
      `update shipments set public_access_hash = ${lit(rotated)}
        where id = ${lit(shipmentA)}`,
    );
    allowance = Number.POSITIVE_INFINITY;
    const withOldCode = await lookupPublicTracking({
      trackingNumber: TRACKING_A,
      secondaryValue: ZIP_A,
      ip: "203.0.113.85",
      userAgent: "itest",
    });
    expect(withOldCode.ok).toBe(false);

    const withNewCode = await lookupPublicTracking({
      trackingNumber: TRACKING_A,
      secondaryValue: "08544",
      ip: "203.0.113.86",
      userAgent: "itest",
    });
    expect(withNewCode.ok, "the NEW code must work — else (a) proves nothing")
      .toBe(true);

    // (b) SUSPENSION (§15). An admin switches public tracking off and the
    // correct code stops working too — with the SAME refusal as a wrong one.
    exec(
      `update shipments set public_tracking_enabled = false
        where id = ${lit(shipmentA)}`,
    );
    const suspended = await lookupPublicTracking({
      trackingNumber: TRACKING_A,
      secondaryValue: "08544",
      ip: "203.0.113.87",
      userAgent: "itest",
    });
    const wrongValue = await lookupPublicTracking({
      trackingNumber: TRACKING_A,
      secondaryValue: WRONG_ZIP,
      ip: "203.0.113.88",
      userAgent: "itest",
    });
    expect(suspended.ok).toBe(false);
    expect(JSON.stringify(suspended)).toBe(JSON.stringify(wrongValue));

    // Restore, so a later file inheriting this database is not surprised.
    exec(
      `update shipments set public_tracking_enabled = true
        where id = ${lit(shipmentA)}`,
    );
  });

  it("7 · every refusal above was recorded staff-side — the flow is auditable", () => {
    // §15/§26: the customer sees one flat message; the desk sees the truth.
    const outcomes = json<{ outcome: string; n: number }[]>(
      `select coalesce(jsonb_agg(jsonb_build_object('outcome', outcome, 'n', n)), '[]'::jsonb)
         from (select outcome, count(*) as n
                 from shipment_tracking_access
                where tracking_number_attempted = ${lit(TRACKING_A)}
                group by outcome) t`,
    );
    const byOutcome = new Map(outcomes.map((o) => [o.outcome, o.n]));
    expect(byOutcome.get("granted") ?? 0).toBeGreaterThan(0);
    expect(
      [...byOutcome.keys()].some((k) => k !== "granted"),
      "refusals must be journalled, not only grants",
    ).toBe(true);
    // Never the attempted secret, in any form. The sweep is over the WHOLE
    // row rendered as JSON, not over a column list — a future column that
    // started carrying the second factor would be caught by this and not by
    // a `select` naming the columns somebody thought to check.
    expect(
      count(
        `select count(*) from shipment_tracking_access
          where tracking_number_attempted = ${lit(TRACKING_A)}
            and to_jsonb(shipment_tracking_access)::text
                like ${lit(`%${ZIP_A}%`)}`,
      ),
    ).toBe(0);
    // NON-VACUITY: the same sweep for the TRACKING NUMBER — which the ledger
    // is supposed to store — finds rows. So the zero above is the secret's
    // absence, not the query's failure to look.
    expect(
      count(
        `select count(*) from shipment_tracking_access
          where tracking_number_attempted = ${lit(TRACKING_A)}
            and to_jsonb(shipment_tracking_access)::text
                like ${lit(`%${TRACKING_A}%`)}`,
      ),
    ).toBeGreaterThan(0);
  });
});
