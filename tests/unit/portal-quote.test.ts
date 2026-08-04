import { describe, expect, it } from "vitest";
import { portalQuoteSchema } from "@/lib/validation/portal-quote";

/** M-56 — the professional in-portal quote form schema (directive fields). */

const BASE = {
  pickup_city: "Irvington",
  pickup_state: "NJ",
  pickup_zip: "07111",
  delivery_city: "Dallas",
  delivery_state: "TX",
  delivery_zip: "75201",
  commodity: "Packaged food, palletized",
  equipment: "Dry Van",
  frequency: "Weekly",
  contact_name: "Jane Miller",
  phone: "(908) 404-5373",
};

describe("portalQuoteSchema", () => {
  it("accepts a complete professional request and normalizes numbers", () => {
    const parsed = portalQuoteSchema.parse({
      ...BASE,
      pickup_company: "Acme Warehouse",
      weight_lbs: "42,000",
      pallets: "26 pallets",
      dims_l_in: "636",
      temp_controlled: "on",
      temp_min_f: "34",
      temp_max_f: "38",
      hazmat: "",
      special_instructions: "Liftgate at delivery.",
    });
    expect(parsed.weight_lbs).toBe(42000);
    expect(parsed.dims_l_in).toBe(636);
    expect(parsed.temp_controlled).toBe(true);
    expect(parsed.hazmat).toBe(false);
    expect(parsed.temp_min_f).toBe(34);
  });

  it("requires city/state/zip on both ends", () => {
    expect(() =>
      portalQuoteSchema.parse({ ...BASE, delivery_zip: "abc" }),
    ).toThrow();
    expect(() =>
      portalQuoteSchema.parse({ ...BASE, pickup_city: "" }),
    ).toThrow();
  });

  it("rejects a delivery deadline before the pickup date", () => {
    expect(() =>
      portalQuoteSchema.parse({
        ...BASE,
        pickup_date: "2030-05-10",
        delivery_deadline: "2030-05-08",
      }),
    ).toThrow(/deadline/i);
  });

  it("rejects an inverted temperature range", () => {
    expect(() =>
      portalQuoteSchema.parse({
        ...BASE,
        temp_controlled: "on",
        temp_min_f: "40",
        temp_max_f: "20",
      }),
    ).toThrow(/temperature/i);
  });

  it("rejects past pickup dates and unknown equipment", () => {
    expect(() =>
      portalQuoteSchema.parse({ ...BASE, pickup_date: "2020-01-01" }),
    ).toThrow(/past/i);
    expect(() =>
      portalQuoteSchema.parse({ ...BASE, equipment: "Spaceship" }),
    ).toThrow();
  });

  it("strips oversized weights and bounds dims", () => {
    expect(() =>
      portalQuoteSchema.parse({ ...BASE, weight_lbs: "90,000" }),
    ).toThrow(/80,000/);
    expect(() =>
      portalQuoteSchema.parse({ ...BASE, dims_w_in: "500" }),
    ).toThrow(/width/i);
  });
});
