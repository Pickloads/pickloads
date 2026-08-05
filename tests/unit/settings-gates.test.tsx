// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseBooleanSetting } from "@/lib/company-settings";

/**
 * M-69 / P-2, P-3, P-6 — the switchboard gates.
 *
 * Two halves:
 *   1. parseBooleanSetting — the fail-closed semantics every gate depends on.
 *   2. Rendering — the promise-bearing strings are actually ABSENT from the
 *      DOM when the flag is off, and the approved copy is still in the
 *      codebase (present when it is on). Deleting the copy was not an
 *      option; proving it does not render was the requirement.
 *
 * next-intl's useTranslations is stubbed to the identity-with-fallback the
 * real useV4() implements (t.has() false ⇒ English literal), so these
 * assertions are about the GATE, not the dictionary.
 */
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = () => "";
    t.has = () => false;
    return t;
  },
  useLocale: () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const { CtaBand } = await import("@/components/sections/CtaBand");
const { Footer } = await import("@/components/layout/Footer");
const { Testimonials } = await import("@/components/sections/Testimonials");

const REFERRAL_COPY = "Refer a carrier who signs up";

describe("parseBooleanSetting (fail-closed switchboard semantics)", () => {
  it("reads the JSON booleans the seed writes", () => {
    expect(parseBooleanSetting(true)).toBe(true);
    expect(parseBooleanSetting(false)).toBe(false);
  });

  it("reads the string forms the M-24 settings editor stores", () => {
    expect(parseBooleanSetting("true")).toBe(true);
    expect(parseBooleanSetting(" TRUE ")).toBe(true);
    expect(parseBooleanSetting('"true"')).toBe(true);
    expect(parseBooleanSetting("false")).toBe(false);
  });

  it("falls back — never opens the gate — on anything unreadable", () => {
    // Missing key, outage, secretless preview, junk value: all closed.
    expect(parseBooleanSetting(null)).toBe(false);
    expect(parseBooleanSetting(undefined)).toBe(false);
    expect(parseBooleanSetting("yes")).toBe(false);
    expect(parseBooleanSetting(1)).toBe(false);
    expect(parseBooleanSetting({ value: true })).toBe(false);
  });
});

describe("P-2 — referral promise gate", () => {
  it("does NOT render the referral bonus line when the flag is off", () => {
    const { container } = render(<CtaBand referralActive={false} />);
    expect(container.textContent).not.toContain(REFERRAL_COPY);
    expect(container.querySelector(".mono-note")).toBeNull();
    // The rest of the band is untouched.
    expect(container.textContent).toContain("Ready to stop hunting loads?");
  });

  it("defaults to off when no flag is passed", () => {
    const { container } = render(<CtaBand />);
    expect(container.textContent).not.toContain(REFERRAL_COPY);
  });

  it("still carries the approved copy — it renders when the flag is on", () => {
    // Proves the string was GATED, not deleted: it must come back with one
    // setting flip, in the codebase and the catalogues, unchanged.
    const { container } = render(<CtaBand referralActive={true} />);
    expect(container.textContent).toContain(REFERRAL_COPY);
    expect(container.querySelector(".mono-note")).not.toBeNull();
  });
});

describe("P-3 — brokerage label gate", () => {
  it('labels /shippers "For Shippers" while brokerage is inactive', () => {
    render(<Footer brokerageActive={false} />);
    expect(screen.queryByText("Freight Brokerage")).toBeNull();
    // The link itself is never removed — only the claim it makes.
    expect(
      document.querySelectorAll('a[href="/shippers"]').length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("For Shippers").length).toBeGreaterThan(0);
  });

  it('restores "Freight Brokerage" when brokerage_active flips true', () => {
    render(<Footer brokerageActive={true} />);
    expect(screen.getByText("Freight Brokerage")).toBeTruthy();
  });
});

describe("P-6 — testimonials gate", () => {
  it("renders nothing at all with no approved reviews", () => {
    // The flag being on is not enough: an empty list must never produce an
    // empty band, and must never fall back to the prototype's sample quotes.
    const { container } = render(<Testimonials items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the V4 markup for real approved reviews", () => {
    const { container } = render(
      <Testimonials
        items={[
          {
            id: "t1",
            quote: "They fought a detention claim for me and got it paid.",
            author: "M. Rodriguez",
            context: "2-Truck Fleet · Reefer · FL",
          },
        ]}
      />,
    );
    expect(container.querySelectorAll(".testis .testi")).toHaveLength(1);
    expect(container.textContent).toContain("M. Rodriguez");
  });
});
