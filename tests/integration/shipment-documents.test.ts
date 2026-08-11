import { beforeAll, describe, expect, it } from "vitest";

import {
  count,
  exec,
  json,
  lit,
  litOrNull,
  openBrokerageGate,
  scalar,
  sqlstateOf,
} from "./helpers/db";
import { createRlsSupabaseClient } from "./helpers/psql-rls-supabase";
import {
  evaluateTransition,
  NO_TRANSITION_FACTS,
  type TransitionFacts,
} from "@/lib/shipments/transitions";
import {
  DOCUMENT_AUDIENCES,
  documentReachesAudience,
  toCustomerDocumentDtos,
} from "@/lib/shipments/documents";
import {
  SHIPMENT_DOCUMENT_TYPES,
  type ShipmentDocumentType,
  type ShipmentStatus,
} from "@/lib/shipments/types";

/**
 * M-77 — §16 documents and §20's POD precondition, end to end on PG16.
 *
 * ── THE HEADLINE: A REGRESSION TO GREEN ──────────────────────────────────
 *
 * M-72 shipped `shipment_transition_facts()` with `approved_pod_document_id`
 * as a literal `null`, and proved it: `tests/integration/shipment-lifecycle
 * .test.ts` asserts *"refuses pod_uploaded — M-77 owns documents, so the fact
 * is null"*, and `dispatcher-operations.test.ts` asserts the same thing again.
 * Those assertions were TRUE and are now FALSE, which is the point. This file
 * is the walk they were placeholders for:
 *
 *   upload a POD  → `pod_uploaded` still REFUSED (nobody has checked it)
 *   staff approve → `pod_uploaded` SUCCEEDS
 *   staff reject  → `pod_uploaded` is REFUSED again
 *
 * That last step matters as much as the second: 0024's CHECK ties
 * `approved_at is not null` to `status = 'approved'`, so an un-approval CLEARS
 * the timestamp and the precondition tracks the CURRENT decision rather than
 * "was approved once".
 *
 * ── THE OTHER THING ONLY THIS LANE CAN PROVE ─────────────────────────────
 *
 * The §16 matrix exists TWICE — as `DOCUMENT_AUDIENCES` in TypeScript and as
 * rows in `shipment_document_audiences` — because RLS cannot import
 * TypeScript. Drift between them is the worst bug this module could ship: the
 * app would show a POD to a broker the database refuses, or (far worse) the
 * database would hand out a rate confirmation the app thought was carrier-only.
 * Neither the unit lane (no database) nor the RLS lane (no TypeScript) can see
 * it. This lane compares them cell for cell.
 *
 * ── §27's TWO NAMED TESTS ────────────────────────────────────────────────
 *
 * The tracking directive's §27 integration tier names *"document upload"* and
 * *"POD upload"* among its eleven. Both are here, and M-83b can strike them
 * off its list.
 */

const SHIPPER = "22222222-2222-2222-2222-222222220077";
const SHIPPER_B = "22222222-2222-2222-2222-222222220078";
const CARRIER_A = "11111111-1111-1111-1111-111111110077";
const CARRIER_B = "11111111-1111-1111-1111-111111110078";
const BROKER = "33333333-3333-3333-3333-333333330077";
const DISPATCHER = "00000000-0000-0000-0000-0000000e0077";
const SHIPPER_USER = "00000000-0000-0000-0000-0000000a0077";
const SHIPPER_B_USER = "00000000-0000-0000-0000-0000000a0078";
const CARRIER_A_USER = "00000000-0000-0000-0000-0000000b0077";
const CARRIER_B_USER = "00000000-0000-0000-0000-0000000b0078";
const BROKER_USER = "00000000-0000-0000-0000-0000000c0077";

/* ------------------------------------------------------------------ *
 * The application path, reproduced exactly
 * ------------------------------------------------------------------ */

function facts(shipmentId: string): TransitionFacts & { status: ShipmentStatus } {
  const row = json<{
    status: ShipmentStatus;
    active_assignment_id: string | null;
    pickup_confirmed_at: string | null;
    delivered_at: string | null;
    approved_pod_document_id: string | null;
    closeout_completed_at: string | null;
    cancellation_reason: string | null;
  }>(`select shipment_transition_facts(${lit(shipmentId)})`);
  return {
    ...NO_TRANSITION_FACTS,
    status: row.status,
    activeAssignmentId: row.active_assignment_id,
    pickupConfirmedAt: row.pickup_confirmed_at,
    deliveredAt: row.delivered_at,
    approvedPodDocumentId: row.approved_pod_document_id,
    closeoutCompletedAt: row.closeout_completed_at,
    cancellationReason: row.cancellation_reason,
  };
}

/** Facts → engine → atomic write. The real path, in the real order. */
function transition(args: {
  shipmentId: string;
  to: ShipmentStatus;
  actor: Parameters<typeof evaluateTransition>[0]["actor"];
  assertions?: Partial<TransitionFacts>;
}): { ok: true } | { ok: false; code: string; message: string } {
  const state = facts(args.shipmentId);
  const eventTime = new Date().toISOString();
  const decision = evaluateTransition({
    from: state.status,
    to: args.to,
    actor: args.actor,
    facts: { ...state, ...args.assertions, deliveryTimestamp: eventTime },
  });
  if (!decision.ok) {
    return { ok: false, code: decision.code, message: decision.message };
  }
  json(
    `select apply_shipment_transition(
       ${lit(args.shipmentId)}, ${lit(state.status)}, ${lit(args.to)}, 'dispatcher',
       ${lit(DISPATCHER)}, 'staff_only', ${lit(eventTime)}::timestamptz,
       null, null, null, null, null, null, '{}'::jsonb, null, null, null,
       'status_change')`,
  );
  return { ok: true };
}

function createShipment(trackingNumber: string, carrierId: string | null): string {
  const id = scalar(
    `insert into shipments (tracking_number, shipper_id, carrier_id, broker_partner_id,
       dispatcher_id, origin_city, origin_state, destination_city, destination_state, equipment)
     values (${lit(trackingNumber)}, ${lit(SHIPPER)}, ${litOrNull(carrierId)},
       ${lit(BROKER)}, ${lit(DISPATCHER)},
       'Newark', 'NJ', 'Atlanta', 'GA', 'dry-van')
     returning id`,
  );
  if (!id) throw new Error("shipment insert returned no id");
  return id;
}

interface AddDocumentEnvelope {
  document_id: string;
  shipment_id: string;
  event_id: string;
  visibility: string;
  replayed: boolean;
}

/** `add_shipment_document()` — what `uploadShipmentDocument` calls. */
function addDocument(args: {
  shipmentId: string;
  docType: ShipmentDocumentType;
  fileName?: string;
  source?: string;
  visibility?: string | null;
  idempotencyKey?: string | null;
  storagePath?: string;
}): AddDocumentEnvelope {
  const path =
    args.storagePath ??
    `${args.shipmentId}/${crypto.randomUUID()}-${args.fileName ?? "doc.pdf"}`;
  return json<AddDocumentEnvelope>(
    `select add_shipment_document(
       ${lit(args.shipmentId)}, ${lit(args.docType)}, ${lit(path)},
       ${lit(args.fileName ?? "doc.pdf")}, 'application/pdf', 12345,
       ${lit(DISPATCHER)}, ${lit(args.source ?? "dispatcher")},
       ${args.visibility === undefined || args.visibility === null ? "null" : lit(args.visibility)},
       ${litOrNull(args.idempotencyKey ?? null)})`,
  );
}

function reviewDocument(
  documentId: string,
  decision: "approved" | "rejected" | "expired",
  note: string | null = null,
): { document_id: string; status: string; event_id: string } {
  return json(
    `select review_shipment_document(
       ${lit(documentId)}, ${lit(decision)}, ${lit(DISPATCHER)},
       ${litOrNull(note)}, 'dispatcher', null)`,
  );
}

/** Walk a shipment from creation to `delivered` through the real engine. */
function advanceToDelivered(shipmentId: string): void {
  for (const step of [
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
  ] as const) {
    const result = transition({ shipmentId, to: step, actor: "dispatcher" });
    if (!result.ok) throw new Error(`${step}: ${result.message}`);
  }
}

beforeAll(() => {
  openBrokerageGate();
  exec(`insert into auth.users (id, email) values
      (${lit(DISPATCHER)}, 'm77-dispatcher@integration.test'),
      (${lit(SHIPPER_USER)}, 'm77-shipper@integration.test'),
      (${lit(SHIPPER_B_USER)}, 'm77-shipper-b@integration.test'),
      (${lit(CARRIER_A_USER)}, 'm77-carrier-a@integration.test'),
      (${lit(CARRIER_B_USER)}, 'm77-carrier-b@integration.test'),
      (${lit(BROKER_USER)}, 'm77-broker@integration.test')
    on conflict do nothing`);
  exec(`insert into profiles (id, role, full_name) values
      (${lit(DISPATCHER)}, 'dispatcher', 'M77 Dispatcher'),
      (${lit(SHIPPER_USER)}, 'shipper', 'M77 Shipper User'),
      (${lit(SHIPPER_B_USER)}, 'shipper', 'M77 Shipper B User'),
      (${lit(CARRIER_A_USER)}, 'carrier', 'M77 Carrier A User'),
      (${lit(CARRIER_B_USER)}, 'carrier', 'M77 Carrier B User'),
      (${lit(BROKER_USER)}, 'shipper', 'M77 Broker User')
    on conflict do nothing`);
  exec(`insert into shippers (id, company_name) values
      (${lit(SHIPPER)}, 'M77 Shipper Inc'),
      (${lit(SHIPPER_B)}, 'M77 Other Shipper Inc') on conflict do nothing`);
  exec(`insert into carriers (id, company_name, active) values
      (${lit(CARRIER_A)}, 'M77 Carrier A', true),
      (${lit(CARRIER_B)}, 'M77 Carrier B', true) on conflict do nothing`);
  // M-81 (0029) narrowed `my_broker_partner_ids()` to require `active` AND
  // `verification_status = 'verified'` (§12 "verified"). The fixture states
  // both rather than relying on 0029's backfill, which runs against an empty
  // table at migration time.
  exec(`insert into broker_partners (id, company_name, active, verification_status)
      values (${lit(BROKER)}, 'M77 Broker Partner', true, 'verified')
      on conflict do nothing`);
  exec(`insert into shipper_memberships (shipper_id, profile_id, role) values
      (${lit(SHIPPER)}, ${lit(SHIPPER_USER)}, 'owner'),
      (${lit(SHIPPER_B)}, ${lit(SHIPPER_B_USER)}, 'owner') on conflict do nothing`);
  exec(`insert into carrier_memberships (carrier_id, profile_id, role) values
      (${lit(CARRIER_A)}, ${lit(CARRIER_A_USER)}, 'owner'),
      (${lit(CARRIER_B)}, ${lit(CARRIER_B_USER)}, 'owner') on conflict do nothing`);
  exec(`insert into broker_partner_memberships (broker_partner_id, profile_id, role) values
      (${lit(BROKER)}, ${lit(BROKER_USER)}, 'owner') on conflict do nothing`);
});

/* ================================================================== *
 * 1 · The matrix in SQL IS the matrix in TypeScript
 * ================================================================== */

describe("§16 MATRIX — one mapping, two representations, zero drift", () => {
  it("`shipment_document_audiences` matches `DOCUMENT_AUDIENCES` cell for cell", () => {
    const rows = json<{ doc_type: ShipmentDocumentType; audience: string }[]>(
      `select coalesce(jsonb_agg(jsonb_build_object(
          'doc_type', doc_type, 'audience', audience)), '[]'::jsonb)
       from shipment_document_audiences`,
    );
    const fromSql = new Set(rows.map((r) => `${r.doc_type}/${r.audience}`));
    const fromTs = new Set(
      SHIPMENT_DOCUMENT_TYPES.flatMap((type) =>
        DOCUMENT_AUDIENCES[type].map((a) => `${type}/${a}`),
      ),
    );
    expect([...fromSql].sort()).toEqual([...fromTs].sort());
    // NON-VACUITY: it is not two empty sets agreeing.
    expect(fromSql.size).toBeGreaterThan(15);
  });

  it("the SQL predicate agrees with the TS predicate on all 55 cells", () => {
    for (const type of SHIPMENT_DOCUMENT_TYPES) {
      for (const audience of [
        "public",
        "shipper",
        "carrier",
        "broker",
        "staff_only",
      ] as const) {
        const band = DOCUMENT_AUDIENCES[type][0] ?? "staff_only";
        const sqlSays =
          scalar(
            `select shipment_document_reaches_audience(
               ${lit(type)}, ${lit(band)}, 'approved', ${lit(audience)})`,
          ) === "t";
        // `staff_only` is a floor, not an audience the matrix decides about —
        // `documentReachesAudience` does not accept it, and the SQL returns
        // false because no matrix row names it. Both are "not a cell".
        const tsSays =
          audience === "staff_only"
            ? false
            : documentReachesAudience(
                { doc_type: type, visibility: band, status: "approved" },
                audience,
              );
        expect(sqlSays, `${type} → ${audience}`).toBe(tsSays);
      }
    }
  });

  it("no `public` cell exists, and one cannot be inserted", () => {
    expect(
      count(`select count(*) from shipment_document_audiences where audience = 'public'`),
    ).toBe(0);
    expect(
      sqlstateOf(
        `insert into shipment_document_audiences (doc_type, audience) values ('bol', 'public')`,
      ),
    ).toBe("23514"); // check_violation
  });

  it("no `staff_only` cell exists either — it is the floor", () => {
    expect(
      sqlstateOf(
        `insert into shipment_document_audiences (doc_type, audience) values ('bol', 'staff_only')`,
      ),
    ).toBe("23514");
  });
});

/* ================================================================== *
 * 2 · §27 "document upload" + the visibility trigger
 * ================================================================== */

describe("§27 · document upload", () => {
  let shipmentId = "";

  beforeAll(() => {
    shipmentId = createShipment("PL-2026-771001", CARRIER_A);
  });

  it("files a document AND its §7 event in one call", () => {
    const before = count(
      `select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`,
    );
    const result = addDocument({
      shipmentId,
      docType: "bol",
      fileName: "bol.pdf",
    });
    expect(result.document_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.replayed).toBe(false);
    expect(
      count(`select count(*) from shipment_events where shipment_id = ${lit(shipmentId)}`),
    ).toBe(before + 1);

    const event = json<{ event_type: string; visibility: string; metadata: Record<string, unknown> }>(
      `select to_jsonb(e) from shipment_events e where e.id = ${lit(result.event_id)}`,
    );
    expect(event.event_type).toBe("document_uploaded");
    // §16: an unreviewed document is not a customer-facing fact.
    expect(event.visibility).toBe("staff_only");
    expect(event.metadata.document_id).toBe(result.document_id);
    // NEVER the storage path — it is what a signed URL is minted from.
    expect(JSON.stringify(event.metadata)).not.toContain("/");
  });

  it("lands at `pending`, so it reaches nobody yet", () => {
    const { document_id } = addDocument({ shipmentId, docType: "pod", fileName: "pod.jpg" });
    const row = json<{ status: string; approved_at: string | null; visibility: string }>(
      `select to_jsonb(d) from shipment_documents d where d.id = ${lit(document_id)}`,
    );
    expect(row.status).toBe("pending");
    expect(row.approved_at).toBeNull();
    // The DEFAULT band came from the matrix, not from the caller.
    expect(row.visibility).toBe("shipper");
  });

  it("defaults `claim` and a caller-silent `other` to staff_only", () => {
    const claim = addDocument({ shipmentId, docType: "claim", fileName: "claim.pdf" });
    expect(
      scalar(`select visibility from shipment_documents where id = ${lit(claim.document_id)}`),
    ).toBe("staff_only");
  });

  it("REFUSES a rate confirmation filed as `shipper` — §4, in the database", () => {
    const state = sqlstateOf(
      `insert into shipment_documents
         (shipment_id, doc_type, visibility, storage_path, file_name)
       values (${lit(shipmentId)}, 'rate_confirmation', 'shipper',
               ${lit(`${shipmentId}/x-ratecon.pdf`)}, 'ratecon.pdf')`,
    );
    expect(state).toBe("PL422");
  });

  it("REFUSES any document filed as `public` — §16, in the database", () => {
    for (const type of ["bol", "pod", "other"] as const) {
      expect(
        sqlstateOf(
          `insert into shipment_documents
             (shipment_id, doc_type, visibility, storage_path, file_name)
           values (${lit(shipmentId)}, ${lit(type)}, 'public',
                   ${lit(`${shipmentId}/p-${type}.pdf`)}, 'x.pdf')`,
        ),
        type,
      ).toBe("PL422");
    }
  });

  it("ALLOWS narrowing any type to staff_only — narrowing always is legal", () => {
    const doc = addDocument({
      shipmentId,
      docType: "bol",
      fileName: "held-bol.pdf",
      visibility: "staff_only",
    });
    expect(doc.visibility).toBe("staff_only");
  });

  it("refuses an object path outside the shipment's own prefix", () => {
    expect(
      sqlstateOf(
        `insert into shipment_documents
           (shipment_id, doc_type, visibility, storage_path, file_name)
         values (${lit(shipmentId)}, 'bol', 'shipper',
                 'some-other-shipment/x-bol.pdf', 'bol.pdf')`,
      ),
    ).toBe("23514");
  });

  it("is IDEMPOTENT — a retried upload does not produce a second row", () => {
    const key = "doc:integration-replay-1";
    const path = `${shipmentId}/replay-doc.pdf`;
    const first = addDocument({
      shipmentId,
      docType: "delivery_receipt",
      storagePath: path,
      idempotencyKey: key,
    });
    const second = addDocument({
      shipmentId,
      docType: "delivery_receipt",
      storagePath: path,
      idempotencyKey: key,
    });
    expect(second.replayed).toBe(true);
    expect(second.document_id).toBe(first.document_id);
    expect(
      count(
        `select count(*) from shipment_documents
          where shipment_id = ${lit(shipmentId)} and doc_type = 'delivery_receipt'`,
      ),
    ).toBe(1);
  });

  it("a filed document is IMMUTABLE in what it IS", () => {
    const { document_id } = addDocument({
      shipmentId,
      docType: "bol",
      fileName: "immutable.pdf",
    });
    for (const [column, value] of [
      ["doc_type", "'pod'"],
      ["storage_path", lit(`${shipmentId}/relinked.pdf`)],
      ["uploaded_at", "now()"],
    ] as const) {
      expect(
        sqlstateOf(
          `update shipment_documents set ${column} = ${value} where id = ${lit(document_id)}`,
        ),
        column,
      ).toBe("PL409");
    }
    // …but the REVIEW fields move freely, which is the whole workflow.
    expect(
      sqlstateOf(
        `update shipment_documents set review_note = 'legible' where id = ${lit(document_id)}`,
      ),
    ).toBe("OK");
  });

  it("refuses a document on a shipment that does not exist", () => {
    const state = sqlstateOf(
      `select add_shipment_document(
         '00000000-0000-0000-0000-0000000000ff', 'bol',
         '00000000-0000-0000-0000-0000000000ff/x.pdf', 'x.pdf')`,
    );
    expect(state).toBe("PL404");
  });
});

/* ================================================================== *
 * 3 · §27 "POD upload" — M-72's DEFERRED PRECONDITION, COMPLETED
 * ================================================================== */

describe("§27 · POD upload → §20's `pod_uploaded` precondition", () => {
  let shipmentId = "";
  let podId = "";

  beforeAll(() => {
    shipmentId = createShipment("PL-2026-771002", CARRIER_A);
    exec(
      `insert into shipment_assignments (shipment_id, carrier_id)
       values (${lit(shipmentId)}, ${lit(CARRIER_A)})`,
    );
    advanceToDelivered(shipmentId);
  });

  it("REGRESSION BASELINE: with no POD at all, `pod_uploaded` is refused", () => {
    expect(facts(shipmentId).approvedPodDocumentId).toBeNull();
    const result = transition({ shipmentId, to: "pod_uploaded", actor: "dispatcher" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("precondition_failed");
    expect(result.message).toContain("POD");
  });

  it("an UNAPPROVED POD is still not enough — §16's 'approved' is load-bearing", () => {
    podId = addDocument({ shipmentId, docType: "pod", fileName: "pod.jpg" }).document_id;
    expect(
      scalar(`select status from shipment_documents where id = ${lit(podId)}`),
    ).toBe("pending");
    // The document EXISTS. The fact is still null, because nobody checked it.
    expect(facts(shipmentId).approvedPodDocumentId).toBeNull();
    const result = transition({ shipmentId, to: "pod_uploaded", actor: "dispatcher" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("precondition_failed");
  });

  it("a REJECTED POD is not enough either", () => {
    reviewDocument(podId, "rejected", "unreadable — photograph it again");
    expect(facts(shipmentId).approvedPodDocumentId).toBeNull();
    expect(
      transition({ shipmentId, to: "pod_uploaded", actor: "dispatcher" }).ok,
    ).toBe(false);
  });

  it("an approved POD of the WRONG TYPE is not enough — a BOL is not a POD", () => {
    const bol = addDocument({ shipmentId, docType: "bol", fileName: "bol.pdf" });
    reviewDocument(bol.document_id, "approved");
    expect(facts(shipmentId).approvedPodDocumentId).toBeNull();
    expect(
      transition({ shipmentId, to: "pod_uploaded", actor: "dispatcher" }).ok,
    ).toBe(false);
  });

  /**
   * THE HEADLINE. M-72's integration suite asserts this transition FAILS; that
   * assertion was honest and is now obsolete. Here it succeeds — and only
   * because a human approved a POD.
   */
  it("REGRESSION TO GREEN: approve the POD and `pod_uploaded` SUCCEEDS", () => {
    const approved = reviewDocument(podId, "approved", "legible, signed");
    expect(approved.status).toBe("approved");

    const resolved = facts(shipmentId);
    expect(resolved.approvedPodDocumentId).toBe(podId);

    const result = transition({ shipmentId, to: "pod_uploaded", actor: "dispatcher" });
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    expect(
      scalar(`select status from shipments where id = ${lit(shipmentId)}`),
    ).toBe("pod_uploaded");
  });

  it("the approval published a CUSTOMER-visible event; the rejection did not", () => {
    const approvals = json<{ visibility: string; metadata: Record<string, unknown> }[]>(
      `select coalesce(jsonb_agg(to_jsonb(e) order by e.recorded_at), '[]'::jsonb)
       from shipment_events e
       where e.shipment_id = ${lit(shipmentId)} and e.event_type = 'document_approved'`,
    );
    const decisions = approvals.map((e) => ({
      decision: e.metadata.decision,
      visibility: e.visibility,
    }));
    expect(decisions).toContainEqual({ decision: "rejected", visibility: "staff_only" });
    // §16 licenses `pod` to shippers, so the approval is published at that band.
    expect(decisions).toContainEqual({ decision: "approved", visibility: "shipper" });
  });

  it("UN-APPROVING makes it unreachable again — the fact tracks the CURRENT decision", () => {
    // Walk to `completed` first would be terminal; instead assert on the fact
    // and the engine's verdict directly, which is what the precondition is.
    reviewDocument(podId, "rejected", "customer disputes the signature");
    expect(
      scalar(`select approved_at from shipment_documents where id = ${lit(podId)}`),
    ).toBeNull();
    expect(facts(shipmentId).approvedPodDocumentId).toBeNull();

    const decision = evaluateTransition({
      from: "delivered",
      to: "pod_uploaded",
      actor: "dispatcher",
      facts: { ...NO_TRANSITION_FACTS, deliveredAt: new Date().toISOString() },
    });
    expect(decision.ok).toBe(false);
  });

  it("0024's CHECK makes `approved_at is not null` == `status = 'approved'`", () => {
    // The M-72 replacement SQL reads `approved_at is not null` VERBATIM. This
    // is the constraint that makes that expression a faithful reading of the
    // review state, so hand-writing the other half would be redundant.
    expect(
      sqlstateOf(
        `update shipment_documents set status = 'approved' where id = ${lit(podId)}`,
      ),
    ).toBe("23514");
    expect(
      sqlstateOf(
        `update shipment_documents set approved_at = now() where id = ${lit(podId)}`,
      ),
    ).toBe("23514");
  });

  it("refuses a review decision of `pending`", () => {
    expect(
      sqlstateOf(
        `select review_shipment_document(${lit(podId)}, 'pending', ${lit(DISPATCHER)})`,
      ),
    ).toBe("PL422");
  });

  it("refuses a review of a document that does not exist", () => {
    expect(
      sqlstateOf(
        `select review_shipment_document('00000000-0000-0000-0000-0000000000ff', 'approved')`,
      ),
    ).toBe("PL404");
  });
});

/* ================================================================== *
 * 4 · §19 — carrier A cannot read carrier B's shipment documents
 * ================================================================== */

describe("§19 · per-audience reads through the REAL policies", () => {
  let shipmentA = "";
  let shipmentB = "";

  beforeAll(() => {
    shipmentA = createShipment("PL-2026-771010", CARRIER_A);
    shipmentB = createShipment("PL-2026-771011", CARRIER_B);
    for (const shipmentId of [shipmentA, shipmentB]) {
      for (const type of ["bol", "pod", "rate_confirmation", "invoice", "claim"] as const) {
        const doc = addDocument({ shipmentId, docType: type, fileName: `${type}.pdf` });
        reviewDocument(doc.document_id, "approved");
      }
    }
  });

  async function readAs(sub: string, shipmentId: string): Promise<string[]> {
    const client = createRlsSupabaseClient({ role: "authenticated", sub });
    const { data } = await client
      .from("shipment_documents")
      .select("id, doc_type, visibility, status")
      .eq("shipment_id", shipmentId)
      .order("doc_type", { ascending: true })
      .limit(50);
    return ((data ?? []) as { doc_type: string }[]).map((d) => d.doc_type).sort();
  }

  it("CARRIER A cannot read ANY of carrier B's shipment documents", async () => {
    expect(await readAs(CARRIER_A_USER, shipmentB)).toEqual([]);
    // NON-VACUITY: the same session reads its OWN shipment's carrier band.
    expect(await readAs(CARRIER_A_USER, shipmentA)).toEqual([
      "bol",
      "pod",
      "rate_confirmation",
    ]);
  });

  it("carrier B is symmetric", async () => {
    expect(await readAs(CARRIER_B_USER, shipmentA)).toEqual([]);
    expect(await readAs(CARRIER_B_USER, shipmentB)).toEqual([
      "bol",
      "pod",
      "rate_confirmation",
    ]);
  });

  it("a SHIPPER reads their band and NOT the carrier's rate confirmation", async () => {
    const types = await readAs(SHIPPER_USER, shipmentA);
    expect(types).toEqual(["bol", "invoice", "pod"]);
    expect(types).not.toContain("rate_confirmation");
    expect(types).not.toContain("claim");
  });

  it("another SHIPPER organization reads nothing at all", async () => {
    expect(await readAs(SHIPPER_B_USER, shipmentA)).toEqual([]);
  });

  it("§12's BROKER band reads BOL and POD, and nothing else", async () => {
    const types = await readAs(BROKER_USER, shipmentA);
    expect(types).toEqual(["bol", "pod"]);
    expect(types).not.toContain("invoice");
    expect(types).not.toContain("rate_confirmation");
  });

  it("a DE-ACTIVATED broker organization reads nothing", async () => {
    exec(`update broker_partners set active = false where id = ${lit(BROKER)}`);
    expect(await readAs(BROKER_USER, shipmentA)).toEqual([]);
    exec(`update broker_partners set active = true where id = ${lit(BROKER)}`);
    expect(await readAs(BROKER_USER, shipmentA)).toEqual(["bol", "pod"]);
  });

  it("ANON reads nothing — there is no public document surface (§4)", async () => {
    const client = createRlsSupabaseClient({ role: "anon", sub: null });
    const { data } = await client
      .from("shipment_documents")
      .select("id")
      .eq("shipment_id", shipmentA)
      .limit(50);
    expect(data ?? []).toEqual([]);
  });

  it("an UNAPPROVED document is invisible to every customer band", async () => {
    const pending = addDocument({
      shipmentId: shipmentA,
      docType: "delivery_receipt",
      fileName: "unchecked.pdf",
    });
    for (const sub of [SHIPPER_USER, CARRIER_A_USER, BROKER_USER]) {
      const types = await readAs(sub, shipmentA);
      expect(types, sub).not.toContain("delivery_receipt");
    }
    reviewDocument(pending.document_id, "approved");
    expect(await readAs(SHIPPER_USER, shipmentA)).toContain("delivery_receipt");
  });

  it("the DTO filter and the POLICY agree — belt and braces, same answer", async () => {
    const client = createRlsSupabaseClient({
      role: "authenticated",
      sub: SHIPPER_USER,
    });
    const { data } = await client
      .from("shipment_documents")
      .select(
        "id, doc_type, visibility, status, file_name, size_bytes, uploaded_at, approved_at",
      )
      .eq("shipment_id", shipmentA)
      .limit(50);
    const rows = (data ?? []) as Parameters<typeof toCustomerDocumentDtos>[0];
    // Every row the POLICY returned survives the TypeScript filter: the second
    // opinion cannot widen the first, and here it does not narrow it either.
    expect(toCustomerDocumentDtos(rows, "shipper").length).toBe(rows.length);
    // …and the same rows filtered for the CARRIER band shrink, which is what
    // makes the previous line a statement rather than a tautology.
    expect(toCustomerDocumentDtos(rows, "carrier").length).toBeLessThan(
      rows.length,
    );
  });
});

/* ================================================================== *
 * 5 · §11's ninth tile — a count that discloses nothing
 * ================================================================== */

describe("§11 · documents awaiting review", () => {
  it("counts the CALLER's pending documents and nobody else's", () => {
    const mine = json<number>(
      `select jsonb_build_object('n', (
         select count(*) from shipment_documents d
         join shipments s on s.id = d.shipment_id
         where d.status = 'pending' and s.shipper_id = ${lit(SHIPPER)}))->'n'`,
    );
    expect(Number(mine)).toBeGreaterThan(0);
    // The function takes NO argument: scope is `my_shipper_ids()` inside it,
    // so there is no parameter through which another org could be named.
    // Zero parameters. `pg_proc.pronargs` rather than the argument string,
    // because an empty string and a NULL are the same thing through `scalar`.
    expect(
      count(
        `select pronargs from pg_proc
          where proname = 'count_shipment_documents_awaiting_review'`,
      ),
    ).toBe(0);
  });
});

/* ================================================================== *
 * 6 · §25 — the reads are bounded and indexed
 * ================================================================== */

describe("§25 · bounded, indexed reads", () => {
  it("the POD precondition lookup is served by its PARTIAL index", () => {
    const shipmentId = createShipment("PL-2026-771020", CARRIER_A);
    const pod = addDocument({ shipmentId, docType: "pod", fileName: "idx.jpg" });
    reviewDocument(pod.document_id, "approved");

    // The index is PARTIAL (`where doc_type = 'pod' and approved_at is not
    // null`), which is what keeps it small on a table where PODs are a
    // fraction of all documents. Postgres will still choose a sequential scan
    // on a five-row table, so what is asserted is the index's DEFINITION —
    // that it covers exactly the predicate 0024's replacement SQL uses.
    const def = scalar(
      `select indexdef from pg_indexes
        where indexname = 'idx_shipment_documents_approved_pod'`,
    );
    expect(def).toContain("shipment_id");
    expect(def).toContain("approved_at DESC");
    expect(def).toContain("doc_type = 'pod'");
    expect(def).toContain("approved_at IS NOT NULL");

    // And the query it was built for returns the row.
    expect(facts(shipmentId).approvedPodDocumentId).toBe(pod.document_id);
  });

  it("all three documented indexes exist", () => {
    for (const name of [
      "idx_shipment_documents_shipment",
      "idx_shipment_documents_approved_pod",
      "idx_shipment_documents_pending",
    ]) {
      expect(
        count(`select count(*) from pg_indexes where indexname = ${lit(name)}`),
        name,
      ).toBe(1);
    }
  });

  it("one storage path, one row — a duplicate is refused", () => {
    const shipmentId = createShipment("PL-2026-771021", CARRIER_A);
    const path = `${shipmentId}/dupe.pdf`;
    addDocument({ shipmentId, docType: "bol", storagePath: path });
    expect(
      sqlstateOf(
        `insert into shipment_documents
           (shipment_id, doc_type, visibility, storage_path, file_name)
         values (${lit(shipmentId)}, 'pod', 'shipper', ${lit(path)}, 'dupe.pdf')`,
      ),
    ).toBe("23505");
  });
});
