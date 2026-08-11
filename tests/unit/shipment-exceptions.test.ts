import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  toBrokerDto,
  toCarrierDto,
  toPublicTrackingDto,
  toShipperDto,
  toStaffDto,
} from "@/lib/shipments/dto";
import { toCustomerExceptionRows } from "@/lib/shipments/exceptions";
import {
  PHRASE_GROUPS,
  PUBLIC_PHRASES,
  PUBLIC_PHRASE_IDS,
  phraseKey,
  phraseToken,
  phrasesInGroup,
  resolvePublicText,
} from "@/lib/shipments/phrases";
import {
  logExceptionSchema,
  resolveExceptionSchema,
  triageExceptionSchema,
} from "@/lib/validation/dispatcher-shipments";
import {
  SHIPMENT_EXCEPTION_SEVERITIES,
  SHIPMENT_EXCEPTION_TYPES,
  type ShipmentExceptionRow,
  type ShipmentRow,
} from "@/lib/shipments/types";

/**
 * M-78 — §21's exception system, at the layers a unit test can reach:
 * lifecycle VALIDATION, customer-facing HONESTY, and the D-6 phrase-library
 * extension. The SQL half (open → resolve, the one-way rules, the backfill)
 * is `tests/integration/shipment-eta-exceptions.test.ts`, and the per-audience
 * row visibility is `supabase/tests/20_rls_isolation.sql` — those need a real
 * database and are proved there rather than mocked here.
 */

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Unique, greppable values. None can occur by accident. */
const S = {
  internal: "SENTINEL-M78-internal-blame-do-not-leak",
  resolution: "SENTINEL-M78-resolution-do-not-leak",
  sourceEvent: "SENTINEL-M78-source-event-id",
} as const;

function exceptionRow(
  overrides: Partial<ShipmentExceptionRow> = {},
): ShipmentExceptionRow {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    shipment_id: "11111111-1111-4111-8111-111111111111",
    exception_type: "facility_delay",
    severity: "high",
    public_description: "phrase:exception.facility_delay",
    internal_description: S.internal,
    opened_at: "2026-08-07T08:00:00.000Z",
    resolved_at: null,
    opened_by: "44444444-4444-4444-8444-444444444444",
    assigned_to: "44444444-4444-4444-8444-444444444444",
    customer_notified_at: "2026-08-07T08:05:00.000Z",
    resolution: S.resolution,
    source_event_id: S.sourceEvent,
    resolution_event_id: null,
    ...overrides,
  };
}

function shipmentRow(): ShipmentRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tracking_number: "PL-2026-000458",
    shipper_id: "22222222-2222-4222-8222-222222222222",
    carrier_id: "33333333-3333-4333-8333-333333333333",
    dispatcher_id: null,
    quote_id: null,
    broker_partner_id: "66666666-6666-4666-8666-666666666666",
    load_id: null,
    status: "in_transit",
    origin_company: null,
    origin_address: null,
    origin_city: "Newark",
    origin_state: "NJ",
    origin_zip: null,
    destination_company: null,
    destination_address: null,
    destination_city: "Columbus",
    destination_state: "OH",
    destination_zip: null,
    pickup_appointment_at: null,
    delivery_appointment_at: null,
    equipment: "dry_van",
    commodity_category: null,
    weight_lbs: null,
    pallets: null,
    distance_miles: 480,
    gross_shipper_amount: null,
    carrier_pay: null,
    margin: null,
    shipper_reference: null,
    po_number: null,
    public_tracking_enabled: true,
    tracking_mode: "manual",
    location_visibility: "milestone_only",
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
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-07T00:00:00.000Z",
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
  };
}

const CUSTOMER_SERIALIZERS = {
  public: toPublicTrackingDto,
  shipper: toShipperDto,
  carrier: toCarrierDto,
  broker: toBrokerDto,
} as const;

/* ------------------------------------------------------------------ *
 * 1. §21 — internal commentary never crosses the DTO boundary
 * ------------------------------------------------------------------ */

describe("§21 — 'do not expose blame, legal conclusions or internal commentary'", () => {
  const input = {
    shipment: shipmentRow(),
    exceptions: [exceptionRow()],
  };

  it.each(Object.keys(CUSTOMER_SERIALIZERS) as (keyof typeof CUSTOMER_SERIALIZERS)[])(
    "the %s payload carries neither the internal description nor the resolution",
    (audience) => {
      const json = JSON.stringify(CUSTOMER_SERIALIZERS[audience](input));
      expect(json).not.toContain(S.internal);
      expect(json).not.toContain(S.resolution);
      expect(json).not.toContain(S.sourceEvent);
    },
  );

  it("NON-VACUITY: the STAFF payload DOES carry all three", () => {
    // Without this, every assertion above could pass because the fixture was
    // empty rather than because the serializers withheld anything.
    const json = JSON.stringify(toStaffDto(input));
    expect(json).toContain(S.internal);
    expect(json).toContain(S.resolution);
    expect(json).toContain(S.sourceEvent);
  });

  it("NON-VACUITY: a naive passthrough serializer LEAKS all three", () => {
    const naive = JSON.stringify({ exceptions: [exceptionRow()] });
    expect(naive).toContain(S.internal);
    expect(naive).toContain(S.resolution);
  });

  it("emits the customer exception with exactly seven keys", () => {
    const dto = toShipperDto(input);
    expect(Object.keys(dto.exceptions[0] ?? {}).sort()).toEqual(
      [
        "exception_type",
        "exception_type_key",
        "severity",
        "severity_key",
        "description",
        "opened_at",
        "resolved_at",
      ].sort(),
    );
  });

  it("omits an exception with nothing honest to publish, rather than a blank alarm", () => {
    const dto = toShipperDto({
      shipment: shipmentRow(),
      exceptions: [exceptionRow({ public_description: null })],
    });
    expect(dto.exceptions).toEqual([]);
    // …and the staff view still shows it, because dispatch is working on it.
    expect(
      toStaffDto({
        shipment: shipmentRow(),
        exceptions: [exceptionRow({ public_description: null })],
      }).exceptions,
    ).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The customer read widener writes the withheld fields as nulls
 * ------------------------------------------------------------------ */

describe("toCustomerExceptionRows — the withheld columns are null, not absent", () => {
  const rows = toCustomerExceptionRows([
    {
      id: "ex-1",
      shipment_id: "sh-1",
      exception_type: "weather",
      severity: "medium",
      public_description: "phrase:exception.weather",
      opened_at: "2026-08-07T08:00:00.000Z",
      resolved_at: null,
    },
  ]);

  it("produces a full ShipmentExceptionRow shape", () => {
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      Object.keys(exceptionRow()).sort(),
    );
  });

  it("sets every field §21 forbids to null, so the value is not in the process", () => {
    const row = rows[0]!;
    expect(row.internal_description).toBeNull();
    expect(row.resolution).toBeNull();
    expect(row.opened_by).toBeNull();
    expect(row.assigned_to).toBeNull();
    expect(row.customer_notified_at).toBeNull();
    expect(row.source_event_id).toBeNull();
    expect(row.resolution_event_id).toBeNull();
  });

  it("keeps what the customer IS entitled to", () => {
    expect(rows[0]?.public_description).toBe("phrase:exception.weather");
    expect(rows[0]?.severity).toBe("medium");
    expect(rows[0]?.exception_type).toBe("weather");
  });

  it("STRUCTURAL: neither forbidden column is named in the customer projection", () => {
    const source = readFileSync("src/lib/shipments/exceptions.ts", "utf8");
    const projection = source.slice(
      source.indexOf("PUBLIC_EXCEPTION_COLUMNS"),
      source.indexOf("PUBLIC_EXCEPTION_COLUMNS") + 400,
    );
    expect(projection).not.toContain("internal_description");
    expect(projection).not.toContain("resolution");
  });
});

/* ------------------------------------------------------------------ *
 * 3. Lifecycle validation — the layer that explains itself
 * ------------------------------------------------------------------ */

describe("§21 lifecycle validation (the Zod layer)", () => {
  const SHIPMENT = "11111111-1111-4111-8111-111111111111";
  const EXCEPTION = "88888888-8888-4888-8888-888888888888";

  it("accepts all thirteen §21 types and all four severities", () => {
    for (const exception_type of SHIPMENT_EXCEPTION_TYPES) {
      for (const severity of SHIPMENT_EXCEPTION_SEVERITIES) {
        const parsed = logExceptionSchema.safeParse({
          shipment_id: SHIPMENT,
          exception_type,
          severity,
          public_description: "",
          internal_description: "Dock closed.",
        });
        expect(parsed.success, `${exception_type}/${severity}`).toBe(true);
      }
    }
  });

  it("refuses a type outside §21's list — statuses and exceptions are not free text", () => {
    expect(
      logExceptionSchema.safeParse({
        shipment_id: SHIPMENT,
        exception_type: "act_of_god",
        severity: "high",
        internal_description: "…",
      }).success,
    ).toBe(false);
  });

  it("requires the internal description — it IS the operational record", () => {
    const parsed = logExceptionSchema.safeParse({
      shipment_id: SHIPMENT,
      exception_type: "weather",
      severity: "high",
      public_description: "phrase:exception.weather",
      internal_description: "   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("permits an exception with NO public description — that is the honest state", () => {
    const parsed = logExceptionSchema.safeParse({
      shipment_id: SHIPMENT,
      exception_type: "damaged_freight",
      severity: "critical",
      public_description: "",
      internal_description: "Two pallets crushed; photos with the driver.",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.public_description).toBeNull();
  });

  it("REFUSES a resolution with no words, and says why", () => {
    const parsed = resolveExceptionSchema.safeParse({
      exception_id: EXCEPTION,
      resolution: "   ",
      public_message: "",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/what closed it/i);
    }
  });

  it("accepts a resolution with a customer line, and one without", () => {
    for (const public_message of ["", "phrase:resolution.moving_again"]) {
      expect(
        resolveExceptionSchema.safeParse({
          exception_id: EXCEPTION,
          resolution: "Dock cleared at 14:10; driver loaded.",
          public_message,
        }).success,
      ).toBe(true);
    }
  });

  it("refuses a resolution against a non-UUID exception id", () => {
    expect(
      resolveExceptionSchema.safeParse({
        exception_id: "../../etc/passwd",
        resolution: "…",
      }).success,
    ).toBe(false);
  });

  it("triage treats every blank field as 'leave it alone'", () => {
    const parsed = triageExceptionSchema.safeParse({
      exception_id: EXCEPTION,
      assigned_to: "",
      severity: "",
      public_description: "",
      mark_customer_notified: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.assigned_to).toBeNull();
      expect(parsed.data.severity).toBeNull();
      expect(parsed.data.public_description).toBeNull();
      // A blank checkbox means "no change", NEVER "un-notify" — 0025 refuses
      // un-notifying outright, and this layer never even asks it to.
      expect(parsed.data.mark_customer_notified).toBe(false);
    }
  });

  it("triage accepts the checkbox, which is the only one-way flag it can set", () => {
    const parsed = triageExceptionSchema.safeParse({
      exception_id: EXCEPTION,
      assigned_to: "",
      severity: "critical",
      public_description: "",
      mark_customer_notified: "true",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.mark_customer_notified).toBe(true);
    expect(parsed.success && parsed.data.severity).toBe("critical");
  });
});

/* ------------------------------------------------------------------ *
 * 4. The D-6 phrase library, EXTENDED rather than duplicated
 * ------------------------------------------------------------------ */

describe("D-6 phrase library — M-78's extension (§21, §24)", () => {
  const LOCALES = ["en", "es", "fr", "ht", "ru"] as const;

  function catalogue(locale: string): Record<string, unknown> {
    return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  }

  function lookup(source: Record<string, unknown>, key: string): unknown {
    return key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node === undefined || node === null
            ? undefined
            : (node as Record<string, unknown>)[part],
        source,
      );
  }

  it("adds a fourth GROUP rather than a parallel mechanism", () => {
    expect(PHRASE_GROUPS).toContain("resolution");
    // Same object, same token prefix, same resolver — which is what makes the
    // new group render on /track with no change to the page.
    expect(phraseToken("resolution.moving_again")).toBe(
      "phrase:resolution.moving_again",
    );
    expect(resolvePublicText("phrase:resolution.moving_again")).toEqual({
      kind: "phrase",
      id: "resolution.moving_again",
      key: "shipment.phrase.resolution.moving_again",
    });
  });

  it("grew the library beyond M-73's 29 curated phrases", () => {
    expect(PUBLIC_PHRASE_IDS.length).toBeGreaterThan(29);
    expect(phrasesInGroup("resolution").length).toBeGreaterThanOrEqual(8);
    expect(phrasesInGroup("delay").length).toBeGreaterThanOrEqual(11);
  });

  it("puts every id in exactly one group — an unreachable phrase is a bug", () => {
    for (const id of PUBLIC_PHRASE_IDS) {
      const groups = PHRASE_GROUPS.filter((g) => id.startsWith(`${g}.`));
      expect(groups, id).toHaveLength(1);
    }
  });

  it.each(LOCALES)("has every phrase translated in %s", (locale) => {
    const messages = catalogue(locale);
    for (const id of PUBLIC_PHRASE_IDS) {
      const value = lookup(messages, phraseKey(id));
      expect(typeof value, `${locale}: ${phraseKey(id)}`).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it("authors es and fr for the new phrases rather than mirroring English", () => {
    // ru/ht mirror English and are flagged in the runbook for native review —
    // the M-42/M-55/M-69/M-73/M-76 precedent, and the only alternative to the
    // machine translation §24 forbids.
    const en = catalogue("en");
    for (const locale of ["es", "fr"] as const) {
      const other = catalogue(locale);
      for (const id of phrasesInGroup("resolution")) {
        expect(lookup(other, phraseKey(id)), `${locale}: ${id}`).not.toBe(
          lookup(en, phraseKey(id)),
        );
      }
    }
  });

  it("keeps every resolution phrase calm — no blame, no legal conclusion (§21)", () => {
    const FORBIDDEN =
      /\b(fault|blame|liab|negligen|claim against|breach|refus(e|ed)|failed to|their fault|carrier failed)\b/i;
    for (const id of phrasesInGroup("resolution")) {
      expect(PUBLIC_PHRASES[id], id).not.toMatch(FORBIDDEN);
    }
  });

  it("still has NO `exception.other` phrase — the catch-all has nothing honest to say", () => {
    // M-73's deliberate omission, re-asserted so M-78's extension did not
    // quietly add the one entry that would have to say something untrue.
    expect(PUBLIC_PHRASE_IDS).not.toContain("exception.other");
  });

  it("NON-VACUITY: an unknown token still degrades to labelled free text", () => {
    expect(resolvePublicText("phrase:resolution.invented")).toEqual({
      kind: "free_text",
      text: "phrase:resolution.invented",
      noticeKey: "shipment.label.dispatch_written",
      lang: "en",
    });
  });
});
