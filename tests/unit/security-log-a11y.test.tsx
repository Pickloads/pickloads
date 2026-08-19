// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { emitHarness, harnessWritten } from "../harness/emit";
import { SecurityLogView } from "@/components/portal/SecurityLogView";
import type { AuditActor, AuditEventRow } from "@/lib/audit/format";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

/**
 * M-101 — the security log surface.
 *
 * The assertions that matter most are negative: no raw JSON in the default
 * view, and no sensitive value anywhere in the rendered DOM — including inside
 * the collapsed disclosure, because `<details>` hides content from sight, not
 * from the document.
 */

afterEach(cleanup);

const ACTORS: AuditActor[] = [
  { id: "3fe16fa9-aaaa", full_name: "Dana Whitfield", role: "admin" },
];

const EVENTS: AuditEventRow[] = [
  {
    id: "1",
    actor_id: "3fe16fa9-aaaa",
    action: "staff.mfa_enrolled",
    target_table: "profiles",
    target_id: "3fe16fa9-aaaa-bbbb-cccc-dddddddddddd",
    detail: { role: "admin" },
    ip: "::1",
    created_at: "2026-08-19T06:57:00.000Z",
  },
  {
    id: "2",
    actor_id: null,
    action: "fmcsa_check_started",
    target_table: "carrier_pre_registrations",
    target_id: "413f0022-aaaa-bbbb-cccc-dddddddddddd",
    detail: { provider: "fmcsa_qcmobile", configured: false },
    ip: null,
    created_at: "2026-08-19T06:41:00.000Z",
  },
  {
    id: "3",
    actor_id: "3fe16fa9-aaaa",
    action: "pre_registration_staff_review",
    target_table: "carrier_pre_registrations",
    target_id: "413f0022-aaaa-bbbb-cccc-dddddddddddd",
    detail: { outcome: "clear", decision: "eligible_to_continue", note_length: 302 },
    ip: "203.0.113.7",
    created_at: "2026-08-19T06:30:00.000Z",
  },
  {
    id: "4",
    actor_id: null,
    action: "account.signup",
    target_table: "profiles",
    target_id: "aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee",
    detail: {
      kind: "shipper",
      industry: "Food & Beverage",
      shipping_frequency: "monthly",
    },
    ip: "198.51.100.24",
    created_at: "2026-08-18T18:04:00.000Z",
  },
  {
    id: "5",
    actor_id: null,
    action: "manual_review_required",
    target_table: "carrier_pre_registrations",
    target_id: "413f0022-aaaa-bbbb-cccc-dddddddddddd",
    detail: { risk_tier: "manual_review" },
    ip: "198.51.100.24",
    created_at: "2026-08-18T18:03:00.000Z",
  },
  {
    id: "6",
    actor_id: null,
    action: "document.download",
    target_table: "documents",
    target_id: "035983ba-aaaa-bbbb-cccc-dddddddddddd",
    detail: { carrier_id: "c-1", ttl_seconds: 300 },
    ip: "198.51.100.24",
    created_at: "2026-08-18T17:55:00.000Z",
  },
  {
    // A hostile payload: a future call site that journals something it should
    // not. The renderer, not the writer, has to be the thing that stops it.
    id: "7",
    actor_id: null,
    action: "some_future.event",
    target_table: null,
    target_id: null,
    detail: {
      totp_secret: "JBSWY3DPEHPK3PXP",
      access_token: "eyJhbGciOiJIUzI1NiJ9.LEAKED.value",
      role: "admin",
    },
    ip: "198.51.100.24",
    created_at: "2026-08-18T17:00:00.000Z",
  },
];

const renderLog = (over: Partial<React.ComponentProps<typeof SecurityLogView>> = {}) =>
  render(
    <SecurityLogView
      events={EVENTS}
      actors={ACTORS}
      total={EVENTS.length}
      page={1}
      totalPages={2}
      filter=""
      resolved={[]}
      pageHref={(p) => `/portal/admin/security?page=${p}`}
      {...over}
    />,
  );

describe("the log reads as operations, not as a database", () => {
  it("shows a sentence, not a constant, for each event", () => {
    renderLog();
    expect(screen.getByText("Two-factor authentication enabled")).toBeTruthy();
    expect(screen.getByText("FMCSA verification started")).toBeTruthy();
    expect(screen.getByText("Carrier cleared to continue")).toBeTruthy();
    expect(screen.getByText("New shipper account created")).toBeTruthy();
    expect(screen.getByText("Manual carrier review required")).toBeTruthy();
    expect(screen.getByText("Secure document link generated")).toBeTruthy();
  });

  it("shows no raw JSON by default", () => {
    const { container } = renderLog();
    // The disclosure bodies exist in the DOM but must not be open.
    for (const d of container.querySelectorAll("details")) {
      expect(d.hasAttribute("open"), "a disclosure is open by default").toBe(false);
    }
    // No cell renders a stringified object.
    for (const td of container.querySelectorAll("td")) {
      const text = td.textContent ?? "";
      expect(text).not.toMatch(/\{"[a-z_]+":/);
    }
  });

  it("keeps the raw constant reachable for technical inspection", () => {
    const { container } = renderLog();
    expect(container.textContent).toContain("staff.mfa_enrolled");
  });

  it("does not paint every action amber", () => {
    const { container } = renderLog();
    const tones = [...container.querySelectorAll("td .a-badge")].map(
      (b) => b.className,
    );
    expect(tones.length).toBeGreaterThan(4);
    expect(new Set(tones).size).toBeGreaterThan(1);
  });

  it("gives the target a type and the id a secondary place", () => {
    const { container } = renderLog();
    expect(container.textContent).toContain("Carrier application");
    expect(container.textContent).toContain("User account");
    expect(container.textContent).toContain("413f0022…");
    // The full uuid only appears inside the disclosure, never in the cell head.
    expect(container.querySelector(".slog-summary")?.textContent).not.toContain(
      "413f0022-aaaa",
    );
  });

  it("labels a loopback address without changing it", () => {
    const { container } = renderLog();
    expect(container.textContent).toContain("Local");
    expect(container.textContent).toContain("::1");
    expect(container.textContent).toContain("203.0.113.7");
  });
});

describe("security", () => {
  it("no sensitive value reaches the DOM, open or closed", () => {
    const { container } = renderLog();
    const html = container.innerHTML;
    expect(html).not.toContain("JBSWY3DPEHPK3PXP");
    expect(html).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(html).not.toContain("LEAKED");
    expect(html).toContain("[redacted]");
  });

  it("says plainly that something was withheld", () => {
    const { container } = renderLog();
    expect(container.textContent).toContain("withheld");
  });

  it("the event objects are not mutated by rendering", () => {
    const before = JSON.stringify(EVENTS);
    renderLog();
    expect(JSON.stringify(EVENTS)).toBe(before);
  });
});

describe("structure and accessibility", () => {
  it("uses a real table with column headers", () => {
    const { container } = renderLog();
    const heads = [...container.querySelectorAll("thead th")];
    expect(heads.length).toBe(6);
    for (const th of heads) expect(th.getAttribute("scope")).toBe("col");
  });

  it("the details control is a native disclosure, so it is keyboard-operable", () => {
    const { container } = renderLog();
    const details = container.querySelectorAll("details");
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) {
      // A <summary> is focusable and exposes aria-expanded natively; that is
      // the whole reason for using it rather than a div and a state hook.
      expect(d.querySelector("summary")).toBeTruthy();
    }
  });

  it("the filter input is labelled and described", () => {
    const { container } = renderLog();
    const input = container.querySelector("#af-action")!;
    expect(container.querySelector('label[for="af-action"]')).toBeTruthy();
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(container.querySelector(`#${describedBy}`)).toBeTruthy();
  });

  it("has one h1 and no skipped heading level", () => {
    const { container } = renderLog();
    const levels = [...container.querySelectorAll("h1,h2,h3")].map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  const violations = async (container: HTMLElement) => {
    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return results.violations.map((v) => `${v.id}: ${v.nodes.length}`);
  };

  it("axe — populated", async () => {
    expect(await violations(renderLog().container)).toEqual([]);
  });

  it("axe — empty and filtered", async () => {
    expect(
      await violations(
        renderLog({ events: [], total: 0, totalPages: 1, filter: "mfa" })
          .container,
      ),
    ).toEqual([]);
  });
});

describe("harness", () => {
  it("emits the fixtures the screenshot suite photographs", () => {
    emitHarness("admin-security-log", "portal", renderLog().container);
    cleanup();
    emitHarness(
      "admin-security-log-empty",
      "portal",
      renderLog({ events: [], total: 0, totalPages: 1, filter: "mfa enabled" })
        .container,
    );
    expect(
      harnessWritten(["admin-security-log", "admin-security-log-empty"]),
    ).toBe(true);
  });
});
