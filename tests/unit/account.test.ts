import { describe, expect, it } from "vitest";
import {
  AUTHORITY_STATUSES,
  createCarrierAccountSchema,
  createShipperAccountSchema,
} from "@/lib/validation/account";

/**
 * M-52/M-53/M-54 — /create-account schema behavior, including the audit
 * §6.5 guarantee that a forged `role` in the POST body can never survive
 * validation (roles are assigned server-side only; the DB trigger
 * `trg_profiles_role_guard` is additionally verified against PostgreSQL 16
 * in the M-50 migration checks).
 */

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
  regions: "Northeast, Midwest",
  password: "hunter22b",
  locale: "en",
};

describe("createCarrierAccountSchema", () => {
  it("accepts a valid active-authority carrier", () => {
    const parsed = createCarrierAccountSchema.safeParse(validCarrier);
    expect(parsed.success).toBe(true);
  });

  it("requires an MC number only when authority is active", () => {
    const noMc = { ...validCarrier, mc_number: "" };
    expect(createCarrierAccountSchema.safeParse(noMc).success).toBe(false);
    for (const status of ["pending", "none", "leased_on"]) {
      const parsed = createCarrierAccountSchema.safeParse({
        ...noMc,
        authority_status: status,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.mc_number).toBeNull();
    }
  });

  it("rejects unknown authority statuses and lists exactly the directive four", () => {
    expect(AUTHORITY_STATUSES).toEqual([
      "active",
      "pending",
      "none",
      "leased_on",
    ]);
    const parsed = createCarrierAccountSchema.safeParse({
      ...validCarrier,
      authority_status: "admin",
    });
    expect(parsed.success).toBe(false);
  });

  it("strips a forged role key — roles are never client-assignable", () => {
    const parsed = createCarrierAccountSchema.safeParse({
      ...validCarrier,
      role: "admin",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("role" in parsed.data).toBe(false);
    }
  });

  it("enforces the 8–72 password bounds (bcrypt limit)", () => {
    expect(
      createCarrierAccountSchema.safeParse({ ...validCarrier, password: "short7c" })
        .success,
    ).toBe(false);
    expect(
      createCarrierAccountSchema.safeParse({
        ...validCarrier,
        password: "x".repeat(73),
      }).success,
    ).toBe(false);
  });
});

describe("createShipperAccountSchema", () => {
  it("accepts a valid shipper and splits regions into a list", () => {
    const parsed = createShipperAccountSchema.safeParse(validShipper);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.regions).toEqual(["Northeast", "Midwest"]);
      expect(parsed.data.shipping_frequency).toBe("weekly");
    }
  });

  it("nulls out an unknown shipping frequency instead of failing", () => {
    const parsed = createShipperAccountSchema.safeParse({
      ...validShipper,
      shipping_frequency: "hourly",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.shipping_frequency).toBeNull();
  });

  it("handles empty regions and caps the list at 12 entries", () => {
    const empty = createShipperAccountSchema.safeParse({
      ...validShipper,
      regions: "",
    });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.regions).toEqual([]);

    const many = createShipperAccountSchema.safeParse({
      ...validShipper,
      regions: Array.from({ length: 20 }, (_, i) => `R${i}`).join(","),
    });
    expect(many.success).toBe(true);
    if (many.success) expect(many.data.regions).toHaveLength(12);
  });

  it("strips a forged role key — roles are never client-assignable", () => {
    const parsed = createShipperAccountSchema.safeParse({
      ...validShipper,
      role: "dispatcher",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("role" in parsed.data).toBe(false);
    }
  });
});
