import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SETTING_SPEC,
  controlFits,
  humanizeSettingKey,
  settingSpec,
  settingSummary,
} from "@/lib/settings/presentation";

/**
 * M-102 — the settings presentation layer.
 *
 * The assertion that matters is the round-trip one. `updateCompanySetting`
 * `JSON.parse`s a single form field, so if a control emits a different
 * encoding than the textarea did, saving a setting silently changes its TYPE
 * — `location_retention_days` becoming the string "90" would be read as an
 * invalid integer and fall back to the default, and `brokerage_active`
 * becoming "false" would be truthy at every call site that reads it.
 */

/** The values `supabase/seed.sql` actually installs. */
const SEEDED: ReadonlyArray<[string, unknown]> = [
  ["mc_number", { status: "pending", value: null }],
  ["usdot_number", { status: "pending", value: null }],
  ["bond_status", { status: "in_process", value: "BMC-84 $75K" }],
  ["brokerage_active", false],
  ["testimonials_visible", false],
  ["stats", { fee: "5% owner-operator", avg_rate: null }],
  ["packet_downloads_live", false],
  ["load_ticker_mode", "sample"],
  ["shipper_signup_enabled", true],
  ["referral_program_active", false],
  ["location_retention_days", 90],
];

describe("every seeded setting is described", () => {
  it("covers all eleven keys the seed installs", () => {
    for (const [key] of SEEDED) {
      expect(SETTING_SPEC[key], `${key} has no presentation spec`).toBeTruthy();
    }
  });

  it("describes each one in the operator's terms, not the table's", () => {
    for (const [key] of SEEDED) {
      const spec = settingSpec(key);
      expect(spec.label).not.toContain("_");
      expect(spec.label.toLowerCase()).not.toBe(key);
      expect(spec.description.length).toBeGreaterThan(20);
    }
  });

  it("falls back readably for a key nobody has described", () => {
    const spec = settingSpec("some_future_flag");
    expect(spec.kind).toBe("json");
    expect(spec.label).toBe("Some future flag");
    expect(humanizeSettingKey("load_ticker_mode")).toBe("Load ticker mode");
  });
});

describe("the control matches the stored shape", () => {
  it("picks the right control for every seeded value", () => {
    const expected: Readonly<Record<string, string>> = {
      mc_number: "json",
      usdot_number: "json",
      bond_status: "json",
      stats: "json",
      brokerage_active: "boolean",
      testimonials_visible: "boolean",
      packet_downloads_live: "boolean",
      shipper_signup_enabled: "boolean",
      referral_program_active: "boolean",
      load_ticker_mode: "choice",
      location_retention_days: "integer",
    };
    for (const [key, value] of SEEDED) {
      expect(settingSpec(key).kind, key).toBe(expected[key]);
      expect(controlFits(key, value), `${key} should fit its control`).toBe(true);
    }
  });

  it("refuses a control that cannot express what is stored", () => {
    // A boolean key holding an object: rendering a toggle over it and saving
    // would destroy the value. The row falls back to JSON instead.
    expect(controlFits("brokerage_active", { status: "on" })).toBe(false);
    expect(controlFits("location_retention_days", "90")).toBe(false);
    expect(controlFits("location_retention_days", 90.5)).toBe(false);
    expect(controlFits("load_ticker_mode", 3)).toBe(false);
    // JSON always fits — it is the fallback.
    expect(controlFits("stats", null)).toBe(true);
  });
});

describe("round-trip — the control writes back exactly what was stored", () => {
  /** What each control submits, mirroring `SettingRow`. */
  const encode = (key: string, value: unknown): string => {
    switch (settingSpec(key).kind) {
      case "boolean":
        return value === true ? "true" : "false";
      case "integer":
        return String(value);
      case "choice":
        return JSON.stringify(value);
      case "json":
        return JSON.stringify(value, null, value && typeof value === "object" ? 1 : 0);
    }
  };

  it("parses back to a value identical in both content and type", () => {
    for (const [key, value] of SEEDED) {
      const submitted = encode(key, value);
      const parsed: unknown = JSON.parse(submitted);
      expect(parsed, `${key} changed value`).toEqual(value);
      expect(typeof parsed, `${key} changed TYPE`).toBe(typeof value);
    }
  });

  it("a boolean never becomes the string 'false'", () => {
    const submitted = encode("brokerage_active", false);
    const parsed: unknown = JSON.parse(submitted);
    expect(parsed).toBe(false);
    expect(parsed).not.toBe("false");
  });

  it("an integer never becomes the string '90'", () => {
    const parsed: unknown = JSON.parse(encode("location_retention_days", 90));
    expect(parsed).toBe(90);
    expect(typeof parsed).toBe("number");
  });

  it("a choice keeps its JSON quoting", () => {
    expect(encode("load_ticker_mode", "sample")).toBe('"sample"');
    expect(JSON.parse(encode("load_ticker_mode", "live"))).toBe("live");
  });
});

describe("summaries", () => {
  it("reads a boolean in the setting's own words, not as true/false", () => {
    expect(settingSummary("brokerage_active", false)).toBe("Launching soon");
    expect(settingSummary("brokerage_active", true)).toBe("Live");
    expect(settingSummary("referral_program_active", false)).toBe("Inactive");
    expect(settingSummary("shipper_signup_enabled", true)).toBe("Open");
  });

  it("carries the unit for a quantity", () => {
    expect(settingSummary("location_retention_days", 90)).toBe("90 days");
  });

  it("names the chosen option", () => {
    expect(settingSummary("load_ticker_mode", "sample")).toBe("Sample data");
  });

  it("describes a structured value without misdescribing it", () => {
    expect(settingSummary("mc_number", { status: "pending", value: null })).toBe(
      "Pending",
    );
    expect(settingSummary("bond_status", { status: "in_process" })).toBe(
      "In process",
    );
    expect(settingSummary("stats", { fee: "5%" })).toBe("Configured");
    expect(settingSummary("stats", null)).toBe("Not set");
  });
});

describe("the save contract is unchanged", () => {
  it("the action still reads one `value` field and JSON.parses it", () => {
    // If this ever stops being true the encodings above become wrong, so the
    // test names the coupling instead of leaving it implicit.
    const src = readFileSync(
      join(process.cwd(), "src/app/actions/admin.ts"),
      "utf8",
    );
    expect(src).toContain('formData.get("value")');
    expect(src).toContain("JSON.parse(parsed.data.value)");
    expect(src).toContain('.from("company_settings")');
  });
});
