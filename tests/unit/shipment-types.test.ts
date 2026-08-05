import { describe, expect, it } from "vitest";
import {
  ETA_CONFIDENCES,
  ETA_KINDS,
  ETA_SOURCES,
  eventTypeKey,
  exceptionSeverityKey,
  exceptionTypeKey,
  SHIPMENT_DOCUMENT_TYPES,
  SHIPMENT_DOCUMENT_VISIBILITIES,
  SHIPMENT_EVENT_SOURCES,
  SHIPMENT_EVENT_TYPES,
  SHIPMENT_EVENT_VISIBILITIES,
  SHIPMENT_EXCEPTION_SEVERITIES,
  SHIPMENT_EXCEPTION_TYPES,
  SHIPMENT_I18N_NAMESPACE,
  SHIPMENT_LOCATION_VISIBILITIES,
  SHIPMENT_PARTY_ROLES,
  SHIPMENT_STATUSES,
  SHIPMENT_TRACKING_MODES,
  statusKey,
  TRACKING_ACCESS_OUTCOMES,
  TRACKING_CONSENT_STATUSES,
  TRACKING_PROVIDERS,
  type ShipmentStatus,
} from "@/lib/shipments/types";

/**
 * M-70 — the domain vocabulary M-71's DDL is written from.
 *
 * Every list below is quoted from the directive, so a drift here is a drift
 * from the specification, not a style change. The `satisfies Record<…>`
 * guards make an unhandled new member a COMPILE error rather than a runtime
 * surprise three modules later.
 */

/**
 * §6's own numbering, 1…18. The compile-time guard is the point: adding a
 * nineteenth `ShipmentStatus` without deciding where it sits in the lifecycle
 * fails `npm run typecheck`.
 */
const LIFECYCLE_ORDER = {
  quote_requested: 1,
  quote_sent: 2,
  quote_accepted: 3,
  carrier_search: 4,
  carrier_assigned: 5,
  dispatched: 6,
  en_route_to_pickup: 7,
  arrived_at_pickup: 8,
  loading: 9,
  picked_up: 10,
  in_transit: 11,
  delayed: 12,
  arrived_at_delivery: 13,
  unloading: 14,
  delivered: 15,
  pod_uploaded: 16,
  completed: 17,
  cancelled: 18,
} satisfies Record<ShipmentStatus, number>;

describe("§6 shipment status model", () => {
  it("carries all 18 statuses in the directive's lifecycle order", () => {
    expect(SHIPMENT_STATUSES).toHaveLength(18);
    const byDirective = Object.entries(LIFECYCLE_ORDER)
      .sort((a, b) => a[1] - b[1])
      .map(([status]) => status);
    expect([...SHIPMENT_STATUSES]).toEqual(byDirective);
  });

  it("covers the exhaustiveness record exactly — no extras, no omissions", () => {
    expect(new Set(SHIPMENT_STATUSES).size).toBe(SHIPMENT_STATUSES.length);
    expect([...SHIPMENT_STATUSES].sort()).toEqual(
      Object.keys(LIFECYCLE_ORDER).sort(),
    );
  });

  it("names the pre-carrier statuses that made a new table necessary", () => {
    // Plan §1: the first four statuses have no carrier at all, which
    // `loads.carrier_id NOT NULL` cannot express.
    expect([...SHIPMENT_STATUSES].slice(0, 4)).toEqual([
      "quote_requested",
      "quote_sent",
      "quote_accepted",
      "carrier_search",
    ]);
  });
});

describe("§7 timeline enums", () => {
  it("lists the eight event sources the directive names", () => {
    expect([...SHIPMENT_EVENT_SOURCES]).toEqual([
      "dispatcher",
      "carrier",
      "driver",
      "eld",
      "gps",
      "system",
      "admin",
      "shipper",
    ]);
  });

  it("adds a broker band to §7's four visibility levels", () => {
    // §7 names four. `broker` is the deliberate addition recorded in
    // FINAL-IMPLEMENTATION-PLAN §4: without it, §12's broker-authorized
    // access has no band of its own and is unimplementable.
    expect([...SHIPMENT_EVENT_VISIBILITIES]).toEqual([
      "public",
      "shipper",
      "carrier",
      "broker",
      "staff_only",
    ]);
    expect(SHIPMENT_EVENT_VISIBILITIES).toContain("staff_only");
  });

  it("gives every §14 dispatcher action an event type", () => {
    for (const required of [
      "status_change",
      "location_update",
      "eta_update",
      "appointment_set",
      "appointment_rescheduled",
      "assignment_created",
      "assignment_released",
      "document_uploaded",
      "pod_requested",
      "exception_opened",
      "exception_resolved",
      "public_update",
      "internal_note",
      "call_logged",
      "email_logged",
      "notification_sent",
      "correction",
      "cancellation",
    ]) {
      expect(SHIPMENT_EVENT_TYPES).toContain(required);
    }
  });
});

describe("§9 tracking and location privacy", () => {
  it("supports Modes A, B and C", () => {
    expect([...SHIPMENT_TRACKING_MODES]).toEqual(["manual", "link", "eld"]);
  });

  it("carries the four location-visibility levels, most to least revealing", () => {
    expect([...SHIPMENT_LOCATION_VISIBILITIES]).toEqual([
      "exact",
      "approximate",
      "milestone_only",
      "hidden",
    ]);
  });

  it("names the telematics providers §9 lists, and no fake connection", () => {
    expect([...TRACKING_PROVIDERS]).toEqual([
      "motive",
      "samsara",
      "geotab",
      "verizon_connect",
      "other",
    ]);
  });

  it("models driver consent as a first-class state", () => {
    expect(TRACKING_CONSENT_STATUSES).toContain("granted");
    expect(TRACKING_CONSENT_STATUSES).toContain("revoked");
  });
});

describe("§10 ETA enums", () => {
  it("carries the four ETA sources the directive names", () => {
    expect([...ETA_SOURCES]).toEqual([
      "manual",
      "calculated",
      "provider",
      "dispatcher_adjusted",
    ]);
  });

  it("keeps confidence to three honest bands", () => {
    expect([...ETA_CONFIDENCES]).toEqual(["high", "medium", "low"]);
    expect([...ETA_KINDS]).toEqual(["pickup", "delivery"]);
  });
});

describe("§16 documents", () => {
  it("covers the eleven document kinds §16 lists", () => {
    expect(SHIPMENT_DOCUMENT_TYPES).toHaveLength(11);
    for (const required of ["bol", "pod", "rate_confirmation", "invoice"]) {
      expect(SHIPMENT_DOCUMENT_TYPES).toContain(required);
    }
  });

  it("carries the broker band §12 needs for 'BOL, when authorized'", () => {
    expect(SHIPMENT_DOCUMENT_VISIBILITIES).toContain("broker");
    expect([...SHIPMENT_DOCUMENT_VISIBILITIES]).toEqual([
      ...SHIPMENT_EVENT_VISIBILITIES,
    ]);
  });
});

describe("§21 exceptions", () => {
  it("carries all 13 exception types in the directive's order", () => {
    expect(SHIPMENT_EXCEPTION_TYPES).toHaveLength(13);
    expect([...SHIPMENT_EXCEPTION_TYPES]).toEqual([
      "pickup_delay",
      "delivery_delay",
      "mechanical_issue",
      "weather",
      "traffic",
      "facility_delay",
      "rejected_freight",
      "damaged_freight",
      "missing_appointment",
      "driver_unavailable",
      "carrier_cancellation",
      "documentation_issue",
      "other",
    ]);
  });

  it("orders severity low → critical", () => {
    expect([...SHIPMENT_EXCEPTION_SEVERITIES]).toEqual([
      "low",
      "medium",
      "high",
      "critical",
    ]);
  });
});

describe("supporting enums", () => {
  it("has no duplicate members in any exported list", () => {
    const lists: Array<readonly string[]> = [
      SHIPMENT_STATUSES,
      SHIPMENT_EVENT_TYPES,
      SHIPMENT_EVENT_SOURCES,
      SHIPMENT_EVENT_VISIBILITIES,
      SHIPMENT_TRACKING_MODES,
      SHIPMENT_LOCATION_VISIBILITIES,
      TRACKING_PROVIDERS,
      TRACKING_CONSENT_STATUSES,
      ETA_SOURCES,
      ETA_CONFIDENCES,
      ETA_KINDS,
      SHIPMENT_DOCUMENT_TYPES,
      SHIPMENT_DOCUMENT_VISIBILITIES,
      SHIPMENT_EXCEPTION_TYPES,
      SHIPMENT_EXCEPTION_SEVERITIES,
      SHIPMENT_PARTY_ROLES,
      TRACKING_ACCESS_OUTCOMES,
    ];
    for (const list of lists) {
      expect(new Set(list).size).toBe(list.length);
      for (const member of list) {
        // Postgres enum labels and i18n key segments alike.
        expect(member).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it("distinguishes an enumeration attempt from a bad second factor", () => {
    // §19 "prevents enumeration": M-73 must be able to tell these apart in
    // `shipment_tracking_access` without inferring it from a null column.
    expect(TRACKING_ACCESS_OUTCOMES).toContain("not_found");
    expect(TRACKING_ACCESS_OUTCOMES).toContain("bad_secondary");
    expect(TRACKING_ACCESS_OUTCOMES).toContain("rate_limited");
  });
});

describe("i18n keys (§24, §30)", () => {
  it("returns a namespaced key for every status — never an English label", () => {
    for (const status of SHIPMENT_STATUSES) {
      expect(statusKey(status)).toBe(`shipment.status.${status}`);
      expect(statusKey(status).startsWith(SHIPMENT_I18N_NAMESPACE)).toBe(true);
    }
  });

  it("produces distinct keys for every member of every labelled enum", () => {
    const keys = [
      ...SHIPMENT_STATUSES.map(statusKey),
      ...SHIPMENT_EVENT_TYPES.map(eventTypeKey),
      ...SHIPMENT_EXCEPTION_TYPES.map(exceptionTypeKey),
      ...SHIPMENT_EXCEPTION_SEVERITIES.map(exceptionSeverityKey),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^shipment\.[a-z]+\.[a-z0-9_]+$/);
    }
  });
});
