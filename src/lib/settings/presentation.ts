/**
 * M-102 — how `company_settings` reads to an administrator.
 *
 * The settings screen was a list of database keys (`location_retention_days`)
 * over textareas labelled "Value (JSON)". That is the shape of the table, not
 * the shape of the decision an admin is making.
 *
 * ── THE CONSTRAINT THAT SHAPES THIS FILE ─────────────────────────────────
 *
 * `updateCompanySetting` takes ONE form field, `value`, as a string, and
 * `JSON.parse`s it. Whatever control replaces the textarea must therefore
 * submit a string that parses to EXACTLY the value that would have been
 * stored before — `true`, not `"true"`; `90`, not `"90"`. The stored type is
 * part of the contract: `location_retention_days` is read as an integer and
 * `brokerage_active` as a boolean by code elsewhere.
 *
 * So this module describes each key and states how to encode it, and the row
 * component does the encoding. No key is renamed, no value is rewritten, and
 * anything this map does not describe falls back to the JSON editor rather
 * than being guessed at.
 */

export type SettingKind = "boolean" | "integer" | "choice" | "json";

export interface SettingSpec {
  /** What the admin is actually deciding. */
  label: string;
  /** One sentence, in the operator's terms. */
  description: string;
  kind: SettingKind;
  /** `integer` only — shown beside the field and in the summary. */
  unit?: string;
  min?: number;
  max?: number;
  /** `choice` only — value is stored as a JSON string. */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** Wording for the two boolean states, when On/Off is not the clearest. */
  onLabel?: string;
  offLabel?: string;
}

/**
 * The eleven keys `supabase/seed.sql` installs. A key absent from this map
 * still renders — as JSON, under its raw name — because the settings table is
 * data and can outgrow this file; falling back is correct, guessing is not.
 */
export const SETTING_SPEC: Readonly<Record<string, SettingSpec>> = {
  mc_number: {
    label: "MC number",
    description:
      "The FMCSA motor-carrier number shown in the footer, the compliance block and the FAQ.",
    kind: "json",
  },
  usdot_number: {
    label: "USDOT number",
    description: "The USDOT number shown in the footer and the compliance block.",
    kind: "json",
  },
  bond_status: {
    label: "Surety bond status",
    description: "How the BMC-84 bond is described on the public site.",
    kind: "json",
  },
  brokerage_active: {
    label: "Brokerage operations",
    description:
      "When off, shipper-facing brokerage messaging reads “Launching soon” instead of presenting the service as live.",
    kind: "boolean",
    onLabel: "Live",
    offLabel: "Launching soon",
  },
  testimonials_visible: {
    label: "Customer testimonials",
    description:
      "Shows the testimonials section on the public site. Kept off until enough verified reviews exist.",
    kind: "boolean",
    onLabel: "Visible",
    offLabel: "Hidden",
  },
  packet_downloads_live: {
    label: "Carrier packet downloads",
    description:
      "Enables the carrier packet download buttons. Off until the approved PDFs are uploaded.",
    kind: "boolean",
    onLabel: "Enabled",
    offLabel: "Disabled",
  },
  shipper_signup_enabled: {
    label: "Shipper self-signup",
    description:
      "Allows shippers to create an account from the public site. Can be switched off without a deployment.",
    kind: "boolean",
    onLabel: "Open",
    offLabel: "Closed",
  },
  referral_program_active: {
    label: "Referral program",
    description:
      "Controls whether the referral-bonus line appears across the site. Switch on the day the programme actually pays out.",
    kind: "boolean",
    onLabel: "Active",
    offLabel: "Inactive",
  },
  load_ticker_mode: {
    label: "Home load ticker",
    description:
      "Whether the load ticker on the home page shows sample data or live loads.",
    kind: "choice",
    options: [
      { value: "sample", label: "Sample data" },
      { value: "live", label: "Live loads" },
    ],
  },
  location_retention_days: {
    label: "Location history retention",
    description:
      "How long PickLoads keeps shipment location history. The nightly job deletes readings older than this.",
    kind: "integer",
    unit: "days",
    min: 1,
    max: 3650,
  },
  stats: {
    label: "Home page statistics",
    description:
      "The figures shown in the home page tiles. Empty values stay hidden rather than rendering a placeholder.",
    kind: "json",
  },
};

export function settingSpec(key: string): SettingSpec {
  return (
    SETTING_SPEC[key] ?? {
      label: humanizeSettingKey(key),
      description:
        "This setting has no description yet. Edit it as JSON, or add it to the settings presentation map.",
      kind: "json",
    }
  );
}

/** `load_ticker_mode` → `Load ticker mode`, for a key nobody has described. */
export function humanizeSettingKey(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * What the value reads as, at a glance, without opening the editor.
 *
 * Deliberately conservative: a shape this module does not recognise is
 * summarised as "Configured" rather than being flattened into prose that
 * might misdescribe it.
 */
export function settingSummary(key: string, value: unknown): string {
  const spec = settingSpec(key);
  if (spec.kind === "boolean" && typeof value === "boolean") {
    return value ? (spec.onLabel ?? "On") : (spec.offLabel ?? "Off");
  }
  if (spec.kind === "integer" && typeof value === "number") {
    return spec.unit ? `${value} ${spec.unit}` : String(value);
  }
  if (spec.kind === "choice" && typeof value === "string") {
    return spec.options?.find((o) => o.value === value)?.label ?? value;
  }
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "object") {
    const status = (value as Record<string, unknown>).status;
    if (typeof status === "string") {
      const s = status.replace(/_/g, " ");
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    return "Configured";
  }
  return String(value);
}

/**
 * Whether the value on record matches the control this map would render.
 *
 * A boolean key holding an object means the map and the data have diverged.
 * The row falls back to the JSON editor in that case, because rendering a
 * toggle over a value a toggle cannot express is how a save silently destroys
 * a setting.
 */
export function controlFits(key: string, value: unknown): boolean {
  switch (settingSpec(key).kind) {
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "choice":
      return typeof value === "string";
    case "json":
      return true;
  }
}
