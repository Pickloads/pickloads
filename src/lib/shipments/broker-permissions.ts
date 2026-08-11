/**
 * M-81 — §12's broker-partner **allow / deny lists**, as data.
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 restores *"§12's broker permission
 * allow/deny lists"* as a requirement the extension audit dropped. §12 states
 * both lists in words:
 *
 *   MAY see ....... assigned shipments · status · timeline · POD ·
 *                   BOL, when authorized · approved contact channels
 *   MUST NOT see .. carrier's private packet · carrier insurance records ·
 *                   shipper billing · PickLoads commission · internal margin ·
 *                   unrelated shipments
 *
 * This file is those twelve sentences turned into structures a test can walk
 * and a compiler can enforce. It follows M-77's precedent verbatim: *"a
 * conditional per surface means N independent chances to write `>=` where
 * `===` belonged, and no single place a reviewer can read to learn who sees a
 * rate confirmation."*
 *
 * ── WHY A FIELD-BY-FIELD RECORD AND NOT JUST THE SIX CATEGORIES ──────────
 *
 * Because §12's categories are business language and a leak is a column.
 * "PickLoads commission" is not a column; `gross_shipper_amount` and
 * `carrier_pay` together ARE the commission, and a reviewer who only ever
 * reads the category list will not notice when a helpful `Omit<>` starts
 * carrying one of them. `BROKER_FIELD_POLICY` is a FULL
 * `Record<keyof ShipmentRow, …>`: a column added by M-88, M-97 or anything
 * later does not compile until somebody states, in this file, whether a
 * broker partner may see it and under which §12 clause.
 *
 * `tests/unit/shipment-broker-permissions.test.ts` walks every cell against
 * the real `toBrokerDto` output, so the table cannot become decoration.
 *
 * ── THE DENY LIST IS NOT ONLY ABOUT `shipments` ─────────────────────────
 *
 * Four of §12's six prohibitions name things that live in OTHER tables — the
 * carrier packet (`documents`, `carriers`), insurance records (`documents`
 * where `type = 'coi'`), shipper billing (`invoices`, `freight_quotes`) and
 * unrelated shipments (every row `broker_can_read_shipment()` returns false
 * for). `BROKER_DENIED_SOURCES` names them, and each entry is pinned by an
 * assertion in `supabase/tests/20_rls_isolation.sql` — because a TypeScript
 * allow-list cannot stop a SQL query, and only a policy can.
 *
 * Plain module by design (no `server-only`): the broker portal's client
 * components render the "what you cannot see here" copy from the same lists
 * the server enforces, and a second copy of them in client code is exactly
 * the drift this file exists to prevent.
 */

import {
  DOCUMENT_AUDIENCES,
  documentTypesForAudience,
} from "@/lib/shipments/documents";
import { AUDIENCE_EVENT_VISIBILITY } from "@/lib/shipments/dto";
import type {
  ShipmentDocumentType,
  ShipmentEventVisibility,
  ShipmentPartyRow,
  ShipmentRow,
} from "@/lib/shipments/types";

/* ------------------------------------------------------------------ *
 * §12's two lists, verbatim
 * ------------------------------------------------------------------ */

/** The six things §12 says a broker user MAY see, with where each is served. */
export const BROKER_MAY_SEE = [
  {
    id: "assigned_shipments",
    directive: "assigned shipments",
    servedBy:
      "broker_can_read_shipment() — party link, per-shipment grant or account agreement (0029)",
  },
  {
    id: "status",
    directive: "status",
    servedBy: "BrokerShipmentDto.status / .status_key (M-70 toBrokerDto)",
  },
  {
    id: "timeline",
    directive: "timeline",
    servedBy:
      "shipment_events in the `public` + `broker` bands (AUDIENCE_EVENT_VISIBILITY.broker)",
  },
  {
    id: "pod",
    directive: "POD",
    servedBy: "DOCUMENT_AUDIENCES.pod includes `broker` (M-77)",
  },
  {
    id: "bol_when_authorized",
    directive: "BOL, when authorized",
    servedBy:
      "DOCUMENT_AUDIENCES.bol includes `broker`; the authorization IS the shipment link",
  },
  {
    id: "approved_contact_channels",
    directive: "approved contact channels",
    servedBy:
      "shipment_parties WHERE public_contact = true (0018 + 0029 policies)",
  },
] as const;

export type BrokerAllowCategory = (typeof BROKER_MAY_SEE)[number]["id"];

/** The six things §12 says a broker user MUST NOT automatically see. */
export const BROKER_MUST_NOT_SEE = [
  {
    id: "carrier_private_packet",
    directive: "carrier's private packet",
    enforcedBy:
      "no broker policy on `carriers`, `documents`, `shipment_assignments`, `drivers`, `trucks`; `carrier_id` is a boolean in the DTO",
  },
  {
    id: "carrier_insurance_records",
    directive: "carrier insurance records",
    enforcedBy:
      "`documents` (type `coi`) has no broker policy; insurance is not a shipment_document type at all",
  },
  {
    id: "shipper_billing",
    directive: "shipper billing",
    enforcedBy:
      "no broker policy on `invoices` / `freight_quotes`; DOCUMENT_AUDIENCES.invoice excludes `broker`",
  },
  {
    id: "pickloads_commission",
    directive: "PickLoads commission",
    enforcedBy:
      "`gross_shipper_amount` AND `carrier_pay` are both denied — either one alone plus the other computes it",
  },
  {
    id: "internal_margin",
    directive: "internal margin",
    enforcedBy: "`margin` is named by toStaffDto and no other serializer",
  },
  {
    id: "unrelated_shipments",
    directive: "unrelated shipments",
    enforcedBy:
      "broker_can_read_shipment() returns false; §19's broker-A-vs-broker-B proof",
  },
] as const;

export type BrokerDirectiveDenyCategory =
  (typeof BROKER_MUST_NOT_SEE)[number]["id"];

/**
 * Why a field is denied.
 *
 * The first six are §12's own categories, quoted above. The last three are
 * denials §12 does not name and this module makes anyway — stated as their
 * own reasons rather than smuggled under a directive clause they do not
 * belong to, because a deny list whose justifications are approximate is a
 * deny list nobody can audit.
 */
export type BrokerDenyReason =
  | BrokerDirectiveDenyCategory
  | "counterparty_identity"
  | "internal_operations"
  | "access_credential";

/** Human-readable reasons, for the module doc's table and for tests. */
export const BROKER_DENY_REASON_TEXT: Record<BrokerDenyReason, string> = {
  carrier_private_packet: "§12 — carrier's private packet",
  carrier_insurance_records: "§12 — carrier insurance records",
  shipper_billing: "§12 — shipper billing",
  pickloads_commission: "§12 — PickLoads commission",
  internal_margin: "§12 — internal margin",
  unrelated_shipments: "§12 — unrelated shipments",
  counterparty_identity:
    "Beyond §12: the counterparty's internal id. Knowing WHICH shipper or carrier is a relationship fact PickLoads holds, not shipment data.",
  internal_operations:
    "Beyond §12: internal routing, staffing and configuration. Not about the freight.",
  access_credential:
    "Beyond §12: the §4 secondary-verification secret. Serialized for NO audience, staff included (M-70).",
};

/* ------------------------------------------------------------------ *
 * THE FIELD MATRIX
 * ------------------------------------------------------------------ */

/** How one `ShipmentRow` column reaches (or does not reach) a broker. */
export type BrokerFieldRule =
  /** Serialized under the same name. */
  | { readonly decision: "allow"; readonly under: BrokerAllowCategory }
  /** Serialized under a DIFFERENT name — the rename is the decision. */
  | {
      readonly decision: "allow_renamed";
      readonly as: string;
      readonly under: BrokerAllowCategory;
      readonly why: string;
    }
  /** Not serialized; a fact DERIVED from it is. */
  | {
      readonly decision: "allow_derived";
      readonly as: string;
      readonly under: BrokerAllowCategory;
      readonly why: string;
    }
  /** Never reaches a broker payload. */
  | { readonly decision: "deny"; readonly because: BrokerDenyReason };

/**
 * Every column of `ShipmentRow`, decided.
 *
 * Read a cell as: *"when a broker partner is authorized to read this
 * shipment at all, this column reaches them like so."* Authorization is a
 * different question, answered by `broker_can_read_shipment()` in 0029 —
 * this table decides WHAT, never WHICH.
 */
export const BROKER_FIELD_POLICY: Record<keyof ShipmentRow, BrokerFieldRule> = {
  /* ---- identity and reference (§12 "assigned shipments") ---- */
  id: { decision: "allow", under: "assigned_shipments" },
  tracking_number: { decision: "allow", under: "assigned_shipments" },
  shipper_reference: { decision: "allow", under: "assigned_shipments" },
  po_number: { decision: "allow", under: "assigned_shipments" },

  /* ---- status (§12 "status") ---- */
  status: { decision: "allow", under: "status" },
  completed_at: { decision: "allow", under: "status" },
  cancelled_at: { decision: "allow", under: "status" },
  cancellation_reason: { decision: "allow", under: "status" },
  created_at: { decision: "allow", under: "status" },
  updated_at: { decision: "allow", under: "status" },

  /* ---- the freight itself (§12 "assigned shipments") ---- */
  origin_company: { decision: "allow", under: "assigned_shipments" },
  origin_address: { decision: "allow", under: "assigned_shipments" },
  origin_city: { decision: "allow", under: "assigned_shipments" },
  origin_state: { decision: "allow", under: "assigned_shipments" },
  origin_zip: { decision: "allow", under: "assigned_shipments" },
  destination_company: { decision: "allow", under: "assigned_shipments" },
  destination_address: { decision: "allow", under: "assigned_shipments" },
  destination_city: { decision: "allow", under: "assigned_shipments" },
  destination_state: { decision: "allow", under: "assigned_shipments" },
  destination_zip: { decision: "allow", under: "assigned_shipments" },
  equipment: { decision: "allow", under: "assigned_shipments" },
  commodity_category: { decision: "allow", under: "assigned_shipments" },
  weight_lbs: { decision: "allow", under: "assigned_shipments" },
  pallets: { decision: "allow", under: "assigned_shipments" },
  distance_miles: { decision: "allow", under: "assigned_shipments" },

  /* ---- appointments and ETA (§12 "status") ---- */
  pickup_appointment_at: { decision: "allow", under: "status" },
  delivery_appointment_at: { decision: "allow", under: "status" },
  estimated_pickup_at: { decision: "allow", under: "status" },
  estimated_delivery_at: { decision: "allow", under: "status" },
  eta_source: { decision: "allow", under: "status" },
  eta_confidence: { decision: "allow", under: "status" },
  eta_updated_at: { decision: "allow", under: "status" },
  delay_minutes: { decision: "allow", under: "status" },
  delay_reason_public: {
    decision: "allow_renamed",
    as: "delay_reason",
    under: "status",
    why:
      "The DTO drops the `_public` suffix because the broker payload has no other delay reason to disambiguate from — and `delay_reason_internal` is denied below, so the name cannot become ambiguous by accident.",
  },

  /* ---- position (§9, inside §12's "status") ---- */
  tracking_mode: { decision: "allow", under: "status" },
  location_visibility: { decision: "allow", under: "status" },
  current_city: { decision: "allow", under: "status" },
  current_state: { decision: "allow", under: "status" },
  current_latitude: { decision: "allow", under: "status" },
  current_longitude: { decision: "allow", under: "status" },
  last_location_at: { decision: "allow", under: "status" },

  /* ---- the one derived cell ---- */
  carrier_id: {
    decision: "allow_derived",
    as: "carrier_assigned",
    under: "status",
    why:
      "§1 wants 'assigned carrier status' visible; §12 forbids the carrier's private packet. A boolean answers the first without opening the second — the broker learns a truck is booked, not whose.",
  },

  /* ---- §12's six prohibitions, at column level ---- */
  gross_shipper_amount: {
    decision: "deny",
    because: "shipper_billing",
  },
  carrier_pay: {
    decision: "deny",
    because: "pickloads_commission",
  },
  margin: { decision: "deny", because: "internal_margin" },
  shipper_id: { decision: "deny", because: "counterparty_identity" },
  broker_partner_id: {
    // Their OWN id would be harmless; the column is denied because the same
    // serializer runs for a shipment shared by grant, where the linked
    // partner is somebody else entirely. A field that is safe on one row and
    // a disclosure on the next is denied on all of them.
    decision: "deny",
    because: "counterparty_identity",
  },
  dispatcher_id: { decision: "deny", because: "internal_operations" },
  quote_id: { decision: "deny", because: "shipper_billing" },
  load_id: { decision: "deny", because: "internal_operations" },
  public_tracking_enabled: {
    decision: "deny",
    because: "internal_operations",
  },
  delay_reason_internal: {
    decision: "deny",
    because: "internal_operations",
  },
  public_access_hash: { decision: "deny", because: "access_credential" },
};

/** The `ShipmentRow` columns a broker payload may carry, in row order. */
export function brokerAllowedFields(): readonly (keyof ShipmentRow)[] {
  return (Object.keys(BROKER_FIELD_POLICY) as (keyof ShipmentRow)[]).filter(
    (field) => BROKER_FIELD_POLICY[field].decision !== "deny",
  );
}

/** The `ShipmentRow` columns a broker payload must never carry. */
export function brokerDeniedFields(): readonly (keyof ShipmentRow)[] {
  return (Object.keys(BROKER_FIELD_POLICY) as (keyof ShipmentRow)[]).filter(
    (field) => BROKER_FIELD_POLICY[field].decision === "deny",
  );
}

/**
 * The DTO key each allowed column produces.
 *
 * `allow` → the column name · `allow_renamed`/`allow_derived` → the stated
 * alias. This is what the key-set test compares `toBrokerDto` against, so a
 * rename that forgets this table fails rather than passes quietly.
 */
export function brokerDtoKeyFor(field: keyof ShipmentRow): string | null {
  const rule = BROKER_FIELD_POLICY[field];
  switch (rule.decision) {
    case "allow":
      return field;
    case "allow_renamed":
    case "allow_derived":
      return rule.as;
    case "deny":
      return null;
  }
}

/**
 * Keys `toBrokerDto` adds that are not columns at all.
 *
 * `status_key` is the i18n catalogue key for `status`; the three collections
 * are the timeline, the exception list and §9's position series. Listed
 * explicitly so the key-set test is exhaustive on BOTH sides — an unlisted
 * new key fails the test rather than being waved through as "derived".
 */
export const BROKER_NON_COLUMN_KEYS = [
  "status_key",
  "events",
  "exceptions",
  "locations",
] as const;

/* ------------------------------------------------------------------ *
 * Documents (§16's matrix, read through §12's eyes)
 * ------------------------------------------------------------------ */

/**
 * Which of §16's eleven document types reach a broker partner.
 *
 * DERIVED from M-77's `DOCUMENT_AUDIENCES` rather than restated, so the two
 * cannot disagree — and pinned by a test that asserts the derivation still
 * yields exactly `bol`, `pod` and `other`, which is what §12's *"POD; BOL,
 * when authorized"* plus M-77's escape hatch amount to.
 */
export const BROKER_DOCUMENT_TYPES: readonly ShipmentDocumentType[] =
  documentTypesForAudience("broker");

/** The same information as a full record, for the module doc's table. */
export const BROKER_DOCUMENT_POLICY: Record<
  ShipmentDocumentType,
  "allow" | "deny"
> = Object.fromEntries(
  (Object.keys(DOCUMENT_AUDIENCES) as ShipmentDocumentType[]).map((type) => [
    type,
    DOCUMENT_AUDIENCES[type].includes("broker") ? "allow" : "deny",
  ]),
) as Record<ShipmentDocumentType, "allow" | "deny">;

/* ------------------------------------------------------------------ *
 * Timeline and contacts
 * ------------------------------------------------------------------ */

/**
 * §12 "timeline". The bands are M-70's, not a second list — `public` +
 * `broker`, never the shipper's or carrier's commercial correspondence, never
 * `staff_only`. 0019's and 0029's event policies carry the identical clause.
 */
export const BROKER_EVENT_BANDS: readonly ShipmentEventVisibility[] =
  AUDIENCE_EVENT_VISIBILITY.broker;

/**
 * §12 "approved contact channels".
 *
 * A broker reads ONLY party rows dispatch marked shareable. This is stricter
 * than the shipper rule (M-74's `CARRIER_SIDE_ROLES`, which withholds
 * channels on the carrier row only): a shipper owns its own consignee and
 * billing counterparties; a broker partner owns none of them, and §12 gives
 * them "approved" channels rather than "the shipment's" channels.
 *
 * Enforced in SQL as well — 0018's and 0029's party policies both carry
 * `public_contact = true` — so this constant is the app-side statement of a
 * rule the database already keeps.
 */
export const BROKER_REQUIRES_PUBLIC_CONTACT = true as const;

/** The party columns a broker payload may carry. */
export const BROKER_CONTACT_COLUMNS = [
  "id",
  "party_role",
  "company_name",
  "contact_name",
  "phone",
  "email",
] as const satisfies readonly (keyof ShipmentPartyRow)[];

/* ------------------------------------------------------------------ *
 * The deny list beyond `shipments`
 * ------------------------------------------------------------------ */

export interface BrokerDeniedSource {
  /** Table (or table + qualifier) a broker session must read nothing from. */
  readonly source: string;
  /** Which §12 prohibition it serves. */
  readonly because: BrokerDirectiveDenyCategory;
  /** What stops it — always a policy or its absence, never app code. */
  readonly enforcedBy: string;
}

/**
 * §12's prohibitions that live outside the `shipments` row.
 *
 * Every entry has a matching assertion in `supabase/tests/20_rls_isolation.
 * sql` §7c/§16. That is deliberate: a TypeScript allow-list controls what a
 * serializer emits and controls NOTHING about what a hand-written query can
 * fetch. Only a policy — or the absence of one — does that.
 */
export const BROKER_DENIED_SOURCES: readonly BrokerDeniedSource[] = [
  {
    source: "carriers",
    because: "carrier_private_packet",
    enforcedBy: "0002/0009 grant no broker policy; RLS denies by default",
  },
  {
    source: "documents (the carrier packet, incl. type = 'coi')",
    because: "carrier_insurance_records",
    enforcedBy: "0002 policies are carrier-membership and staff scoped only",
  },
  {
    source: "shipment_assignments",
    because: "carrier_private_packet",
    enforcedBy: "0018 has staff + carrier-membership policies and no broker one",
  },
  {
    source: "drivers / trucks",
    because: "carrier_private_packet",
    enforcedBy: "0006 policies are carrier-membership and staff scoped only",
  },
  {
    source: "invoices",
    because: "shipper_billing",
    enforcedBy: "0009/0021 policies are carrier/shipper membership and staff",
  },
  {
    source: "freight_quotes",
    because: "shipper_billing",
    enforcedBy: "0002/0009 policies are shipper membership and staff",
  },
  {
    source: "shipment_documents WHERE doc_type IN ('invoice','quote')",
    because: "shipper_billing",
    enforcedBy:
      "0024's shipment_document_reaches_audience() — the `broker` cell is empty for both types",
  },
  {
    source: "shipment_documents WHERE doc_type = 'rate_confirmation'",
    because: "pickloads_commission",
    enforcedBy:
      "0024's matrix — `rate_confirmation` reaches `carrier` only, and it names the carrier's rate",
  },
  {
    source: "shipments the partner holds no link, grant or agreement for",
    because: "unrelated_shipments",
    enforcedBy: "0029's broker_can_read_shipment() returns false",
  },
  {
    source: "shipment_events WHERE visibility IN ('shipper','carrier','staff_only')",
    because: "unrelated_shipments",
    enforcedBy: "0019 + 0029 band clause: `visibility in ('public','broker')`",
  },
];
