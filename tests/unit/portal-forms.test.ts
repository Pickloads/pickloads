import { describe, expect, it } from "vitest";
import {
  driverSchema,
  FLEET_EQUIPMENT,
  truckSchema,
} from "@/lib/validation/fleet";
import {
  accountPreferencesSchema,
  changeRequestSchema,
  supportReplySchema,
  supportThreadSchema,
} from "@/lib/validation/portal";

/**
 * M-55 — carrier-portal form schemas: fleet CRUD, regulated change requests,
 * support threads (5000-char cap mirrors the DB check) and account settings.
 */

describe("truckSchema", () => {
  it("accepts a minimal truck (equipment only) and defaults active", () => {
    const parsed = truckSchema.parse({ equipment: "Dry Van" });
    expect(parsed.id).toBeNull();
    expect(parsed.equipment).toBe("Dry Van");
    expect(parsed.active).toBe(true);
    expect(parsed.year).toBeNull();
  });

  it("keeps the equipment list in lock-step with the 8 public slugs", () => {
    expect(FLEET_EQUIPMENT).toHaveLength(8);
    expect(() => truckSchema.parse({ equipment: "Spaceship" })).toThrow();
  });

  it("rejects out-of-range years but nulls non-numeric input", () => {
    expect(() =>
      truckSchema.parse({ equipment: "Reefer", year: "1950" }),
    ).toThrow();
    const parsed = truckSchema.parse({ equipment: "Reefer", year: "soon" });
    expect(parsed.year).toBeNull();
  });

  it('parses "false" as inactive and empty id as INSERT marker', () => {
    const parsed = truckSchema.parse({
      id: "",
      equipment: "Flatbed",
      active: "false",
    });
    expect(parsed.active).toBe(false);
    expect(parsed.id).toBeNull();
  });
});

describe("driverSchema", () => {
  it("requires a real name and validates optional dates", () => {
    expect(() => driverSchema.parse({ full_name: "x" })).toThrow();
    const parsed = driverSchema.parse({
      full_name: "Marcus Rivera",
      cdl_expiry: "2027-04-30",
      medical_card_expiry: "",
    });
    expect(parsed.cdl_expiry).toBe("2027-04-30");
    expect(parsed.medical_card_expiry).toBeNull();
  });

  it("rejects a malformed email but accepts empty", () => {
    expect(() =>
      driverSchema.parse({ full_name: "Marcus Rivera", email: "nope" }),
    ).toThrow();
    const parsed = driverSchema.parse({ full_name: "Marcus Rivera", email: "" });
    expect(parsed.email).toBeNull();
  });
});

describe("changeRequestSchema (decision D5)", () => {
  it("accepts only the regulated field set", () => {
    const parsed = changeRequestSchema.parse({
      field: "insurance",
      message: "New COI attached — renewal effective 09/01.",
    });
    expect(parsed.field).toBe("insurance");
    expect(() =>
      changeRequestSchema.parse({ field: "dispatch_fee_pct", message: "5% please" }),
    ).toThrow();
  });

  it("requires a substantive message", () => {
    expect(() =>
      changeRequestSchema.parse({ field: "mc_number", message: "fix" }),
    ).toThrow();
  });
});

describe("support schemas (audit §6.8)", () => {
  it("caps the body at 5000 chars, matching the DB check", () => {
    expect(() =>
      supportThreadSchema.parse({ subject: "Hi", body: "a".repeat(5001) }),
    ).toThrow();
    expect(() =>
      supportReplySchema.parse({
        thread_id: "0b0e1100-0000-4000-8000-000000000000",
        body: "a".repeat(5001),
      }),
    ).toThrow();
  });

  it("requires a uuid thread id on replies", () => {
    expect(() =>
      supportReplySchema.parse({ thread_id: "1 OR 1=1", body: "hello" }),
    ).toThrow();
  });
});

describe("accountPreferencesSchema", () => {
  it("parses checkbox on/absent into booleans and validates the locale", () => {
    const parsed = accountPreferencesSchema.parse({
      preferred_language: "es",
      email_load_updates: "on",
    });
    expect(parsed.email_load_updates).toBe(true);
    expect(parsed.email_marketing).toBe(false);
    expect(() =>
      accountPreferencesSchema.parse({ preferred_language: "de" }),
    ).toThrow();
  });
});
