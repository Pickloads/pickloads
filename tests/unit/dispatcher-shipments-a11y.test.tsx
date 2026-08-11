// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";

import {
  BOARD_COLUMNS,
  type BoardColumnResult,
  type ShipmentBoardRow,
} from "@/lib/shipments/board";
import { EMPTY_FILTERS } from "@/lib/shipments/shipper-list";
import { EMPTY_SEARCH } from "@/lib/shipments/search";
import {
  ShipmentBoard,
  ShipmentColumnView,
} from "@/components/portal/ShipmentBoardView";
import type { StaffDocumentView } from "@/components/portal/ShipmentDocumentReview";
import { ShipmentStaffDetailView } from "@/components/portal/ShipmentStaffDetailView";
import type {
  StaffAssignmentRow,
  StaffShipmentRow,
  StaffTimelineEvent,
} from "@/lib/shipments/staff-detail";
import type { ShipmentPartyRow } from "@/lib/shipments/types";

/**
 * M-75 — §22/§23 for the three new staff routes, scanned with axe-core against
 * the real components.
 *
 * ── WHY JSDOM, AND WHAT IT CANNOT SEE ─────────────────────────────────────
 *
 * `/portal/admin/**` sits behind a real Supabase session AND the M-61 staff
 * MFA gate. The e2e lane runs `next start` on PLACEHOLDER credentials by
 * design (M-41), so a browser there can only ever reach the login bounce —
 * which `tests/e2e/dispatcher-shipments.spec.ts` ASSERTS, so the limitation is
 * proved rather than assumed. This is the same split M-73 and M-74 established
 * and it is applied here for the same reason: seeding a staff session and a
 * shipment would mean shipping a fabricated shipment fixture into the product,
 * which §30 forbids in the same breath as fake GPS.
 *
 * jsdom applies no stylesheet, so colour contrast is "incomplete" rather than
 * pass/fail. That is covered structurally: **M-75 adds no CSS and no new
 * colour at all** — every class it renders (`.kanban`, `.kcol`, `.kcard`,
 * `.kfilters`, `.ptable`, `.ptable--cards`, `.pcard`, `.pbadge`, `.psh-*`) is
 * an existing, already-audited `portal.css` class. A test below asserts that,
 * because "no new CSS" is only true until somebody adds one.
 */

/* ------------------------------------------------------------------ *
 * next-intl navigation — the components use `Link`; jsdom has no router
 * ------------------------------------------------------------------ */

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/portal/admin/shipments",
  getPathname: ({ href }: { href: string }) => href,
}));

// The forms are client components bound to server actions; the actions module
// pulls `server-only` transitively through the whole shipment write path.
// Stubbing the ACTIONS keeps the real form markup — which is what is scanned.
vi.mock("@/app/actions/dispatcher-shipments", () => {
  const noop = () => Promise.resolve({ status: "idle" as const });
  return {
    addNoteAction: noop,
    assignCarrierAction: noop,
    assignDispatcherAction: noop,
    convertQuoteAction: noop,
    correctStatusAction: noop,
    createShipmentAction: noop,
    // M-76 — §13's two driver-link actions.
    issueDriverTokenAction: noop,
    revokeDriverTokenAction: noop,
    logExceptionAction: noop,
    recordCallAction: noop,
    recordEmailAction: noop,
    releaseCarrierAction: noop,
    requestPodAction: noop,
    resendNotificationAction: noop,
    setAppointmentAction: noop,
    updateEtaAction: noop,
    updateStatusAction: noop,
  };
});

/*
 * M-77 — the documents block binds to server actions, and that module pulls
 * `server-only` transitively through the whole document write path. Stubbing
 * the ACTIONS keeps the real markup — which is what axe scans and what the
 * §16 assertions read.
 */
vi.mock("@/app/actions/shipment-documents", () => {
  const noop = () => Promise.resolve({ status: "idle" as const });
  const url = () => Promise.resolve({ ok: false as const, error: "stub" });
  return {
    carrierUploadDocumentAction: noop,
    driverUploadDocumentAction: noop,
    staffUploadDocumentAction: noop,
    reviewDocumentAction: noop,
    getShipperDocumentUrlAction: url,
    getCarrierDocumentUrlAction: url,
    getBrokerDocumentUrlAction: url,
    getStaffDocumentUrlAction: url,
  };
});

afterEach(cleanup);

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const ROW: ShipmentBoardRow = {
  id: "11111111-1111-4111-8111-111111111111",
  tracking_number: "PL-2026-000458",
  status: "in_transit",
  shipper_id: "s-1",
  carrier_id: "c-1",
  dispatcher_id: "u-1",
  origin_city: "Newark",
  origin_state: "NJ",
  destination_city: "Atlanta",
  destination_state: "GA",
  pickup_appointment_at: "2026-09-01T12:00:00.000Z",
  delivery_appointment_at: "2026-09-03T12:00:00.000Z",
  estimated_delivery_at: "2026-09-03T17:00:00.000Z",
  delay_minutes: 45,
  equipment: "Reefer",
  created_at: "2026-08-01T12:00:00.000Z",
  updated_at: "2026-08-05T12:00:00.000Z",
};

function columns(rows: ShipmentBoardRow[] = [ROW]): BoardColumnResult[] {
  return BOARD_COLUMNS.map((column, i) => ({
    column,
    rows: i % 2 === 0 ? rows : [],
    total: i % 2 === 0 ? rows.length + 12 : 0,
    page: 1,
    pageSize: 8,
    pageCount: 1,
    failed: false,
  }));
}

const SHIPMENT: StaffShipmentRow = {
  id: ROW.id,
  tracking_number: ROW.tracking_number,
  shipper_id: "s-1",
  carrier_id: "c-1",
  dispatcher_id: "u-1",
  quote_id: null,
  broker_partner_id: null,
  load_id: null,
  status: "in_transit",
  origin_company: "Cold Store",
  origin_address: "1 Dock Rd",
  origin_city: "Newark",
  origin_state: "NJ",
  origin_zip: "07105",
  destination_company: "Big Box DC",
  destination_address: "9 Warehouse Way",
  destination_city: "Atlanta",
  destination_state: "GA",
  destination_zip: "30336",
  pickup_appointment_at: "2026-09-01T12:00:00.000Z",
  delivery_appointment_at: "2026-09-03T12:00:00.000Z",
  equipment: "Reefer",
  commodity_category: "Produce",
  weight_lbs: 42000,
  pallets: 24,
  distance_miles: 870,
  gross_shipper_amount: 2450,
  carrier_pay: 2000,
  margin: 450,
  shipper_reference: "REF-1",
  po_number: "PO-4471",
  public_tracking_enabled: true,
  tracking_mode: "manual",
  location_visibility: "approximate",
  current_latitude: null,
  current_longitude: null,
  current_city: "Charlotte",
  current_state: "NC",
  last_location_at: "2026-09-02T12:00:00.000Z",
  estimated_pickup_at: "2026-09-01T12:00:00.000Z",
  estimated_delivery_at: "2026-09-03T17:00:00.000Z",
  eta_source: "manual",
  eta_confidence: "medium",
  eta_updated_at: "2026-09-02T12:00:00.000Z",
  delay_minutes: 45,
  delay_reason_public: "phrase:delay.traffic",
  delay_reason_internal: "receiver ran late",
  created_at: "2026-08-01T12:00:00.000Z",
  updated_at: "2026-09-02T12:00:00.000Z",
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
};

const EVENTS: StaffTimelineEvent[] = [
  {
    id: "e-1",
    shipment_id: SHIPMENT.id,
    event_type: "status_change",
    status: "in_transit",
    event_time: "2026-09-02T09:00:00.000Z",
    recorded_at: "2026-09-02T09:15:00.000Z",
    source: "dispatcher",
    created_by: "u-1",
    city: "Charlotte",
    state: "NC",
    public_message: "The shipment is in transit.",
    internal_message: null,
    visibility: "public",
    metadata: {},
    idempotency_key: null,
    external_event_id: null,
  },
  {
    id: "e-2",
    shipment_id: SHIPMENT.id,
    event_type: "internal_note",
    status: null,
    event_time: "2026-09-02T08:00:00.000Z",
    recorded_at: "2026-09-02T08:00:00.000Z",
    source: "dispatcher",
    created_by: "u-1",
    city: null,
    state: null,
    public_message: null,
    internal_message: "Receiver takes appointments up to 15:00 only.",
    visibility: "staff_only",
    metadata: {},
    idempotency_key: null,
    external_event_id: null,
  },
];

const ASSIGNMENTS: StaffAssignmentRow[] = [
  {
    id: "a-1",
    shipment_id: SHIPMENT.id,
    carrier_id: "c-1",
    driver_id: null,
    truck_id: null,
    dispatcher_id: "u-1",
    assigned_by: "u-1",
    assigned_at: "2026-08-20T12:00:00.000Z",
    released_at: null,
    release_reason: null,
  },
];

const PARTIES: ShipmentPartyRow[] = [
  {
    id: "p-1",
    shipment_id: SHIPMENT.id,
    party_role: "consignee",
    organization_id: null,
    company_name: "Big Box DC",
    contact_name: "Dock office",
    phone: "(404) 555-0100",
    email: null,
    public_contact: false,
    created_at: "2026-08-01T12:00:00.000Z",
  },
];

const DRIVER_TOKENS = [
  {
    id: "dt-1",
    shipment_id: SHIPMENT.id,
    carrier_id: "c-1",
    driver_id: "d-1",
    driver_name: "A Driver",
    issued_by: "u-1",
    issued_by_role: "dispatcher" as const,
    issued_at: "2026-09-01T12:00:00.000Z",
    expires_at: "2099-09-02T12:00:00.000Z",
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
    consent_status: "pending" as const,
    consent_at: null,
    last_used_at: null,
    use_count: 0,
    created_at: "2026-09-01T12:00:00.000Z",
  },
];

/** M-77 — one pending (review controls drawn) and one approved (not drawn). */
const STAFF_DOCUMENTS: StaffDocumentView[] = [
  {
    id: "sd-1",
    doc_type: "pod",
    visibility: "shipper",
    status: "pending",
    file_name: "pod-raw.jpg",
    size_bytes: 810_000,
    uploaded_at: "2026-09-05T08:00:00.000Z",
    approved_at: null,
    review_note: null,
  },
  {
    id: "sd-2",
    doc_type: "bol",
    visibility: "shipper",
    status: "approved",
    file_name: "bol-signed.pdf",
    size_bytes: 210_000,
    uploaded_at: "2026-09-01T08:00:00.000Z",
    approved_at: "2026-09-01T09:00:00.000Z",
    review_note: null,
  },
];

function detail(overrides: Partial<Parameters<typeof ShipmentStaffDetailView>[0]> = {}) {
  return (
    <ShipmentStaffDetailView
      shipment={SHIPMENT}
      events={EVENTS}
      nextCursor="2026-09-02T08:00:00.000Z"
      historyFailed={false}
      assignments={ASSIGNMENTS}
      parties={PARTIES}
      carriers={[{ id: "c-1", label: "Probe Carrier" }]}
      staff={[{ id: "u-2", label: "Other Dispatcher" }]}
      drivers={[{ id: "d-1", label: "A Driver" }]}
      trucks={[{ id: "t-1", label: "101 · Reefer" }]}
      availableTransitions={["arrived_at_delivery", "delayed", "cancelled"]}
      isAdmin
      carrierNames={{ "c-1": "Probe Carrier" }}
      /* M-76 — §13's driver links. One ACTIVE link by default so the block is
         non-vacuous: with an empty list every assertion about the table would
         be true whether or not it rendered. */
      driverTokens={DRIVER_TOKENS}
      driverTokensFailed={false}
      driverLinksEnabled
      /* M-77 — one PENDING and one APPROVED document, so the review controls
         and the "already decided" branch are both exercised. */
      documents={STAFF_DOCUMENTS}
      documentsFailed={false}
      documentsHasMore={false}
      {...overrides}
    />
  );
}

async function scan(): Promise<axe.Result[]> {
  const results = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  });
  return results.violations;
}

/* ------------------------------------------------------------------ *
 * §23 — axe
 * ------------------------------------------------------------------ */

describe("§23 — axe on the board", () => {
  it("has no WCAG A/AA violations in the eight-column view", async () => {
    render(
      <main>
        <h1>Shipments</h1>
        <ShipmentBoard
          columns={columns()}
          filters={EMPTY_FILTERS}
          search={EMPTY_SEARCH}
          restricted={false}
          scopedCarrierCount={0}
        />
      </main>,
    );
    expect(await scan()).toEqual([]);
  });

  it("has no violations in the scoped-dispatcher view with search results", async () => {
    render(
      <main>
        <h1>Shipments</h1>
        <ShipmentBoard
          columns={columns([])}
          filters={EMPTY_FILTERS}
          search={{
            term: {
              kind: "exact",
              value: "PL-2026-000458",
              pattern: null,
              raw: "PL-2026-000458",
            },
            rows: [ROW],
            searched: true,
            failed: false,
            truncated: false,
          }}
          restricted
          scopedCarrierCount={3}
        />
      </main>,
    );
    expect(await scan()).toEqual([]);
  });

  it("has no violations in the expanded, paginated column view", async () => {
    render(
      <main>
        <h1>Shipments</h1>
        <ShipmentColumnView
          result={{
            column: BOARD_COLUMNS[5]!,
            rows: [ROW],
            total: 60,
            page: 2,
            pageSize: 25,
            pageCount: 3,
            failed: false,
          }}
          filters={EMPTY_FILTERS}
          search={EMPTY_SEARCH}
          restricted={false}
          scopedCarrierCount={0}
        />
      </main>,
    );
    expect(await scan()).toEqual([]);
  });

  it("has no violations in the failed-column state", async () => {
    render(
      <main>
        <h1>Shipments</h1>
        <ShipmentBoard
          columns={BOARD_COLUMNS.map((column) => ({
            column,
            rows: [],
            total: null,
            page: 1,
            pageSize: 8,
            pageCount: 1,
            failed: true,
          }))}
          filters={EMPTY_FILTERS}
          search={EMPTY_SEARCH}
          restricted={false}
          scopedCarrierCount={0}
        />
      </main>,
    );
    expect(await scan()).toEqual([]);
  });

  it("the scanner is capable of failing — a missing alt IS reported", async () => {
    render(
      <main>
        <h1>Shipments</h1>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src="/x.png" />
      </main>,
    );
    const violations = await scan();
    expect(violations.map((v) => v.id)).toContain("image-alt");
  });
});

describe("§23 — axe on the shipment detail page", () => {
  it("has no WCAG A/AA violations with the full §14 action set", async () => {
    render(<main>{detail()}</main>);
    expect(await scan()).toEqual([]);
  });

  it("has no violations for a dispatcher (no admin correction form)", async () => {
    render(<main>{detail({ isAdmin: false })}</main>);
    expect(await scan()).toEqual([]);
  });

  it("has no violations in the terminal state with no transitions offered", async () => {
    render(
      <main>
        {detail({
          shipment: { ...SHIPMENT, status: "completed" },
          availableTransitions: [],
        })}
      </main>,
    );
    expect(await scan()).toEqual([]);
  });

  it("has no violations when the history fails to load", async () => {
    render(
      <main>{detail({ events: [], nextCursor: null, historyFailed: true })}</main>,
    );
    expect(await scan()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Structure a scanner cannot see
 * ------------------------------------------------------------------ */

describe("§22/§23 structure", () => {
  it("labels every board column with its name AND its count", () => {
    render(
      <ShipmentBoard
        columns={columns()}
        filters={EMPTY_FILTERS}
        search={EMPTY_SEARCH}
        restricted={false}
        scopedCarrierCount={0}
      />,
    );
    for (const column of BOARD_COLUMNS) {
      const section = document.querySelector(
        `section[aria-label^="${column.label} —"]`,
      );
      expect(section, `${column.label} has no labelled section`).not.toBeNull();
      expect(section!.getAttribute("aria-label")).toMatch(/\d+ shipments/);
    }
  });

  it("renders all eight §14 columns, in §14's order", () => {
    render(
      <ShipmentBoard
        columns={columns()}
        filters={EMPTY_FILTERS}
        search={EMPTY_SEARCH}
        restricted={false}
        scopedCarrierCount={0}
      />,
    );
    const headings = [...document.querySelectorAll(".kcol h3")].map((h) =>
      h.textContent?.replace(/\d+$/, "").trim(),
    );
    expect(headings).toEqual([
      "Needs Carrier",
      "Carrier Assigned",
      "Pickup Today",
      "In Transit",
      "Delivery Today",
      "Delayed",
      "POD Pending",
      "Completed",
    ]);
  });

  it("gives every filter control a <label for>", () => {
    render(
      <ShipmentBoard
        columns={columns()}
        filters={EMPTY_FILTERS}
        search={EMPTY_SEARCH}
        restricted={false}
        scopedCarrierCount={0}
      />,
    );
    const controls = document.querySelectorAll(
      "form.kfilters input, form.kfilters select",
    );
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls) {
      const id = control.getAttribute("id");
      expect(id, "a filter control has no id").toBeTruthy();
      expect(
        document.querySelector(`label[for="${id}"]`),
        `no <label for="${id}">`,
      ).not.toBeNull();
    }
  });

  it("is a plain GET form — keyboard-usable with no JavaScript", () => {
    render(
      <ShipmentBoard
        columns={columns()}
        filters={EMPTY_FILTERS}
        search={EMPTY_SEARCH}
        restricted={false}
        scopedCarrierCount={0}
      />,
    );
    const form = document.querySelector("form.kfilters") as HTMLFormElement;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("role")).toBe("search");
  });

  it("announces the result summary with role=status", () => {
    render(
      <ShipmentBoard
        columns={columns()}
        filters={EMPTY_FILTERS}
        search={EMPTY_SEARCH}
        restricted={false}
        scopedCarrierCount={0}
      />,
    );
    expect(document.querySelector('[role="status"]')).not.toBeNull();
  });

  it("tells a scoped dispatcher their view is scoped, and why", () => {
    render(
      <ShipmentBoard
        columns={columns()}
        filters={EMPTY_FILTERS}
        search={EMPTY_SEARCH}
        restricted
        scopedCarrierCount={3}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Scoped view");
    expect(text).toContain("3 assigned carriers");
    expect(text).toContain("Search is scoped the same way");
  });

  it("renders NO drag handles — status moves go through the engine", () => {
    render(
      <ShipmentBoard
        columns={columns()}
        filters={EMPTY_FILTERS}
        search={EMPTY_SEARCH}
        restricted={false}
        scopedCarrierCount={0}
      />,
    );
    expect(document.querySelectorAll("[draggable]")).toHaveLength(0);
  });

  it("puts a data-th on every body cell of every card table (§22 at 320px)", () => {
    render(<main>{detail()}</main>);
    for (const table of document.querySelectorAll("table.ptable--cards")) {
      const headers = [...table.querySelectorAll("thead th")].map(
        (th) => th.textContent ?? "",
      );
      for (const th of table.querySelectorAll("thead th")) {
        expect(th.getAttribute("scope")).toBe("col");
      }
      for (const row of table.querySelectorAll("tbody tr")) {
        const cells = [...row.querySelectorAll("td")];
        expect(cells).toHaveLength(headers.length);
        cells.forEach((cell, i) => {
          expect(cell.getAttribute("data-th")).toBe(headers[i]);
        });
      }
    }
  });

  it("uses <time datetime> for every timeline instant", () => {
    render(<main>{detail()}</main>);
    const times = [...document.querySelectorAll("time")];
    expect(times.length).toBeGreaterThanOrEqual(EVENTS.length * 2);
    for (const t of times) {
      expect(t.getAttribute("datetime")).toBeTruthy();
    }
  });

  it("shows each event's AUDIENCE BAND as text, never as colour alone", () => {
    render(<main>{detail()}</main>);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Public");
    expect(text).toContain("Staff only");
  });

  it("shows §7's happened-vs-recorded pair, which is the §15 audit question", () => {
    render(<main>{detail()}</main>);
    expect(screen.getByText("Happened")).toBeTruthy();
    expect(screen.getByText("Recorded")).toBeTruthy();
  });

  it("renders §14's fourteen action forms on the detail page", () => {
    render(<main>{detail()}</main>);
    const headings = [...document.querySelectorAll(".pcard h2")].map(
      (h) => h.textContent,
    );
    for (const expected of [
      "Update status",
      // "Assign a carrier" is the OTHER half of the same card — with an open
      // assignment the release form is shown instead. Both are asserted below.
      "Release the carrier",
      "Set or reschedule an appointment",
      "Update ETA",
      "Add an update",
      "Record a call",
      "Record an email",
      "Log an exception",
      "Request proof of delivery",
      "Re-send the customer notification",
      "Move to another dispatcher",
      "Correct the status (admin)",
    ]) {
      expect(headings, `${expected} form is missing`).toContain(expected);
    }
  });

  it("hides the §20 correction form from a dispatcher", () => {
    render(<main>{detail({ isAdmin: false })}</main>);
    const headings = [...document.querySelectorAll(".pcard h2")].map(
      (h) => h.textContent,
    );
    expect(headings).not.toContain("Correct the status (admin)");
  });

  it("offers the release form when a carrier is on, and the assign form when none is", () => {
    render(<main>{detail()}</main>);
    let headings = [...document.querySelectorAll(".pcard h2")].map(
      (h) => h.textContent,
    );
    expect(headings).toContain("Release the carrier");
    expect(headings).not.toContain("Assign a carrier");

    cleanup();
    render(
      <main>
        {detail({
          assignments: [
            { ...ASSIGNMENTS[0]!, released_at: "2026-08-25T12:00:00.000Z" },
          ],
        })}
      </main>,
    );
    headings = [...document.querySelectorAll(".pcard h2")].map(
      (h) => h.textContent,
    );
    expect(headings).toContain("Assign a carrier");
    expect(headings).not.toContain("Release the carrier");
  });

  it("offers ONLY the transitions the engine allows, one button-value each", () => {
    render(<main>{detail()}</main>);
    const select = document.querySelector("#su-to") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "arrived_at_delivery",
      "delayed",
      "cancelled",
    ]);
  });

  it("says so honestly when no transition is possible, rather than showing an empty select", () => {
    render(
      <main>
        {detail({
          shipment: { ...SHIPMENT, status: "completed" },
          availableTransitions: [],
        })}
      </main>,
    );
    expect(document.querySelector("#su-to")).toBeNull();
    expect(document.body.textContent).toContain("No status change is possible");
  });
});

/* ------------------------------------------------------------------ *
 * §30 honest labels on a staff surface
 * ------------------------------------------------------------------ */

describe("§30 — the staff surface does not overclaim either", () => {
  it("labels the ETA as dispatcher-entered and denies prediction", () => {
    render(<main>{detail()}</main>);
    const text = document.body.textContent ?? "";
    expect(text).toContain("ETA entered by dispatch");
    expect(text).toContain("does not predict ETAs");
  });

  it("never claims live tracking, AI or prediction anywhere on the page", () => {
    render(<main>{detail()}</main>);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const banned of [
      "live tracking",
      "real-time",
      "ai-powered",
      "artificial intelligence",
      "machine learning",
      "predicted eta",
    ]) {
      expect(text, `page claims "${banned}"`).not.toContain(banned);
    }
  });

  it("names what is NOT built rather than leaving a dispatcher to discover it", () => {
    render(<main>{detail()}</main>);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Not here yet");
    // M-77 built documents and POD approval, so the honest-gap list shrank.
    // What is still missing is still named.
    expect(text).toContain("Exception resolution");
    expect(text).toContain("localized customer emails");
    expect(text).not.toContain("Documents and POD upload");
  });

  it("states §5 immutability where somebody would look for an edit button", () => {
    render(<main>{detail()}</main>);
    expect(document.body.textContent).toContain(
      "tracking number is fixed at creation and cannot be changed",
    );
  });

  it("tells the operator the notification resend is portal-only, not email", () => {
    render(<main>{detail()}</main>);
    expect(document.body.textContent).toContain("Localized emails");
  });
});

/* ------------------------------------------------------------------ *
 * CLAUDE.md — no new CSS, no raw colour
 * ------------------------------------------------------------------ */

describe("CLAUDE.md — the visual layer is reused, not invented", () => {
  it("renders only classes that already exist in portal.css", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/app/portal.css", "utf8");
    render(
      <main>
        <ShipmentBoard
          columns={columns()}
          filters={EMPTY_FILTERS}
          search={EMPTY_SEARCH}
          restricted
          scopedCarrierCount={2}
        />
        {detail()}
      </main>,
    );
    const used = new Set<string>();
    for (const el of document.querySelectorAll("[class]")) {
      for (const c of el.className.split(/\s+/)) if (c) used.add(c);
    }
    // Global button/field classes live in globals.css; everything portal-shaped
    // must already be declared in portal.css.
    const globalOwned = new Set([
      "btn",
      "btn-sm",
      "btn-amber",
      "btn-ghost",
      "field",
      "invalid",
      "err-msg",
      "mono",
      "crumb",
      // M-73 added `.sr-only` to v4.css (globals.css imports it) because §23's
      // text equivalents needed it and the repo had no such utility. M-76's
      // driver-link table uses it for the revoke column's header, so it joins
      // the globally-owned list rather than being duplicated into portal.css.
      "sr-only",
    ]);
    for (const cls of used) {
      if (globalOwned.has(cls)) continue;
      expect(css, `portal.css does not declare .${cls}`).toContain(`.${cls}`);
    }
  });

  it("uses no raw hex colour in any rendered inline style", () => {
    render(<main>{detail()}</main>);
    for (const el of document.querySelectorAll("[style]")) {
      expect(el.getAttribute("style")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});
