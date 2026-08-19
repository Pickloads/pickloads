// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { emitHarness, harnessWritten } from "../harness/emit";
import { SettingRow } from "@/components/portal/SettingRow";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("@/app/actions/admin", () => ({
  updateCompanySetting: async () => ({ status: "idle" }),
}));

/**
 * M-102 — the settings screen, as a fixture.
 *
 * `SettingRow` is a client component, so this is the real component with real
 * markup rather than a specimen. The four control kinds are all present:
 * boolean, integer, choice and the JSON fallback.
 */

const ROWS: ReadonlyArray<[string, unknown, string]> = [
  ["brokerage_active", false, 'Gates shipper brokerage messaging'],
  ["location_retention_days", 90, "M-80/§9: days of shipment location history to keep."],
  ["load_ticker_mode", "sample", "Home load board ticker: sample | live"],
  ["referral_program_active", false, "M-69/P-2: gates the CtaBand referral line"],
  ["mc_number", { status: "pending", value: null }, "FMCSA MC number — footer, compliance block"],
];

describe("M-102 · settings fixture", () => {
  it("renders a human control for each setting kind", () => {
    const { container } = render(
      <>
        {ROWS.map(([key, value, description]) => (
          <SettingRow
            key={key}
            settingKey={key}
            value={value}
            description={description}
            updatedAt="2026-08-18T08:00:00.000Z"
          />
        ))}
      </>,
    );
    // Boolean and choice render selects; the integer renders a number input;
    // the structured value falls back to the JSON editor.
    expect(container.querySelectorAll("select").length).toBe(3);
    expect(container.querySelectorAll('input[type="number"]').length).toBe(1);
    expect(container.querySelectorAll("textarea").length).toBe(1);
  });

  it("leads with the decision, not the database key", () => {
    const { container } = render(
      <SettingRow
        settingKey="location_retention_days"
        value={90}
        description="engineering note"
        updatedAt="2026-08-18T08:00:00.000Z"
      />,
    );
    const heading = container.querySelector(".a-card-head h2")!;
    expect(heading.textContent).toBe("Location history retention");
    // The raw key is still reachable, under Advanced.
    const advanced = container.querySelector("details.a-disclosure")!;
    expect(advanced.textContent).toContain("location_retention_days");
    expect(advanced.hasAttribute("open")).toBe(false);
  });

  it("the boolean control submits the JSON encoding, not a display word", () => {
    const { container } = render(
      <SettingRow
        settingKey="brokerage_active"
        value={false}
        description=""
        updatedAt="2026-08-18T08:00:00.000Z"
      />,
    );
    const select = container.querySelector("select")!;
    const values = [...select.querySelectorAll("option")].map((o) => o.value);
    // What is SUBMITTED parses back to a boolean…
    expect(values).toEqual(["true", "false"]);
    for (const v of values) expect(typeof JSON.parse(v)).toBe("boolean");
    // …while what is READ is the operator's wording.
    const labels = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(labels).toEqual(["Live", "Launching soon"]);
  });

  it("emits the fixture the screenshot harness photographs", () => {
    const { container } = render(
      <>
        {ROWS.map(([key, value, description]) => (
          <SettingRow
            key={key}
            settingKey={key}
            value={value}
            description={description}
            updatedAt="2026-08-18T08:00:00.000Z"
          />
        ))}
      </>,
    );
    const page = document.createElement("div");
    page.innerHTML = `<main id="main" class="a-page"><header class="a-head"><div class="a-head-main"><span class="a-crumb">Dispatch desk / Admin</span><h1>Company settings</h1><p class="a-desc">These settings drive the public site immediately — credential blocks, bond status and the feature gates for testimonials, packet downloads, the load ticker and brokerage. Never store secrets here: the table is publicly readable.</p></div><div class="a-head-side"><div class="a-badges"><span class="a-badge is-neutral">${ROWS.length} settings</span></div></div></header>${container.innerHTML}</main>`;
    emitHarness("admin-settings", "portal", page);
    expect(harnessWritten(["admin-settings"])).toBe(true);
  });
});
