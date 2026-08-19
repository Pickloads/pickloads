// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { emitHarness, harnessWritten } from "../harness/emit";
import { KanbanBoard } from "@/components/portal/KanbanBoard";

/**
 * M-101 — a fixture of the leads board, so the scrollbar-position fix can be
 * looked at in a real layout engine.
 *
 * `KanbanBoard` is a client component, so unlike the dashboard it renders in
 * jsdom directly — this is the real component with real markup, not a
 * specimen. What jsdom cannot show is the thing being fixed: a scrollbar has
 * no position without layout. Hence the fixture, and hence
 * `admin-shots.spec.ts` photographing it at four widths.
 */

// KanbanBoard takes its router and Link from the locale-aware wrapper, not
// from `next/navigation` — mocking the latter breaks next-intl's own imports.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("@/app/actions/crm", () => ({
  updateLeadStatus: async () => ({ ok: true }),
}));

const STATUSES = [
  "new",
  "call",
  "qualified",
  "appointment",
  "agreement",
  "waiting_documents",
  "active",
  "inactive",
  "lost",
] as const;

/** Deliberately lopsided: two busy columns and several empty ones, which is
 *  the shape that made the scrollbar sit halfway up the page. */
const COUNTS: Readonly<Record<string, number>> = {
  new: 5,
  call: 3,
  qualified: 1,
};

const leads = STATUSES.flatMap((status) =>
  Array.from({ length: COUNTS[status] ?? 0 }, (_, i) => ({
    id: `${status}-${i}`,
    full_name: `Meridian Freight Systems ${i + 1}`,
    phone: "(908) 555-0142",
    truck_type: i % 2 === 0 ? "Semi" : null,
    trailer_type: i % 2 === 0 ? "Dry van" : null,
    lead_type: (i % 2 === 0 ? "dispatch" : "new_authority") as "dispatch",
    source: "website",
    status,
    priority: (i === 0 ? "urgent" : i === 1 ? "high" : "normal") as "normal",
    tags: i === 0 ? ["callback", "reefer"] : [],
    assigned_to: null,
    callback_at: null,
    created_at: "2026-08-18T08:00:00.000Z",
  })),
);

const staff = [
  { id: "s1", name: "Dana Whitfield" },
  { id: "s2", name: "Marcus Ellery" },
];

describe("M-101 · leads board fixture", () => {
  it("renders every pipeline stage", () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <KanbanBoard leads={leads as any} staff={staff as any} />,
    );
    expect(container.querySelectorAll(".kcol").length).toBe(STATUSES.length);
    expect(container.querySelector(".kboard")).toBeTruthy();
    expect(container.querySelector(".kanban")).toBeTruthy();
  });

  it("emits the fixture the screenshot harness photographs", () => {
    const { container } = render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <KanbanBoard leads={leads as any} staff={staff as any} />,
    );
    const page = document.createElement("div");
    page.innerHTML = `<main id="main" class="a-page is-board"><div class="pbar"><div><span class="crumb">Dispatch desk / CRM</span><h1>Leads pipeline</h1></div><span class="pbadge amber">${leads.length} leads</span></div>${container.innerHTML}</main>`;
    emitHarness("admin-leads-board", "portal", page);
    expect(harnessWritten(["admin-leads-board"])).toBe(true);
  });
});
