import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ru from "../../messages/ru.json";
import ht from "../../messages/ht.json";

import {
  FREE_TEXT_LANG,
  FREE_TEXT_NOTICE_KEY,
  PUBLIC_PHRASES,
  PUBLIC_PHRASE_IDS,
  phraseKey,
  phraseToken,
  resolvePublicText,
} from "@/lib/shipments/phrases";
import {
  PUBLIC_MILESTONES,
  buildPublicTimeline,
  milestoneKey,
  timelineTextEquivalent,
} from "@/lib/shipments/public-timeline";
import { toPublicTrackingDto } from "@/lib/shipments/dto";
import {
  SHIPMENT_EVENT_TYPES,
  SHIPMENT_EXCEPTION_SEVERITIES,
  SHIPMENT_EXCEPTION_TYPES,
  SHIPMENT_STATUSES,
  eventTypeKey,
  exceptionSeverityKey,
  exceptionTypeKey,
  statusKey,
} from "@/lib/shipments/types";
import type {
  ShipmentEventRow,
  ShipmentExceptionRow,
  ShipmentRow,
  ShipmentStatus,
} from "@/lib/shipments/types";
import { TRACKING_ERROR_KEYS } from "@/lib/shipments/public-tracking-state";

/**
 * M-73 — the customer-facing half: decision D-6's phrase library, §8's
 * milestone timeline, §23's text equivalent and §24/§30's five-locale
 * catalogue.
 *
 * The catalogue assertions matter more than they look. A key with no
 * translation does not fail a build, it renders as `shipment.status.delayed`
 * on somebody's tracking page — so every key the code can generate is walked
 * against all five dictionaries here, and the six §30 honest labels are
 * asserted by name because the directive names them by name.
 */

const CATALOGUES = { en, es, fr, ru, ht } as Record<
  string,
  Record<string, unknown>
>;
const LOCALES = Object.keys(CATALOGUES);

function lookup(catalogue: Record<string, unknown>, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      catalogue,
    );
}

function expectKeyInEveryLocale(key: string) {
  for (const locale of LOCALES) {
    const value = lookup(CATALOGUES[locale] ?? {}, key);
    expect(typeof value, `${locale} is missing ${key}`).toBe("string");
    expect(String(value).trim().length, `${locale}:${key} is empty`).toBeGreaterThan(0);
  }
}

/* ================================================================== *
 * D-6 — the curated phrase library
 * ================================================================== */

describe("phrase library (decision D-6)", () => {
  it("resolves a token to a translated message key", () => {
    const resolved = resolvePublicText(phraseToken("delay.traffic"));
    expect(resolved).toEqual({
      kind: "phrase",
      id: "delay.traffic",
      key: "shipment.phrase.delay.traffic",
    });
  });

  it("resolves the library's own English sentence typed by hand", () => {
    const resolved = resolvePublicText(
      "  the truck needs a repair before it can continue!  ",
    );
    expect(resolved?.kind).toBe("phrase");
    if (resolved?.kind !== "phrase") return;
    expect(resolved.id).toBe("delay.mechanical");
  });

  it("labels genuinely novel dispatcher prose as free text, in English", () => {
    const resolved = resolvePublicText(
      "Receiver moved the appointment to Thursday 6am because of a plant shutdown.",
    );
    expect(resolved).toEqual({
      kind: "free_text",
      text: "Receiver moved the appointment to Thursday 6am because of a plant shutdown.",
      noticeKey: FREE_TEXT_NOTICE_KEY,
      lang: FREE_TEXT_LANG,
    });
    // §24: never machine-translated, and never silently presented as if it
    // had been written in the reader's language.
    expectKeyInEveryLocale(FREE_TEXT_NOTICE_KEY);
  });

  it("degrades a RETIRED token visibly, as free text, not as a blank", () => {
    const resolved = resolvePublicText("phrase:delay.no_longer_exists");
    expect(resolved?.kind).toBe("free_text");
    if (resolved?.kind !== "free_text") return;
    expect(resolved.text).toBe("phrase:delay.no_longer_exists");
  });

  it("returns null for absent or blank text — no empty banner", () => {
    expect(resolvePublicText(null)).toBeNull();
    expect(resolvePublicText(undefined)).toBeNull();
    expect(resolvePublicText("   ")).toBeNull();
  });

  it("every library id has a translation in all five locales", () => {
    expect(PUBLIC_PHRASE_IDS.length).toBeGreaterThan(20);
    for (const id of PUBLIC_PHRASE_IDS) {
      expectKeyInEveryLocale(phraseKey(id));
    }
  });

  it("the library and the catalogue have not drifted apart", () => {
    const catalogued = flattenPhraseKeys(
      (en.shipment as Record<string, unknown>).phrase as Record<string, unknown>,
    ).sort();
    expect(catalogued).toEqual([...PUBLIC_PHRASE_IDS].sort());
  });

  it("no library sentence claims live tracking or AI (§30)", () => {
    const forbidden = [
      "live tracking",
      "real-time",
      "realtime",
      "ai-powered",
      "ai powered",
      "artificial intelligence",
      "gps position",
    ];
    for (const text of Object.values(PUBLIC_PHRASES)) {
      const lower = text.toLowerCase();
      for (const term of forbidden) {
        expect(lower.includes(term), `"${text}" contains "${term}"`).toBe(false);
      }
    }
  });

  it("NON-VACUITY: the §30 scan catches a sentence that DOES over-claim", () => {
    const bad = "Our AI-powered real-time live tracking follows your truck.";
    const hits = ["live tracking", "real-time", "ai-powered"].filter((t) =>
      bad.toLowerCase().includes(t),
    );
    expect(hits).toHaveLength(3);
  });
});

function flattenPhraseKeys(
  node: Record<string, unknown>,
  prefix = "",
): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") out.push(path);
    else out.push(...flattenPhraseKeys(value as Record<string, unknown>, path));
  }
  return out;
}

/* ================================================================== *
 * §8 — the milestone timeline
 * ================================================================== */

const BASE_ROW: ShipmentRow = {
  id: "s-1",
  tracking_number: "PL-2026-000101",
  shipper_id: "sh-1",
  carrier_id: "ca-1",
  dispatcher_id: null,
  quote_id: null,
  broker_partner_id: null,
  load_id: null,
  status: "in_transit",
  origin_company: null,
  origin_address: null,
  origin_city: "Newark",
  origin_state: "NJ",
  origin_zip: null,
  destination_company: null,
  destination_address: null,
  destination_city: "Atlanta",
  destination_state: "GA",
  destination_zip: null,
  pickup_appointment_at: null,
  delivery_appointment_at: null,
  equipment: "dry-van",
  commodity_category: null,
  weight_lbs: null,
  pallets: null,
  distance_miles: null,
  gross_shipper_amount: null,
  carrier_pay: null,
  margin: null,
  shipper_reference: null,
  po_number: null,
  public_tracking_enabled: true,
  tracking_mode: "manual",
  location_visibility: "approximate",
  public_access_hash: null,
  current_latitude: null,
  current_longitude: null,
  current_city: null,
  current_state: null,
  last_location_at: null,
  estimated_pickup_at: null,
  estimated_delivery_at: null,
  eta_source: null,
  eta_confidence: null,
  eta_updated_at: null,
  delay_minutes: null,
  delay_reason_public: null,
  delay_reason_internal: null,
  created_at: "2026-07-30T09:00:00.000Z",
  updated_at: "2026-07-30T09:00:00.000Z",
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
};

function statusEvent(
  status: ShipmentStatus,
  eventTime: string,
): ShipmentEventRow {
  return {
    id: `e-${status}-${eventTime}`,
    shipment_id: "s-1",
    event_type: "status_change",
    status,
    event_time: eventTime,
    recorded_at: eventTime,
    source: "dispatcher",
    created_by: null,
    city: null,
    state: null,
    latitude: null,
    longitude: null,
    public_message: null,
    internal_message: null,
    visibility: "public",
    metadata: {},
    external_event_id: null,
    idempotency_key: null,
  };
}

function dto(
  status: ShipmentStatus,
  events: ShipmentEventRow[] = [],
  exceptions: ShipmentExceptionRow[] = [],
) {
  return toPublicTrackingDto({
    shipment: { ...BASE_ROW, status },
    events,
    exceptions,
  });
}

describe("public timeline (§8)", () => {
  it("renders §8's nine milestones, in the directive's order", () => {
    expect(PUBLIC_MILESTONES).toEqual([
      "quote_accepted",
      "carrier_assigned",
      "dispatched",
      "arrived_at_pickup",
      "picked_up",
      "in_transit",
      "arrived_at_delivery",
      "delivered",
      "pod_uploaded",
    ]);
  });

  it("marks earlier steps complete, the current one current and the rest inactive", () => {
    const timeline = buildPublicTimeline(dto("in_transit"));
    expect(timeline.steps.map((s) => s.state)).toEqual([
      "complete",
      "complete",
      "complete",
      "complete",
      "complete",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(timeline.completedCount).toBe(5);
    expect(timeline.total).toBe(9);
  });

  it("stamps a completed step with the EARLIEST event that asserted it", () => {
    const timeline = buildPublicTimeline(
      dto("in_transit", [
        statusEvent("in_transit", "2026-08-03T18:00:00.000Z"),
        statusEvent("in_transit", "2026-08-02T09:00:00.000Z"),
        statusEvent("picked_up", "2026-08-01T14:00:00.000Z"),
      ]),
    );
    const inTransit = timeline.steps.find((s) => s.milestone === "in_transit");
    // A shipment that goes in_transit → delayed → in_transit has two events;
    // "when did it start moving" is the first one, and a §20 correction that
    // re-asserts a status must not redate the history.
    expect(inTransit?.at).toBe("2026-08-02T09:00:00.000Z");
  });

  it("does NOT un-draw progress when a shipment is delayed", () => {
    const timeline = buildPublicTimeline(
      dto("delayed", [
        statusEvent("picked_up", "2026-08-01T14:00:00.000Z"),
        statusEvent("in_transit", "2026-08-02T09:00:00.000Z"),
      ]),
    );
    // `delayed` is twelfth in the enum and has no position on §8's bar;
    // progress comes from the timeline instead.
    expect(timeline.currentIndex).toBe(5);
    expect(timeline.exception).toBe(true);
    expect(
      timeline.steps.find((s) => s.milestone === "in_transit")?.state,
    ).toBe("exception");
  });

  it("shows how far a CANCELLED shipment got, with no current step", () => {
    const timeline = buildPublicTimeline(
      dto("cancelled", [statusEvent("carrier_assigned", "2026-08-01T09:00:00.000Z")]),
    );
    expect(timeline.cancelled).toBe(true);
    expect(timeline.currentIndex).toBe(-1);
    expect(timeline.steps.filter((s) => s.state === "current")).toHaveLength(0);
    expect(timeline.completedCount).toBe(2);
  });

  it("treats a shipment that has not started as nothing complete", () => {
    const timeline = buildPublicTimeline(dto("quote_requested"));
    expect(timeline.completedCount).toBe(0);
    expect(timeline.steps.every((s) => s.state === "upcoming")).toBe(true);
    expect(timelineTextEquivalent(timeline).currentKey).toBeNull();
  });

  it("treats `completed` as everything the customer can see being done", () => {
    const timeline = buildPublicTimeline(dto("completed"));
    expect(timeline.steps.at(-1)?.state).toBe("current");
    expect(timeline.completedCount).toBe(8);
  });

  it("raises the exception state from an UNRESOLVED exception", () => {
    const open: ShipmentExceptionRow = {
      id: "x-1",
      shipment_id: "s-1",
      exception_type: "facility_delay",
      severity: "medium",
      public_description: "phrase:exception.facility_delay",
      internal_description: null,
      opened_at: "2026-08-03T10:00:00.000Z",
      resolved_at: null,
      opened_by: null,
      assigned_to: null,
      customer_notified_at: null,
      resolution: null,
    };
    expect(buildPublicTimeline(dto("in_transit", [], [open])).exception).toBe(
      true,
    );
    expect(
      buildPublicTimeline(
        dto("in_transit", [], [{ ...open, resolved_at: "2026-08-03T14:00:00.000Z" }]),
      ).exception,
    ).toBe(false);
  });

  it("is pure — the same input yields the same output", () => {
    const input = dto("picked_up", [statusEvent("picked_up", "2026-08-01T14:00:00.000Z")]);
    expect(buildPublicTimeline(input)).toEqual(buildPublicTimeline(input));
  });

  it("produces the §23 text equivalent as values, never English", () => {
    const timeline = buildPublicTimeline(dto("in_transit"));
    const text = timelineTextEquivalent(timeline);
    expect(text).toEqual({
      completed: 5,
      total: 9,
      currentKey: "shipment.milestone.in_transit",
      currentAt: null,
      cancelled: false,
      exception: false,
    });
  });
});

/* ================================================================== *
 * §24 / §30 — the five-locale catalogue
 * ================================================================== */

describe("the shipment catalogue (§24)", () => {
  it("exists as its own namespace in all five dictionaries", () => {
    for (const locale of LOCALES) {
      expect(CATALOGUES[locale], `${locale}.json`).toHaveProperty("shipment");
    }
  });

  it("translates every §6 status, in every locale", () => {
    for (const status of SHIPMENT_STATUSES) expectKeyInEveryLocale(statusKey(status));
  });

  it("translates every §7 event type, in every locale", () => {
    for (const type of SHIPMENT_EVENT_TYPES) expectKeyInEveryLocale(eventTypeKey(type));
  });

  it("translates every §21 exception type and severity, in every locale", () => {
    for (const type of SHIPMENT_EXCEPTION_TYPES) {
      expectKeyInEveryLocale(exceptionTypeKey(type));
    }
    for (const severity of SHIPMENT_EXCEPTION_SEVERITIES) {
      expectKeyInEveryLocale(exceptionSeverityKey(severity));
    }
  });

  it("translates every §8 milestone label, in every locale", () => {
    for (const milestone of PUBLIC_MILESTONES) {
      expectKeyInEveryLocale(milestoneKey(milestone));
    }
  });

  it("translates every lookup error, in every locale", () => {
    for (const key of Object.values(TRACKING_ERROR_KEYS)) {
      expectKeyInEveryLocale(key);
    }
  });

  it("carries all SIX §30 honest labels, in every locale", () => {
    // Named individually because §30 names them individually. Losing one is a
    // silent regression in the product's honesty, not a missing string.
    for (const key of [
      "shipment.label.last_updated_by_dispatch",
      "shipment.label.milestone_tracking",
      "shipment.label.live_location_available",
      "shipment.label.location_unavailable",
      "shipment.label.eta_by_dispatcher",
      "shipment.label.tracking_link_expired",
    ]) {
      expectKeyInEveryLocale(key);
    }
  });

  it("es and fr are genuinely authored, not English copies", () => {
    // The ru/ht mirror is a declared policy (docs/LAUNCH-RUNBOOK.md, native
    // review pending). es/fr are not — if they ever silently became copies,
    // the "five locales" claim would be a quarter true.
    const sample = ["status.in_transit", "form.submit", "error.refused"];
    for (const key of sample) {
      const enValue = lookup(en, `shipment.${key}`);
      expect(lookup(es, `shipment.${key}`)).not.toBe(enValue);
      expect(lookup(fr, `shipment.${key}`)).not.toBe(enValue);
    }
  });

  it("NON-VACUITY: the walker reports a key that genuinely is missing", () => {
    expect(() =>
      expectKeyInEveryLocale("shipment.status.this_key_does_not_exist"),
    ).toThrow();
  });

  it("no page copy claims live tracking or AI (§30)", () => {
    const shipment = (en as Record<string, unknown>).shipment as Record<
      string,
      unknown
    >;
    const strings: string[] = [];
    const walk = (node: Record<string, unknown>) => {
      for (const value of Object.values(node)) {
        if (typeof value === "string") strings.push(value.toLowerCase());
        else walk(value as Record<string, unknown>);
      }
    };
    walk(shipment);
    expect(strings.length).toBeGreaterThan(150);
    for (const forbidden of [
      "live tracking",
      "real-time",
      "realtime",
      "ai-powered",
      "ai powered",
      "artificial intelligence",
      "machine learning",
    ]) {
      const offenders = strings.filter((s) => s.includes(forbidden));
      expect(offenders, `copy claims "${forbidden}"`).toEqual([]);
    }
  });
});
