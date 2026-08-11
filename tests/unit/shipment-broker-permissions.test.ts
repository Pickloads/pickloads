import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BROKER_CONTACT_COLUMNS,
  BROKER_DENIED_SOURCES,
  BROKER_DENY_REASON_TEXT,
  BROKER_DOCUMENT_POLICY,
  BROKER_DOCUMENT_TYPES,
  BROKER_EVENT_BANDS,
  BROKER_FIELD_POLICY,
  BROKER_MAY_SEE,
  BROKER_MUST_NOT_SEE,
  BROKER_NON_COLUMN_KEYS,
  BROKER_REQUIRES_PUBLIC_CONTACT,
  brokerAllowedFields,
  brokerDeniedFields,
  brokerDtoKeyFor,
  type BrokerDenyReason,
} from "@/lib/shipments/broker-permissions";
import {
  BROKER_DETAIL_COLUMNS,
  BROKER_LIST_COLUMNS,
  BROKER_REACHABLE_LIMIT,
} from "@/lib/shipments/broker-access";
import { toBrokerDto } from "@/lib/shipments/dto";
import {
  createCarrierAccountSchema,
  createShipperAccountSchema,
} from "@/lib/validation/account";
import {
  acceptBrokerInviteSchema,
  brokerInviteSchema,
  brokerPartnerSchema,
  grantBrokerShipmentSchema,
  verifyBrokerPartnerSchema,
} from "@/lib/validation/broker";
import { MAX_PAGE_SIZE } from "@/lib/shipments/shipper-list";
import type { ShipmentEventRow, ShipmentRow } from "@/lib/shipments/types";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ru from "../../messages/ru.json";
import ht from "../../messages/ht.json";

/**
 * M-81 — §12's broker **allow / deny lists**, pinned cell by cell.
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 restores *"§12's broker permission
 * allow/deny lists"* as a requirement the extension audit dropped. §12 states
 * both lists in words; `src/lib/shipments/broker-permissions.ts` states them
 * as data; this file is what stops the data becoming decoration.
 *
 * ── THE EXPECTATIONS ARE TRANSCRIBED FROM THE DIRECTIVE ──────────────────
 *
 * `EXPECTED_FIELD_DECISIONS` below is written out from §12, not imported from
 * `BROKER_FIELD_POLICY`. M-77 set that rule for the document matrix and it is
 * the whole point: a test that imported the table and compared it to itself
 * would pass for any table.
 *
 * ── AND THEN CROSS-CHECKED AGAINST THE ACTUAL SERIALIZER ─────────────────
 *
 * A table nobody reads is as useless as no table. Section 3 runs the REAL
 * `toBrokerDto` over a fixture whose every field carries a detectable
 * sentinel, and asserts the emitted key set is EXACTLY the allow cells (plus
 * the four named non-column keys) and that no denied value appears anywhere
 * in the serialized JSON — including inside the nested event objects.
 */

/* ================================================================== *
 * 1 · THE FIELD MATRIX — transcribed from §12
 * ================================================================== */

type Expected =
  | readonly ["allow"]
  | readonly ["allow_renamed", string]
  | readonly ["allow_derived", string]
  | readonly ["deny", BrokerDenyReason];

/**
 * Every column of `ShipmentRow`, decided from the directive text:
 *
 *   MAY see ....... assigned shipments · status · timeline · POD ·
 *                   BOL when authorized · approved contact channels
 *   MUST NOT see .. carrier's private packet · carrier insurance records ·
 *                   shipper billing · PickLoads commission · internal margin ·
 *                   unrelated shipments
 */
const EXPECTED_FIELD_DECISIONS: Record<keyof ShipmentRow, Expected> = {
  id: ["allow"],
  tracking_number: ["allow"],
  shipper_reference: ["allow"],
  po_number: ["allow"],
  status: ["allow"],
  completed_at: ["allow"],
  cancelled_at: ["allow"],
  cancellation_reason: ["allow"],
  created_at: ["allow"],
  updated_at: ["allow"],
  origin_company: ["allow"],
  origin_address: ["allow"],
  origin_city: ["allow"],
  origin_state: ["allow"],
  origin_zip: ["allow"],
  destination_company: ["allow"],
  destination_address: ["allow"],
  destination_city: ["allow"],
  destination_state: ["allow"],
  destination_zip: ["allow"],
  equipment: ["allow"],
  commodity_category: ["allow"],
  weight_lbs: ["allow"],
  pallets: ["allow"],
  distance_miles: ["allow"],
  pickup_appointment_at: ["allow"],
  delivery_appointment_at: ["allow"],
  estimated_pickup_at: ["allow"],
  estimated_delivery_at: ["allow"],
  eta_source: ["allow"],
  eta_confidence: ["allow"],
  eta_updated_at: ["allow"],
  delay_minutes: ["allow"],
  delay_reason_public: ["allow_renamed", "delay_reason"],
  tracking_mode: ["allow"],
  location_visibility: ["allow"],
  current_city: ["allow"],
  current_state: ["allow"],
  current_latitude: ["allow"],
  current_longitude: ["allow"],
  last_location_at: ["allow"],
  // §1 "assigned carrier status" without §12's "carrier's private packet".
  carrier_id: ["allow_derived", "carrier_assigned"],
  // §12's six prohibitions, at column level.
  gross_shipper_amount: ["deny", "shipper_billing"],
  carrier_pay: ["deny", "pickloads_commission"],
  margin: ["deny", "internal_margin"],
  shipper_id: ["deny", "counterparty_identity"],
  broker_partner_id: ["deny", "counterparty_identity"],
  dispatcher_id: ["deny", "internal_operations"],
  quote_id: ["deny", "shipper_billing"],
  load_id: ["deny", "internal_operations"],
  public_tracking_enabled: ["deny", "internal_operations"],
  delay_reason_internal: ["deny", "internal_operations"],
  public_access_hash: ["deny", "access_credential"],
};

describe("§12 broker field matrix", () => {
  it("decides every ShipmentRow column exactly as the directive does", () => {
    for (const [field, expected] of Object.entries(
      EXPECTED_FIELD_DECISIONS,
    ) as [keyof ShipmentRow, Expected][]) {
      const rule = BROKER_FIELD_POLICY[field];
      expect(rule, `no rule for ${field}`).toBeDefined();
      expect(rule.decision, `${field} decision`).toBe(expected[0]);
      if (expected[0] === "allow_renamed" || expected[0] === "allow_derived") {
        expect(
          rule.decision === "allow_renamed" || rule.decision === "allow_derived"
            ? rule.as
            : null,
          `${field} alias`,
        ).toBe(expected[1]);
      }
      if (expected[0] === "deny") {
        expect(
          rule.decision === "deny" ? rule.because : null,
          `${field} deny reason`,
        ).toBe(expected[1]);
      }
    }
  });

  it("covers EVERY ShipmentRow column — a new column cannot be undecided", () => {
    // Static scan of the declaration, the same technique the staff-DTO test
    // uses. A column added by a later module fails HERE until somebody states
    // whether a broker partner may see it.
    const source = readFileSync("src/lib/shipments/types.ts", "utf8");
    const start = source.indexOf("export interface ShipmentRow {");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n}", start));
    const rowFields = [...body.matchAll(/^ {2}(\w+)(\??):/gm)].map(
      (match) => match[1] ?? "",
    );
    expect(rowFields.length).toBe(53);
    expect([...rowFields].sort()).toEqual(
      Object.keys(BROKER_FIELD_POLICY).sort(),
    );
    expect([...rowFields].sort()).toEqual(
      Object.keys(EXPECTED_FIELD_DECISIONS).sort(),
    );
  });

  it("denies all three §18 financial columns — not even carrier_pay", () => {
    const denied = brokerDeniedFields();
    expect(denied).toContain("gross_shipper_amount");
    expect(denied).toContain("carrier_pay");
    expect(denied).toContain("margin");
    // The reasoning matters as much as the outcome: price + pay = commission.
    expect(BROKER_FIELD_POLICY.carrier_pay).toEqual({
      decision: "deny",
      because: "pickloads_commission",
    });
  });

  it("allows exactly 42 columns and denies exactly 11", () => {
    expect(brokerAllowedFields()).toHaveLength(42);
    expect(brokerDeniedFields()).toHaveLength(11);
  });

  it("maps every allowed column to the DTO key it produces", () => {
    expect(brokerDtoKeyFor("origin_city")).toBe("origin_city");
    expect(brokerDtoKeyFor("delay_reason_public")).toBe("delay_reason");
    expect(brokerDtoKeyFor("carrier_id")).toBe("carrier_assigned");
    expect(brokerDtoKeyFor("margin")).toBeNull();
  });

  it("gives every deny reason human-readable text", () => {
    for (const field of brokerDeniedFields()) {
      const rule = BROKER_FIELD_POLICY[field];
      if (rule.decision !== "deny") throw new Error("unreachable");
      expect(BROKER_DENY_REASON_TEXT[rule.because]).toBeTruthy();
    }
  });
});

/* ================================================================== *
 * 2 · §12's two lists, verbatim
 * ================================================================== */

describe("§12 allow / deny category lists", () => {
  it("names the six things a broker MAY see, in the directive's words", () => {
    expect(BROKER_MAY_SEE.map((entry) => entry.directive)).toEqual([
      "assigned shipments",
      "status",
      "timeline",
      "POD",
      "BOL, when authorized",
      "approved contact channels",
    ]);
    for (const entry of BROKER_MAY_SEE) {
      expect(entry.servedBy, `${entry.id} needs a surface`).toBeTruthy();
    }
  });

  it("names the six things a broker MUST NOT see, in the directive's words", () => {
    expect(BROKER_MUST_NOT_SEE.map((entry) => entry.directive)).toEqual([
      "carrier's private packet",
      "carrier insurance records",
      "shipper billing",
      "PickLoads commission",
      "internal margin",
      "unrelated shipments",
    ]);
    for (const entry of BROKER_MUST_NOT_SEE) {
      expect(entry.enforcedBy, `${entry.id} needs an enforcer`).toBeTruthy();
    }
  });

  it("names a source and an enforcing policy for every off-shipment prohibition", () => {
    const directiveIds = new Set(BROKER_MUST_NOT_SEE.map((e) => e.id));
    // Four of §12's six live in other tables entirely.
    const covered = new Set(BROKER_DENIED_SOURCES.map((s) => s.because));
    for (const id of [
      "carrier_private_packet",
      "carrier_insurance_records",
      "shipper_billing",
      "unrelated_shipments",
    ] as const) {
      expect(directiveIds.has(id)).toBe(true);
      expect(covered.has(id), `${id} has no named source`).toBe(true);
    }
    for (const source of BROKER_DENIED_SOURCES) {
      // Every entry must cite the MIGRATION that enforces it — a prose
      // justification with no artifact behind it is the thing this list exists
      // to replace.
      expect(source.enforcedBy).toMatch(/\b0\d{3}\b/);
    }
  });
});

/* ================================================================== *
 * 3 · The REAL serializer, checked against the table
 * ================================================================== */

/**
 * A shipment row whose every value is a detectable sentinel, so a leak is
 * findable by string search rather than by remembering to assert on it.
 */
function sentinelRow(): ShipmentRow {
  return {
    id: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
    tracking_number: "PL-2026-000481",
    shipper_id: "DENY-shipper-id",
    carrier_id: "DENY-carrier-id",
    dispatcher_id: "DENY-dispatcher-id",
    quote_id: "DENY-quote-id",
    broker_partner_id: "DENY-broker-partner-id",
    load_id: "DENY-load-id",
    status: "in_transit",
    origin_company: "Origin Co",
    origin_address: "1 Dock Rd",
    origin_city: "Newark",
    origin_state: "NJ",
    origin_zip: "07114",
    destination_company: "Dest Co",
    destination_address: "9 Bay St",
    destination_city: "Atlanta",
    destination_state: "GA",
    destination_zip: "30301",
    pickup_appointment_at: "2026-09-01T12:00:00.000Z",
    delivery_appointment_at: "2026-09-03T12:00:00.000Z",
    equipment: "dry-van",
    commodity_category: "general",
    weight_lbs: 41000,
    pallets: 24,
    distance_miles: 870,
    gross_shipper_amount: 987654,
    carrier_pay: 876543,
    margin: 111111,
    shipper_reference: "REF-9",
    po_number: "PO-9",
    public_tracking_enabled: true,
    tracking_mode: "manual",
    location_visibility: "exact",
    public_access_hash: "DENY-public-access-hash",
    current_latitude: 39.9,
    current_longitude: -75.1,
    current_city: "Philadelphia",
    current_state: "PA",
    last_location_at: "2026-09-02T09:00:00.000Z",
    estimated_pickup_at: "2026-09-01T11:00:00.000Z",
    estimated_delivery_at: "2026-09-03T11:00:00.000Z",
    eta_source: "calculated",
    eta_confidence: "medium",
    eta_updated_at: "2026-09-02T09:05:00.000Z",
    delay_minutes: 45,
    delay_reason_public: "Traffic on I-95",
    delay_reason_internal: "DENY-internal-delay-reason",
    created_at: "2026-08-30T08:00:00.000Z",
    updated_at: "2026-09-02T09:05:00.000Z",
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
  };
}

function event(
  visibility: ShipmentEventRow["visibility"],
  message: string,
): ShipmentEventRow {
  return {
    id: `ev-${visibility}`,
    shipment_id: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
    event_type: "status_change",
    status: "in_transit",
    event_time: "2026-09-02T09:00:00.000Z",
    recorded_at: "2026-09-02T09:00:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: "Philadelphia",
    state: "PA",
    latitude: null,
    longitude: null,
    public_message: message,
    internal_message: "DENY-internal-message",
    visibility,
    metadata: null,
    external_event_id: null,
    idempotency_key: null,
  };
}

const ALL_BAND_EVENTS: ShipmentEventRow[] = [
  event("public", "visible-to-public"),
  event("shipper", "DENY-shipper-band"),
  event("carrier", "DENY-carrier-band"),
  event("broker", "visible-to-broker"),
  event("staff_only", "DENY-staff-band"),
];

describe("toBrokerDto agrees with the matrix", () => {
  const dto = toBrokerDto({
    shipment: sentinelRow(),
    events: ALL_BAND_EVENTS,
  });

  it("emits EXACTLY the allowed keys plus the four named non-column keys", () => {
    const expectedKeys = [
      ...brokerAllowedFields()
        .map((field) => brokerDtoKeyFor(field))
        .filter((key): key is string => key !== null),
      ...BROKER_NON_COLUMN_KEYS,
    ].sort();
    expect(Object.keys(dto).sort()).toEqual(expectedKeys);
  });

  it("leaks no denied value anywhere in the serialized payload", () => {
    const json = JSON.stringify(dto);
    // Every string sentinel.
    expect(json).not.toMatch(/DENY-/);
    // Every numeric sentinel — searched as a NUMBER in the JSON, so a value
    // nested inside an event or an exception would still be caught.
    for (const financial of [987654, 876543, 111111]) {
      expect(json, `financial ${financial} leaked`).not.toContain(
        String(financial),
      );
    }
  });

  it("serializes only the public and broker event bands (§7, §12 timeline)", () => {
    expect(BROKER_EVENT_BANDS).toEqual(["public", "broker"]);
    expect(dto.events.map((e) => e.message)).toEqual([
      "visible-to-public",
      "visible-to-broker",
    ]);
  });

  it("turns the carrier identity into a boolean, per BROKER_FIELD_POLICY", () => {
    expect(dto.carrier_assigned).toBe(true);
    expect(Object.keys(dto)).not.toContain("carrier_id");
    const unassigned = toBrokerDto({
      shipment: { ...sentinelRow(), carrier_id: null },
    });
    expect(unassigned.carrier_assigned).toBe(false);
  });

  it("renames delay_reason_public and drops delay_reason_internal", () => {
    expect(dto.delay_reason).toBe("Traffic on I-95");
    expect(Object.keys(dto)).not.toContain("delay_reason_internal");
    expect(Object.keys(dto)).not.toContain("delay_reason_public");
  });
});

/* ================================================================== *
 * 4 · The SQL projections carry the same decision
 * ================================================================== */

describe("broker query projections", () => {
  function columnsOf(list: string): string[] {
    return list.split(",").map((c) => c.trim());
  }

  it("names no denied column in the DETAIL projection", () => {
    const columns = columnsOf(BROKER_DETAIL_COLUMNS);
    for (const denied of brokerDeniedFields()) {
      expect(columns, `${denied} must not be fetched`).not.toContain(denied);
    }
  });

  it("names no denied column in the LIST projection", () => {
    const columns = columnsOf(BROKER_LIST_COLUMNS);
    for (const denied of brokerDeniedFields()) {
      expect(columns, `${denied} must not be fetched`).not.toContain(denied);
    }
  });

  it("fetches only allowed columns plus carrier_id (the derived cell)", () => {
    const allowed = new Set<string>(brokerAllowedFields());
    for (const column of columnsOf(BROKER_DETAIL_COLUMNS)) {
      expect(allowed.has(column), `${column} is not an allow cell`).toBe(true);
    }
    for (const column of columnsOf(BROKER_LIST_COLUMNS)) {
      expect(allowed.has(column), `${column} is not an allow cell`).toBe(true);
    }
    // `carrier_id` IS fetched (it becomes `carrier_assigned`) and IS allowed.
    expect(columnsOf(BROKER_DETAIL_COLUMNS)).toContain("carrier_id");
  });

  it("keeps the §25 reachable-id bound above one page", () => {
    expect(BROKER_REACHABLE_LIMIT).toBeGreaterThan(MAX_PAGE_SIZE);
  });

  it("reads only the approved contact columns (§12 approved channels)", () => {
    expect([...BROKER_CONTACT_COLUMNS]).toEqual([
      "id",
      "party_role",
      "company_name",
      "contact_name",
      "phone",
      "email",
    ]);
    expect(BROKER_REQUIRES_PUBLIC_CONTACT).toBe(true);
    // The literal in `getBrokerShipmentContacts` must stay in step with the
    // constant; the source is scanned rather than the string re-derived,
    // because a computed `.select()` collapses supabase-js's row inference.
    const source = readFileSync("src/lib/shipments/broker-access.ts", "utf8");
    expect(source).toContain(
      '"id, party_role, company_name, contact_name, phone, email, public_contact"',
    );
    expect(source).toContain('.eq("public_contact", true)');
  });
});

/* ================================================================== *
 * 5 · Documents (§16's matrix through §12's eyes)
 * ================================================================== */

describe("§12 document permissions", () => {
  it("gives a broker exactly BOL, POD and the `other` escape hatch", () => {
    expect([...BROKER_DOCUMENT_TYPES].sort()).toEqual(["bol", "other", "pod"]);
  });

  it("denies the rate confirmation, the quote and the invoice", () => {
    expect(BROKER_DOCUMENT_POLICY.rate_confirmation).toBe("deny");
    expect(BROKER_DOCUMENT_POLICY.quote).toBe("deny");
    expect(BROKER_DOCUMENT_POLICY.invoice).toBe("deny");
    expect(BROKER_DOCUMENT_POLICY.claim).toBe("deny");
  });

  it("decides all eleven document types", () => {
    expect(Object.keys(BROKER_DOCUMENT_POLICY)).toHaveLength(11);
  });
});

/* ================================================================== *
 * 6 · §3 — no public signup path reaches the broker role
 * ================================================================== */

/**
 * M-54's forged-role assertions, extended to the value M-81 introduced.
 *
 * The strongest available statement of *"do not allow public
 * self-registration as a broker partner"* is a test over the schemas the
 * PUBLIC signup actions actually use: Zod strips unknown keys, so a forged
 * `role` in the POST body cannot survive validation, and neither can a forged
 * organization id.
 */
describe("§3 no public self-registration as a broker", () => {
  const validCarrier = {
    company_name: "Test Trucking LLC",
    full_name: "Test Driver",
    email: "driver@example.com",
    phone: "(908) 404-5373",
    authority_status: "active",
    mc_number: "MC-123456",
    dot_number: "",
    home_state: "NJ",
    password: "hunter22b",
    locale: "en",
  };
  const validShipper = {
    company_name: "Test Shipping Inc",
    full_name: "Test Shipper",
    email: "shipper@example.com",
    phone: "(908) 404-5373",
    industry: "Manufacturing",
    shipping_frequency: "weekly",
    regions: "Northeast",
    password: "hunter22b",
    locale: "en",
  };

  it("strips a forged role:'broker' from the carrier signup schema", () => {
    const parsed = createCarrierAccountSchema.safeParse({
      ...validCarrier,
      role: "broker",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("role" in parsed.data).toBe(false);
  });

  it("strips a forged role:'broker' from the shipper signup schema", () => {
    const parsed = createShipperAccountSchema.safeParse({
      ...validShipper,
      role: "broker",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("role" in parsed.data).toBe(false);
  });

  it("strips a forged broker_partner_id from both signup schemas", () => {
    for (const [schema, input] of [
      [createCarrierAccountSchema, validCarrier],
      [createShipperAccountSchema, validShipper],
    ] as const) {
      const parsed = schema.safeParse({
        ...input,
        broker_partner_id: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect("broker_partner_id" in parsed.data).toBe(false);
      }
    }
  });

  it("gives the invite-accept schema no organization or role field", () => {
    const parsed = acceptBrokerInviteSchema.safeParse({
      token: "a".repeat(64),
      full_name: "Partner User",
      password: "hunter22b",
      // Everything a self-registering attacker would want to choose.
      role: "admin",
      broker_partner_id: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
      membership_role: "owner",
      verification_status: "verified",
      active: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data).sort()).toEqual([
        "full_name",
        "password",
        "token",
      ]);
    }
  });

  it("gives the partner-create schema no verification or active field", () => {
    const parsed = brokerPartnerSchema.safeParse({
      company_name: "Acme Logistics",
      verification_status: "verified",
      active: true,
      verified_by: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("verification_status" in parsed.data).toBe(false);
      expect("active" in parsed.data).toBe(false);
      expect("verified_by" in parsed.data).toBe(false);
    }
  });

  it("rejects a malformed invite token before any lookup", () => {
    for (const token of ["", "not-hex", "A".repeat(64), "a".repeat(63)]) {
      expect(
        acceptBrokerInviteSchema.safeParse({
          token,
          full_name: "Partner User",
          password: "hunter22b",
        }).success,
        `token ${JSON.stringify(token)} must be refused`,
      ).toBe(false);
    }
    expect(
      acceptBrokerInviteSchema.safeParse({
        token: "0123456789abcdef".repeat(4),
        full_name: "Partner User",
        password: "hunter22b",
      }).success,
    ).toBe(true);
  });

  it("requires a uuid for every id an admin form supplies", () => {
    expect(
      brokerInviteSchema.safeParse({
        broker_partner_id: "not-a-uuid",
        email: "a@b.test",
      }).success,
    ).toBe(false);
    expect(
      verifyBrokerPartnerSchema.safeParse({
        broker_partner_id: "not-a-uuid",
        verified: "true",
      }).success,
    ).toBe(false);
    expect(
      grantBrokerShipmentSchema.safeParse({
        shipment_id: "not-a-uuid",
        broker_partner_id: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
      }).success,
    ).toBe(false);
  });

  it("treats verification as an explicit two-valued decision, never a default", () => {
    // An absent checkbox posts "" — that must NOT parse as "verify".
    expect(
      verifyBrokerPartnerSchema.safeParse({
        broker_partner_id: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
        verified: "",
      }).success,
    ).toBe(false);
    const suspend = verifyBrokerPartnerSchema.safeParse({
      broker_partner_id: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
      verified: "false",
    });
    expect(suspend.success).toBe(true);
    if (suspend.success) expect(suspend.data.verified).toBe(false);
  });
});

/* ================================================================== *
 * 7 · The action file's own guarantees
 * ================================================================== */

describe("broker actions", () => {
  const source = readFileSync("src/app/actions/broker-partners.ts", "utf8");

  it("assigns the broker role as a LITERAL, from exactly one place", () => {
    const matches = source.match(/role: "broker"/g) ?? [];
    expect(matches).toHaveLength(1);
    // …and it is inside the invite-accept action, not anywhere else.
    const acceptStart = source.indexOf("export async function acceptBrokerInviteAction");
    expect(acceptStart).toBeGreaterThan(-1);
    expect(source.indexOf('role: "broker"')).toBeGreaterThan(acceptStart);
  });

  it("never reads a role or organization id out of the form data", () => {
    expect(source).not.toContain('field(formData, "role")');
    expect(source).not.toContain('field(formData, "verification_status")');
    expect(source).not.toContain('field(formData, "active")');
  });

  it("journals every §12 state change through the single audit writer", () => {
    for (const action of [
      "broker.partner_create",
      "broker.verify",
      "broker.suspend",
      "broker.invite",
      "broker.invite_revoked",
      "broker.invite_accepted",
      "broker.grant_shipment",
      "broker.revoke_shipment",
      "broker.agreement_create",
      "broker.agreement_revoke",
    ]) {
      expect(source, `${action} is not journalled`).toContain(action);
    }
    // M-69/P-4: no direct insert into the ledger.
    expect(source).not.toContain('from("audit_events")');
  });

  it("never puts a token or its hash in an audit detail", () => {
    // The hash is computed and queried; it must never reach `detail`.
    const detailBlocks = source.match(/detail: \{[^}]*\}/g) ?? [];
    expect(detailBlocks.length).toBeGreaterThan(4);
    for (const block of detailBlocks) {
      expect(block).not.toMatch(/token/i);
    }
  });

  it("gates every export — no action reaches a write without a session check", () => {
    const exported = [
      ...source.matchAll(/export async function (\w+)\(/g),
    ].map((m) => m[1] ?? "");
    expect(exported).toContain("acceptBrokerInviteAction");
    for (const name of exported) {
      const start = source.indexOf(`export async function ${name}(`);
      const end = source.indexOf("\nexport async function", start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);
      const gated =
        body.includes("await adminOnly()") ||
        body.includes("await resolveShipmentAccess(") ||
        body.includes("await resolveStaffActor()") ||
        // The public accept action's gate is the tokenized link + rate limit.
        body.includes("checkRateLimit(");
      expect(gated, `${name} has no gate`).toBe(true);
    }
  });
});

/* ================================================================== *
 * 8 · §24 — the catalogue, five locales
 * ================================================================== */

describe("§24 broker catalogue", () => {
  const catalogues = { en, es, fr, ru, ht } as const;

  it("carries the same key set in all five locales", () => {
    const keys = Object.keys(en.shipment.broker).sort();
    expect(keys.length).toBeGreaterThan(30);
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const block = (catalogue as typeof en).shipment.broker;
      expect(Object.keys(block).sort(), `${locale} key set`).toEqual(keys);
      for (const key of keys) {
        const value = (block as Record<string, string | undefined>)[key];
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect(value?.length ?? 0, `${locale}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("authors es and fr rather than mirroring English", () => {
    // ru/ht mirror English and are FLAGGED pending native review (M-79's
    // recorded convention); es and fr are authored, and this asserts it.
    for (const locale of ["es", "fr"] as const) {
      const block = catalogues[locale].shipment.broker as Record<string, string>;
      const english = en.shipment.broker as Record<string, string>;
      const identical = Object.keys(english).filter(
        (key) => block[key] === english[key],
      );
      // "Apply"/short tokens may legitimately coincide; the body copy must not.
      expect(identical.length, `${locale} mirrors English`).toBeLessThan(4);
      expect(block.withheld_body).not.toBe(english.withheld_body);
      expect(block.unverified_body).not.toBe(english.unverified_body);
    }
  });

  it("states §12's deny list to the partner it constrains", () => {
    const body = en.shipment.broker.withheld_body.toLowerCase();
    for (const word of ["carrier", "insurance", "billing", "commission", "margin"]) {
      expect(body, `deny copy omits ${word}`).toContain(word);
    }
  });

  it("keeps the sidebar labels in the V4 catalogue for all five locales", () => {
    for (const [locale, catalogue] of Object.entries(catalogues)) {
      const v4 = (catalogue as typeof en).v4 as Record<string, string>;
      expect(v4.partner_portal, `${locale} partner_portal`).toBeTruthy();
      expect(v4.shared_shipments, `${locale} shared_shipments`).toBeTruthy();
    }
  });
});
