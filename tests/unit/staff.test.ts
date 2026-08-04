import { describe, expect, it } from "vitest";
import {
  acceptInviteSchema,
  accountStatusSchema,
  assignDispatcherSchema,
  parsePage,
  staffInviteSchema,
} from "@/lib/validation/staff";

/** M-58 — admin account-management schemas. */

const UUID = "0b0e1100-0000-4000-8000-000000000000";

describe("accountStatusSchema", () => {
  it("requires a reason for suspensions but not approvals", () => {
    expect(() =>
      accountStatusSchema.parse({ profile_id: UUID, action: "suspend", reason: "" }),
    ).toThrow(/reason/i);
    const ok = accountStatusSchema.parse({
      profile_id: UUID,
      action: "approve",
      reason: "",
    });
    expect(ok.reason).toBeNull();
  });

  it("rejects unknown actions and malformed ids", () => {
    expect(() =>
      accountStatusSchema.parse({ profile_id: UUID, action: "delete" }),
    ).toThrow();
    expect(() =>
      accountStatusSchema.parse({ profile_id: "1 OR 1=1", action: "approve" }),
    ).toThrow();
  });
});

describe("staffInviteSchema (S-04)", () => {
  it("only invites the two staff roles — customer roles are rejected", () => {
    expect(
      staffInviteSchema.parse({ email: "d@pickloads.com", role: "dispatcher" })
        .role,
    ).toBe("dispatcher");
    expect(() =>
      staffInviteSchema.parse({ email: "x@x.com", role: "carrier" }),
    ).toThrow();
    expect(() =>
      staffInviteSchema.parse({ email: "x@x.com", role: "shipper" }),
    ).toThrow();
  });
});

describe("acceptInviteSchema", () => {
  it("accepts only a 64-hex token (the raw invite token shape)", () => {
    const token = "ab".repeat(32);
    const ok = acceptInviteSchema.parse({
      token,
      full_name: "Dana Dispatcher",
      password: "hunter22b",
    });
    expect(ok.token).toBe(token);
    expect(() =>
      acceptInviteSchema.parse({
        token: "not-a-token",
        full_name: "Dana",
        password: "hunter22b",
      }),
    ).toThrow(/invite link/i);
  });

  it("enforces the bcrypt password bounds", () => {
    expect(() =>
      acceptInviteSchema.parse({
        token: "ab".repeat(32),
        full_name: "Dana Dispatcher",
        password: "short",
      }),
    ).toThrow(/8 characters/);
  });
});

describe("assignDispatcherSchema", () => {
  it("treats an empty dispatcher as unassign", () => {
    const parsed = assignDispatcherSchema.parse({
      carrier_id: UUID,
      dispatcher_id: "",
    });
    expect(parsed.dispatcher_id).toBeNull();
  });
});

describe("parsePage", () => {
  it("clamps garbage to page 1", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("999999")).toBe(1);
    expect(parsePage("7")).toBe(7);
  });
});
