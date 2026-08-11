import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCreatePayload,
  dateToAppointment,
  FORBIDDEN_CREATE_KEYS,
  isTrackingNumberCollision,
  mapQuoteToShipmentDraft,
  parsePallets,
  QUOTE_CONVERSION_COLUMNS,
  TRACKING_NUMBER_ATTEMPTS,
  type ConvertibleQuote,
  type ShipmentDraft,
} from "@/lib/shipments/create";
import { TRACKING_NUMBER_REGEX } from "@/lib/shipments/tracking-number";

/**
 * M-75 — quote→shipment mapping, the §2 brokerage gate, and §5's 23505 retry.
 *
 * The mapping and the payload builder are PURE, so they are tested directly
 * and field by field. The gate and the retry loop need a client and a
 * switchboard, so `@/lib/company-settings` and `@/lib/supabase/admin` are
 * mocked — what is proved there is the LAYER: that the gate runs before any
 * tracking number is minted, that a refusal writes nothing, and that only a
 * tracking-number 23505 causes a re-roll.
 */

/* ------------------------------------------------------------------ *
 * Mocks — declared before the import under test (vitest hoists vi.mock)
 * ------------------------------------------------------------------ */

const brokerageActive = vi.fn<() => Promise<boolean>>();
const rpc = vi.fn();
const auditRows: unknown[] = [];
let adminAvailable = true;

vi.mock("@/lib/company-settings", () => ({
  getBooleanSetting: (_key: string, fallback = false) =>
    brokerageActive().catch(() => fallback),
}));

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => (adminAvailable ? { rpc } : null),
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (input: unknown) => {
    auditRows.push(input);
    return Promise.resolve();
  },
}));

const { assertBrokerageOpen, BROKERAGE_CLOSED_MESSAGE, createShipment } =
  await import("@/lib/shipments/create");

const DRAFT: ShipmentDraft = {
  shipper_id: "s-1",
  origin_city: "Newark",
  origin_state: "NJ",
  destination_city: "Atlanta",
  destination_state: "GA",
  equipment: "Dry Van",
};

beforeEach(() => {
  brokerageActive.mockReset();
  rpc.mockReset();
  auditRows.length = 0;
  adminAvailable = true;
  brokerageActive.mockResolvedValue(true);
  rpc.mockResolvedValue({
    data: {
      shipment_id: "sh-1",
      tracking_number: "PL-2026-000458",
      status: "carrier_search",
      event_id: "ev-1",
    },
    error: null,
  });
});

afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------ *
 * §2 gate
 * ------------------------------------------------------------------ */

describe("§2 brokerage gate — the SERVICE-LAYER half M-71 assigned to M-75", () => {
  it("is open when the switchboard says true", async () => {
    brokerageActive.mockResolvedValue(true);
    expect(await assertBrokerageOpen()).toEqual({ open: true });
  });

  it("is closed when the switchboard says false, with a staff-readable reason", async () => {
    brokerageActive.mockResolvedValue(false);
    const gate = await assertBrokerageOpen();
    expect(gate.open).toBe(false);
    expect(gate.message).toBe(BROKERAGE_CLOSED_MESSAGE);
  });

  it("names the business fact, the switch and what still works", () => {
    // §30 applies to internal surfaces: "creation failed" teaches nobody
    // anything. This asserts the message stays the one an operator can act on.
    expect(BROKERAGE_CLOSED_MESSAGE).toContain("licensed freight broker");
    expect(BROKERAGE_CLOSED_MESSAGE).toContain("brokerage_active");
    expect(BROKERAGE_CLOSED_MESSAGE).toContain("Dispatch loads are unaffected");
  });

  it("FAILS CLOSED when the switchboard cannot be read", async () => {
    brokerageActive.mockRejectedValue(new Error("supabase down"));
    expect((await assertBrokerageOpen()).open).toBe(false);
  });

  it("REFUSES CREATION and writes nothing at all while closed", async () => {
    brokerageActive.mockResolvedValue(false);
    const result = await createShipment({
      draft: DRAFT,
      actorId: "u-1",
      actorRole: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("brokerage_closed");
    expect(result.message).toBe(BROKERAGE_CLOSED_MESSAGE);
    // The whole point: no round trip, no tracking number, no audit row.
    expect(rpc).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(0);
  });

  it("CREATES when open — the non-vacuity control for the refusal above", async () => {
    const result = await createShipment({
      draft: DRAFT,
      actorId: "u-1",
      actorRole: "dispatcher",
    });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(auditRows).toHaveLength(1);
  });

  it("maps a P0001 from the 0017 trigger back to the same staff message", async () => {
    // The switchboard flipped between the gate and the write. The operator is
    // not told what a P0001 is.
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "brokerage inactive" } });
    const result = await createShipment({
      draft: DRAFT,
      actorId: "u-1",
      actorRole: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("brokerage_closed");
    expect(result.message).toBe(BROKERAGE_CLOSED_MESSAGE);
  });

  it("returns `not_configured` rather than pretending, with no service key", async () => {
    adminAvailable = false;
    const result = await createShipment({
      draft: DRAFT,
      actorId: "u-1",
      actorRole: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("not_configured");
  });
});

/* ------------------------------------------------------------------ *
 * §5 tracking number
 * ------------------------------------------------------------------ */

describe("§5 tracking number — server-side, with the caller's 23505 retry", () => {
  it("mints a well-formed number and passes it in the payload", async () => {
    await createShipment({ draft: DRAFT, actorId: "u-1", actorRole: "dispatcher" });
    const payload = rpc.mock.calls[0]![1].p_payload as Record<string, unknown>;
    expect(TRACKING_NUMBER_REGEX.test(String(payload.tracking_number))).toBe(true);
  });

  it("recognises the tracking-number unique violation and nothing else", () => {
    expect(
      isTrackingNumberCollision({
        code: "23505",
        message: 'duplicate key value violates unique constraint "shipments_tracking_number_key"',
      }),
    ).toBe(true);
    // A different unique index is a REAL error — re-rolling a random number
    // would hide it behind a second failure milliseconds later.
    expect(
      isTrackingNumberCollision({
        code: "23505",
        message: 'duplicate key value violates unique constraint "shipment_assignments_one_active"',
      }),
    ).toBe(false);
    expect(isTrackingNumberCollision({ code: "23503", message: "fk" })).toBe(false);
  });

  it("re-rolls on a collision and succeeds on the next attempt", async () => {
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "shipments_tracking_number_key"',
        },
      })
      .mockResolvedValueOnce({
        data: {
          shipment_id: "sh-1",
          tracking_number: "PL-2026-000459",
          status: "carrier_search",
          event_id: "ev-1",
        },
        error: null,
      });
    const result = await createShipment({
      draft: DRAFT,
      actorId: "u-1",
      actorRole: "dispatcher",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.attempts).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(2);
    // Two DIFFERENT candidates — a retry with the same number is not a retry.
    const first = (rpc.mock.calls[0]![1].p_payload as Record<string, unknown>).tracking_number;
    const second = (rpc.mock.calls[1]![1].p_payload as Record<string, unknown>).tracking_number;
    expect(first).not.toBe(second);
  });

  it("gives up after TRACKING_NUMBER_ATTEMPTS rather than looping forever", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "shipments_tracking_number_key"',
      },
    });
    const result = await createShipment({
      draft: DRAFT,
      actorId: "u-1",
      actorRole: "dispatcher",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("tracking_number_exhausted");
    expect(rpc).toHaveBeenCalledTimes(TRACKING_NUMBER_ATTEMPTS);
  });

  it("does NOT retry a non-collision error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23503", message: "fk violation" } });
    const result = await createShipment({
      draft: DRAFT,
      actorId: "u-1",
      actorRole: "dispatcher",
    });
    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * The payload allow-list
 * ------------------------------------------------------------------ */

describe("buildCreatePayload — the allow-list mirrored from migration 0022", () => {
  it("strips the five forbidden keys even when a caller sends them", () => {
    const payload = buildCreatePayload(
      {
        ...DRAFT,
        id: "chosen-by-caller",
        created_at: "1999-01-01T00:00:00Z",
        updated_at: "1999-01-01T00:00:00Z",
        completed_at: "1999-01-01T00:00:00Z",
        cancelled_at: "1999-01-01T00:00:00Z",
      } as ShipmentDraft & Record<string, unknown>,
      "PL-2026-000458",
    );
    for (const key of FORBIDDEN_CREATE_KEYS) {
      expect(payload, `${key} survived`).not.toHaveProperty(key);
    }
    expect(payload.tracking_number).toBe("PL-2026-000458");
    expect(payload.shipper_id).toBe("s-1");
  });

  it("drops `undefined` so an absent key takes the column default", () => {
    // An explicit null OVERRIDES a DDL default; an absent key takes it. Letting
    // `undefined` decide by accident is how public_tracking_enabled ends up null.
    // `exactOptionalPropertyTypes` forbids an explicit `undefined` on an
    // optional field, which is the right rule — the cast is how a test reaches
    // the runtime case a JS caller (or a spread of a partial form object) can
    // still produce.
    const payload = buildCreatePayload(
      { ...DRAFT, carrier_id: undefined, po_number: null } as unknown as ShipmentDraft,
      "PL-2026-000458",
    );
    expect(payload).not.toHaveProperty("carrier_id");
    expect(payload).toHaveProperty("po_number", null);
  });
});

/* ------------------------------------------------------------------ *
 * §14 quote → shipment mapping
 * ------------------------------------------------------------------ */

const QUOTE: ConvertibleQuote = {
  id: "q-1",
  shipper_id: "s-77",
  status: "agreement",
  quoted_rate: 2450,
  equipment: " Reefer ",
  commodity: "Produce",
  weight_lbs: 42000,
  pallets: "24",
  pickup_date: "2026-09-01",
  delivery_deadline: "2026-09-03",
  pickup_company: "Cold Store",
  pickup_address: "1 Dock Rd",
  pickup_city: " Newark ",
  pickup_state: "nj",
  pickup_zip: "07105",
  delivery_company: "Big Box DC",
  delivery_address: "9 Warehouse Way",
  delivery_city: "Atlanta",
  delivery_state: "ga",
  delivery_zip: "30336",
  special_instructions: "Call before arrival",
};

describe("mapQuoteToShipmentDraft — §14 conversion, field by field", () => {
  it("carries the quote's shipper_id onto the shipment unchanged", () => {
    const mapped = mapQuoteToShipmentDraft(QUOTE);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error("unreachable");
    expect(mapped.draft.shipper_id).toBe("s-77");
  });

  it("REFUSES a quote with no shipper account rather than guessing one", () => {
    const mapped = mapQuoteToShipmentDraft({ ...QUOTE, shipper_id: null });
    expect(mapped.ok).toBe(false);
    if (mapped.ok) throw new Error("unreachable");
    expect(mapped.reason).toContain("no shipper account");
  });

  it("refuses a quote missing a schema-required field, naming what is missing", () => {
    const mapped = mapQuoteToShipmentDraft({ ...QUOTE, delivery_city: null });
    expect(mapped.ok).toBe(false);
    if (mapped.ok) throw new Error("unreachable");
    expect(mapped.reason).toContain("delivery city");
    // …and never invents a placeholder.
    expect(mapped.reason).not.toContain("Unknown");
  });

  it("maps the lane, trimming and upper-casing the states", () => {
    const mapped = mapQuoteToShipmentDraft(QUOTE);
    if (!mapped.ok) throw new Error("unreachable");
    expect(mapped.draft.origin_city).toBe("Newark");
    expect(mapped.draft.origin_state).toBe("NJ");
    expect(mapped.draft.destination_state).toBe("GA");
    expect(mapped.draft.equipment).toBe("Reefer");
  });

  it("maps quoted_rate to the STAFF-ONLY gross, and derives no margin", () => {
    const mapped = mapQuoteToShipmentDraft(QUOTE);
    if (!mapped.ok) throw new Error("unreachable");
    expect(mapped.draft.gross_shipper_amount).toBe(2450);
    // Nobody has bought a truck yet — a margin here would be a fake metric.
    expect(mapped.draft.carrier_pay).toBeUndefined();
    expect(mapped.draft).not.toHaveProperty("margin");
  });

  it("starts the shipment at `quote_accepted` and links the quote", () => {
    const mapped = mapQuoteToShipmentDraft(QUOTE);
    if (!mapped.ok) throw new Error("unreachable");
    expect(mapped.draft.status).toBe("quote_accepted");
    expect(mapped.draft.quote_id).toBe("q-1");
  });

  it("promotes the quote's DATE to an unambiguous appointment instant", () => {
    expect(dateToAppointment("2026-09-01")).toBe("2026-09-01T12:00:00.000Z");
    // Midnight is the one hour of the day where the calendar date flips by zone.
    expect(dateToAppointment("2026-09-01")).not.toContain("T00:00");
    expect(dateToAppointment(null)).toBeNull();
    expect(dateToAppointment("not a date")).toBeNull();
    expect(dateToAppointment("09/01/2026")).toBeNull();
  });

  it("warns that the pickup date is a date, not a confirmed appointment", () => {
    const mapped = mapQuoteToShipmentDraft(QUOTE);
    if (!mapped.ok) throw new Error("unreachable");
    expect(mapped.warnings.join(" ")).toContain("real appointment time");
  });

  it("parses the TEXT pallets column honestly, and warns when it cannot", () => {
    expect(parsePallets("24")).toBe(24);
    expect(parsePallets("24-26")).toBe(24);
    expect(parsePallets("about a dozen")).toBeNull();
    expect(parsePallets(null)).toBeNull();
    const mapped = mapQuoteToShipmentDraft({ ...QUOTE, pallets: "a few" });
    if (!mapped.ok) throw new Error("unreachable");
    expect(mapped.draft.pallets).toBeNull();
    expect(mapped.warnings.join(" ")).toContain("not a number");
  });

  it("warns rather than fails when the quote carries no rate", () => {
    const mapped = mapQuoteToShipmentDraft({ ...QUOTE, quoted_rate: null });
    if (!mapped.ok) throw new Error("unreachable");
    expect(mapped.draft.gross_shipper_amount).toBeNull();
    expect(mapped.warnings.join(" ")).toContain("no rate");
  });

  it("reads only the columns the projection names", () => {
    const mapped = mapQuoteToShipmentDraft(QUOTE);
    if (!mapped.ok) throw new Error("unreachable");
    for (const key of ["pickup_city", "delivery_state", "quoted_rate", "shipper_id"]) {
      expect(QUOTE_CONVERSION_COLUMNS).toContain(key);
    }
    // The conversion never reads the quoter's email or phone into a shipment.
    expect(QUOTE_CONVERSION_COLUMNS).not.toContain("email");
    expect(QUOTE_CONVERSION_COLUMNS).not.toContain("phone");
  });

  it("is pure — the same quote maps identically twice", () => {
    expect(mapQuoteToShipmentDraft(QUOTE)).toEqual(mapQuoteToShipmentDraft(QUOTE));
  });
});
