// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";

import messages from "../../messages/en.json";
import { emitHarness, harnessWritten } from "../harness/emit";
import esMessages from "../../messages/es.json";
import frMessages from "../../messages/fr.json";
import ruMessages from "../../messages/ru.json";
import htMessages from "../../messages/ht.json";
import {
  toCustomerDocumentDtos,
  type CustomerDocumentDto,
} from "@/lib/shipments/documents";
import { toShipperDto } from "@/lib/shipments/dto";
import {
  partyRoleKey,
  SHIPMENT_PARTY_ROLES,
  type ShipmentEventRow,
  type ShipmentExceptionRow,
  type ShipmentRow,
} from "@/lib/shipments/types";
import {
  EMPTY_FILTERS,
  type ShipmentListRow,
} from "@/lib/shipments/shipper-list";
import { ShipmentListView } from "@/components/portal/ShipmentListView";
import { ShipmentDetailView } from "@/components/portal/ShipmentDetailView";
import { ShipperTiles } from "@/components/portal/ShipperTiles";
import {
  EMPTY_TILE_COUNTS,
  SHIPPER_TILE_IDS,
} from "@/lib/shipments/shipper-tiles";
import type {
  ShipmentContactView,
  ShipmentInvoiceView,
} from "@/lib/shipments/shipper-detail";

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

/**
 * M-74 — §23 accessibility and §22 mobile structure for BOTH new routes,
 * scanned with axe-core against the real components.
 *
 * ── WHY JSDOM AND NOT PLAYWRIGHT, STATED PLAINLY ──────────────────────────
 *
 * `/portal/shipper/**` sits behind a real Supabase session. The e2e lane runs
 * `next start` on PLACEHOLDER credentials by design (M-41), so those routes
 * there can only ever 307 to `/login` — which `tests/e2e/shipper-shipments.
 * spec.ts` asserts, so the limit is PROVED rather than assumed. Seeding a
 * session and a shipment would mean shipping a fabricated shipment fixture
 * into the product, which §30 forbids in the same breath as fake GPS.
 *
 * So the two views are scanned HERE, against the same components the routes
 * render, with the same five-locale catalogue and the same axe-core version
 * (4.12.x) the Playwright suite uses. This is the split M-73 established for
 * the `/track` result view, applied for the same reason.
 *
 * WHAT THIS CANNOT SEE: jsdom applies no stylesheet, so colour-contrast is
 * "incomplete" rather than pass/fail. That is covered structurally instead —
 * `src/app/portal.css`'s M-74 block introduces NO new colours (every value is
 * an existing `@theme` token or a literal already in that file) and its whole
 * purpose is the dark-surface contrast fix for the reused `.track-*`
 * components. The rules that DO run here — landmarks, headings, table
 * semantics, form labels, names, roles, ARIA validity — are the ones a
 * filter bar and a data table get wrong.
 */

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const LIST_ROWS: ShipmentListRow[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    tracking_number: "PL-2026-000458",
    status: "in_transit",
    origin_city: "Newark",
    origin_state: "NJ",
    destination_city: "Atlanta",
    destination_state: "GA",
    pickup_appointment_at: "2026-08-01T13:00:00.000Z",
    delivery_appointment_at: "2026-08-04T13:00:00.000Z",
    estimated_delivery_at: "2026-08-04T14:00:00.000Z",
    delay_minutes: null,
    equipment: "dry-van",
    shipper_reference: "REF-9",
    po_number: "PO-9",
    carrier_id: "c-1",
    created_at: "2026-07-30T10:00:00.000Z",
    updated_at: "2026-08-03T10:00:00.000Z",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    tracking_number: "PL-2026-000459",
    status: "delayed",
    origin_city: "Chicago",
    origin_state: "IL",
    destination_city: "Dallas",
    destination_state: "TX",
    pickup_appointment_at: null,
    delivery_appointment_at: null,
    estimated_delivery_at: null,
    delay_minutes: 90,
    equipment: "reefer",
    shipper_reference: null,
    po_number: null,
    carrier_id: null,
    created_at: "2026-07-28T10:00:00.000Z",
    updated_at: "2026-08-03T10:00:00.000Z",
  },
];

const SHIPMENT: ShipmentRow = {
  id: "11111111-1111-1111-1111-111111111111",
  tracking_number: "PL-2026-000458",
  shipper_id: "sh-1",
  carrier_id: "ca-1",
  dispatcher_id: null,
  quote_id: null,
  broker_partner_id: null,
  load_id: null,
  status: "in_transit",
  origin_company: "Origin Co",
  origin_address: "1 Dock St",
  origin_city: "Newark",
  origin_state: "NJ",
  origin_zip: "07102",
  destination_company: "Destination Co",
  destination_address: "500 Dock Rd",
  destination_city: "Atlanta",
  destination_state: "GA",
  destination_zip: "30301",
  pickup_appointment_at: "2026-08-01T13:00:00.000Z",
  delivery_appointment_at: "2026-08-04T13:00:00.000Z",
  equipment: "dry-van",
  commodity_category: "general",
  weight_lbs: 38000,
  pallets: 22,
  distance_miles: 870,
  gross_shipper_amount: null,
  carrier_pay: null,
  margin: null,
  shipper_reference: "REF-9",
  po_number: "PO-9",
  public_tracking_enabled: true,
  tracking_mode: "manual",
  location_visibility: "approximate",
  public_access_hash: null,
  current_latitude: null,
  current_longitude: null,
  current_city: "Chattanooga",
  current_state: "TN",
  last_location_at: "2026-08-03T15:00:00.000Z",
  estimated_pickup_at: "2026-08-01T13:00:00.000Z",
  estimated_delivery_at: "2026-08-04T14:00:00.000Z",
  eta_source: "manual",
  eta_confidence: "medium",
  eta_updated_at: "2026-08-03T15:00:00.000Z",
  delay_minutes: null,
  delay_reason_public: null,
  delay_reason_internal: null,
  cancellation_reason: null,
  completed_at: null,
  cancelled_at: null,
  created_at: "2026-07-30T10:00:00.000Z",
  updated_at: "2026-08-03T10:00:00.000Z",
};

const EVENTS: ShipmentEventRow[] = [
  {
    id: "e-1",
    shipment_id: "11111111-1111-1111-1111-111111111111",
    event_type: "status_change",
    status: "picked_up",
    event_time: "2026-08-01T14:00:00.000Z",
    recorded_at: "2026-08-01T14:02:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: "Newark",
    state: "NJ",
    latitude: null,
    longitude: null,
    // D-6 branch 1: a library token, translated in the reader's language.
    public_message: "phrase:update.picked_up",
    internal_message: null,
    visibility: "public",
    metadata: null,
    external_event_id: null,
    idempotency_key: null,
  },
  {
    id: "e-2",
    shipment_id: "11111111-1111-1111-1111-111111111111",
    event_type: "appointment_rescheduled",
    status: null,
    event_time: "2026-08-02T09:00:00.000Z",
    recorded_at: "2026-08-02T09:01:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: null,
    state: null,
    latitude: null,
    longitude: null,
    // D-6 branch 3: novel dispatcher prose, rendered verbatim under the
    // honest "written by dispatch, in English" label with lang="en".
    public_message:
      "Receiver moved the delivery appointment to Thursday 6am after a plant shutdown.",
    internal_message: null,
    visibility: "shipper",
    metadata: null,
    external_event_id: null,
    idempotency_key: null,
  },
  {
    id: "e-3",
    shipment_id: "11111111-1111-1111-1111-111111111111",
    event_type: "status_change",
    status: "in_transit",
    event_time: "2026-08-02T12:00:00.000Z",
    recorded_at: "2026-08-02T12:01:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: "Knoxville",
    state: "TN",
    latitude: null,
    longitude: null,
    public_message: null,
    internal_message: null,
    visibility: "public",
    metadata: null,
    external_event_id: null,
    idempotency_key: null,
  },
];

const OPEN_EXCEPTION: ShipmentExceptionRow = {
  id: "x-1",
  shipment_id: "11111111-1111-1111-1111-111111111111",
  exception_type: "facility_delay",
  severity: "medium",
  public_description: "phrase:exception.facility_delay",
  internal_description: "INTERNAL-EXCEPTION-DETAIL",
  opened_at: "2026-08-03T10:00:00.000Z",
  resolved_at: null,
  opened_by: null,
  assigned_to: null,
  customer_notified_at: null,
  resolution: "INTERNAL-RESOLUTION",
  source_event_id: null,
  resolution_event_id: null,
};

const INVOICES: ShipmentInvoiceView[] = [
  {
    id: "inv-1",
    status: "open",
    amount_cents: 432100,
    currency: "usd",
    issued_at: "2026-08-04T00:00:00.000Z",
    due_at: "2026-09-03T00:00:00.000Z",
    paid_at: null,
    hosted_url: null,
  },
];

/**
 * M-77 — the §16 SHIPPER band, as the server would have filtered it.
 *
 * A rate confirmation is in the raw list on purpose: `toCustomerDocumentDtos`
 * drops it for this audience, so asserting its ABSENCE below is a statement
 * about the matrix rather than about an empty fixture.
 */
const DOCUMENTS: CustomerDocumentDto[] = toCustomerDocumentDtos(
  [
    {
      id: "d-1",
      doc_type: "bol",
      visibility: "shipper",
      status: "approved",
      file_name: "bol-signed.pdf",
      size_bytes: 240_000,
      uploaded_at: "2026-09-01T12:00:00.000Z",
      approved_at: "2026-09-01T13:00:00.000Z",
    },
    {
      id: "d-2",
      doc_type: "pod",
      visibility: "shipper",
      status: "approved",
      file_name: "pod-signed.jpg",
      size_bytes: 900_000,
      uploaded_at: "2026-09-04T18:00:00.000Z",
      approved_at: "2026-09-04T19:00:00.000Z",
    },
    {
      id: "d-3",
      doc_type: "rate_confirmation",
      visibility: "carrier",
      status: "approved",
      file_name: "ratecon.pdf",
      size_bytes: 100_000,
      uploaded_at: "2026-08-30T09:00:00.000Z",
      approved_at: "2026-08-30T10:00:00.000Z",
    },
    {
      id: "d-4",
      doc_type: "pod",
      visibility: "shipper",
      status: "pending",
      file_name: "pod-unchecked.jpg",
      size_bytes: 800_000,
      uploaded_at: "2026-09-05T08:00:00.000Z",
      approved_at: null,
    },
  ],
  "shipper",
);

const CONTACTS: ShipmentContactView[] = [
  {
    id: "p-1",
    party_role: "consignee",
    company_name: "Atlanta DC",
    contact_name: "Receiving Desk",
    phone: "4045550100",
    email: "dock@atlanta-dc.test",
    channels_withheld: false,
  },
  {
    id: "p-2",
    party_role: "carrier",
    company_name: "Carrier A LLC",
    contact_name: null,
    phone: null,
    email: null,
    channels_withheld: true,
  },
];

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

afterEach(() => {
  cleanup();
});

function wrap(
  node: React.ReactNode,
  locale = "en",
  dictionary: Record<string, unknown> = messages,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={dictionary}>
      {/* The portal shell's own landmark + heading, so the scan sees the
          same document structure the route produces. `.portal` also scopes
          the M-74 dark-surface CSS overrides. */}
      <div className="portal">
        <main id="main">
          <h1>Shipments</h1>
          {node}
        </main>
      </div>
    </NextIntlClientProvider>,
  );
}

function renderList(
  overrides: Partial<React.ComponentProps<typeof ShipmentListView>> = {},
  locale = "en",
  dictionary: Record<string, unknown> = messages,
) {
  return wrap(
    <ShipmentListView
      rows={LIST_ROWS}
      filters={EMPTY_FILTERS}
      page={1}
      pageCount={3}
      total={57}
      pageSize={25}
      basePath="/portal/shipper/shipments"
      detailBase="/portal/shipper/shipments"
      failed={false}
      filtered={false}
      {...overrides}
    />,
    locale,
    dictionary,
  );
}

function renderDetail(
  shipmentOverrides: Partial<ShipmentRow> = {},
  exceptions: ShipmentExceptionRow[] = [],
  viewOverrides: Partial<React.ComponentProps<typeof ShipmentDetailView>> = {},
  locale = "en",
  dictionary: Record<string, unknown> = messages,
) {
  const dto = toShipperDto({
    shipment: { ...SHIPMENT, ...shipmentOverrides },
    events: EVENTS,
    exceptions,
  });
  return wrap(
    <ShipmentDetailView
      shipment={dto}
      invoices={INVOICES}
      invoicesFailed={false}
      contacts={CONTACTS}
      documents={DOCUMENTS}
      documentsFailed={false}
      documentsHasMore={false}
      locationsFailed={false}
      historyHasMore={false}
      historyMoreHref={null}
      historyPaged={false}
      historyResetHref="/portal/shipper/shipments/11111111-1111-1111-1111-111111111111"
      supportHref="/portal/shipper/support"
      {...viewOverrides}
    />,
    locale,
    dictionary,
  );
}

async function scan(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
  });
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
}

/* ------------------------------------------------------------------ *
 * §23 — axe
 * ------------------------------------------------------------------ */

describe("shipment list — axe (§23)", () => {
  it("no WCAG A/AA violations with rows", async () => {
    const violations = await scan(renderList().container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations in the EMPTY state", async () => {
    const violations = await scan(
      renderList({ rows: [], total: 0, pageCount: 1 }).container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations in the FILTERED-empty state", async () => {
    const violations = await scan(
      renderList({ rows: [], total: 0, pageCount: 1, filtered: true })
        .container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations in the ERROR state", async () => {
    const violations = await scan(
      renderList({ rows: [], total: null, failed: true }).container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations rendered in Spanish", async () => {
    const violations = await scan(renderList({}, "es", esMessages).container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

describe("shipment detail — axe (§23)", () => {
  it("no WCAG A/AA violations in the ordinary in-transit state", async () => {
    const violations = await scan(renderDetail().container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations in the DELAYED + EXCEPTION state", async () => {
    const violations = await scan(
      renderDetail({ status: "delayed", delay_minutes: 90 }, [OPEN_EXCEPTION])
        .container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations in the CANCELLED state", async () => {
    const violations = await scan(
      renderDetail({
        status: "cancelled",
        cancelled_at: "2026-08-03T12:00:00.000Z",
        cancellation_reason: "Shipper cancelled before pickup",
      }).container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations with an empty invoice and contact set", async () => {
    const violations = await scan(
      renderDetail({}, [], { invoices: [], contacts: [] }).container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations rendered in French", async () => {
    const violations = await scan(
      renderDetail({}, [], {}, "fr", frMessages).container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

describe("dashboard tiles — axe (§11, §23)", () => {
  it("no violations with real counts", async () => {
    const violations = await scan(
      wrap(
        <ShipperTiles
          counts={{
            ...EMPTY_TILE_COUNTS,
            booked: 2,
            pickups_today: 0,
            in_transit: 5,
            delayed: 1,
            deliveries_today: 0,
            completed: 41,
            outstanding_invoices: 3,
          }}
          ids={SHIPPER_TILE_IDS}
        />,
      ).container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations when everything is unmeasurable", async () => {
    const violations = await scan(
      wrap(<ShipperTiles counts={EMPTY_TILE_COUNTS} ids={SHIPPER_TILE_IDS} />)
        .container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

it("NON-VACUITY: the scanner reports a violation when it is given one", async () => {
  const broken = document.createElement("div");
  broken.innerHTML = '<img src="x.png">';
  document.body.appendChild(broken);
  const violations = await scan(broken);
  expect(violations.map((v) => v.id)).toContain("image-alt");
  broken.remove();
});

/* ------------------------------------------------------------------ *
 * §22/§23 — structure the scan cannot see
 * ------------------------------------------------------------------ */

describe("list structure (§22, §23)", () => {
  it("the table carries the M-59 mobile card transform", () => {
    renderList();
    const table = screen.getByRole("table");
    expect(table.className).toContain("ptable--cards");
  });

  it("EVERY body cell carries a data-th label — a cell without one is blank on mobile", () => {
    const { container } = renderList();
    const headers = [...container.querySelectorAll("thead th")].map((th) =>
      th.textContent?.trim(),
    );
    const cells = [...container.querySelectorAll("tbody td")];
    expect(cells.length).toBe(headers.length * LIST_ROWS.length);
    for (const cell of cells) {
      const label = cell.getAttribute("data-th");
      expect(label, `cell "${cell.textContent}" has no data-th`).toBeTruthy();
      expect(headers).toContain(label);
    }
  });

  it("every column header is a scoped <th>", () => {
    const { container } = renderList();
    for (const th of container.querySelectorAll("thead th")) {
      expect(th.getAttribute("scope")).toBe("col");
    }
  });

  it("every filter control has an associated label (§23 keyboard-reachable)", () => {
    const { container } = renderList();
    const controls = container.querySelectorAll(
      "form input, form select, form textarea",
    );
    expect(controls.length).toBe(10); // §11's nine filters + nothing hidden
    for (const control of controls) {
      const id = control.getAttribute("id");
      expect(id, "a filter control has no id").toBeTruthy();
      expect(
        container.querySelector(`label[for="${id}"]`),
        `no <label for="${id}">`,
      ).not.toBeNull();
    }
  });

  it("the filter form is a plain GET — it works with JavaScript off", () => {
    const { container } = renderList();
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/portal/shipper/shipments");
    expect(container.querySelector("form fieldset legend")).not.toBeNull();
  });

  it("pagination is a named nav with real hrefs, and page 1 has no `prev`", () => {
    const { container } = renderList();
    const nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBeTruthy();
    expect(container.querySelector('a[rel="prev"]')).toBeNull();
    const next = container.querySelector('a[rel="next"]')!;
    expect(next.getAttribute("href")).toBe("/portal/shipper/shipments?page=2");
  });

  it("pagination carries the ACTIVE FILTERS into the next page", () => {
    const { container } = renderList({
      filters: { ...EMPTY_FILTERS, status: "in_transit", delayed: true },
      filtered: true,
    });
    const next = container.querySelector('a[rel="next"]')!.getAttribute("href");
    expect(next).toContain("status=in_transit");
    expect(next).toContain("delayed=1");
    expect(next).toContain("page=2");
  });

  it("the result count is an aria-live region — filtering announces its effect", () => {
    const { container } = renderList();
    const status = container.querySelector('.psh-count[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("57");
  });

  it("the error state is announced, not merely styled", () => {
    const { container } = renderList({ rows: [], failed: true, total: null });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("each tracking number links to that shipment's detail route", () => {
    renderList();
    const link = screen.getByText("PL-2026-000458");
    expect(link.getAttribute("href")).toBe(
      "/portal/shipper/shipments/11111111-1111-1111-1111-111111111111",
    );
  });

  it("status is rendered as TEXT, never colour alone (§23)", () => {
    const { container } = renderList();
    // The badge, not the <select> option: disable the stylesheet and the row
    // still says where the freight is.
    const badges = [...container.querySelectorAll("tbody .pbadge")].map((b) =>
      b.textContent?.trim(),
    );
    expect(badges).toEqual(["In transit", "Delayed"]);
  });
});

describe("detail structure (§11, §22, §23, §30)", () => {
  it("renders all ten §11 blocks", () => {
    const { container } = renderDetail();
    const headings = [...container.querySelectorAll("h2")].map((h) =>
      h.textContent?.trim(),
    );
    // timeline · summary · map · support · documents · invoice · contacts ·
    // update history. Status and ETA are header fields, not sections.
    expect(headings).toContain("Progress");
    expect(headings).toContain("Shipment summary");
    expect(headings).toContain("Location");
    expect(headings).toContain("Questions about this shipment?");
    expect(headings).toContain("Documents");
    expect(headings).toContain("Invoice status");
    expect(headings).toContain("Shipment contacts");
    expect(headings).toContain("Update history");
    // Current status + ETA, in the header.
    expect(screen.getByText("Current status")).toBeTruthy();
    expect(screen.getByText("Estimated delivery")).toBeTruthy();
  });

  it("§22 mobile priority order: status → ETA → route → timeline → support → documents → map", () => {
    const { container } = renderDetail();
    const text = container.textContent ?? "";
    const order = [
      "Current status",
      "Estimated delivery",
      "Origin",
      "Progress",
      "Questions about this shipment?",
      "Documents",
    ];
    let cursor = -1;
    for (const label of order) {
      const index = text.indexOf(label);
      expect(index, `${label} missing`).toBeGreaterThan(-1);
      expect(index, `${label} out of §22 order`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("REUSES M-73's timeline: an <ol> of nine milestones with a text equivalent", () => {
    const { container } = renderDetail();
    const timeline = container.querySelector("ol.track-timeline")!;
    expect(timeline).not.toBeNull();
    expect(timeline.querySelectorAll("li")).toHaveLength(9);
    expect(timeline.getAttribute("aria-label")).toBeTruthy();
    const equivalent = container.querySelector('p.sr-only[role="status"]')!;
    expect(equivalent.textContent).toMatch(/of 9 steps complete/);
  });

  it("milestone state is a visible WORD, not only a coloured dot (§23)", () => {
    const { container } = renderDetail();
    const states = [...container.querySelectorAll(".track-step .st")].map((s) =>
      s.textContent?.trim(),
    );
    expect(states.filter((s) => s === "Completed").length).toBeGreaterThan(0);
    expect(states.filter((s) => s === "Current step")).toHaveLength(1);
    expect(states.filter((s) => s === "Not started").length).toBeGreaterThan(0);
  });

  it("§30: the map region is an honest MILESTONE label, never a fake map", () => {
    const { container } = renderDetail();
    const slot = container.querySelector('[data-testid="shipment-map-slot"]')!;
    expect(slot).not.toBeNull();
    expect(slot.textContent).toContain("Milestone tracking");
    /*
     * M-80 replaced M-74's placeholder sentence with the shared panel's
     * `shipment.location.manual_note`, which is MORE specific: it names the
     * missing thing ("not connected to a GPS or ELD provider") rather than
     * only denying a live position. The assertion moves with the copy.
     */
    expect(slot.textContent).toContain(
      "not connected to a GPS or ELD provider",
    );
    // Still no canvas, no iframe, no image and no SVG: this fixture has no
    // disclosed coordinate, so `mapMayMount` is false and the lazy chunk is
    // never even requested. The accessible text alternative is what renders.
    expect(slot.querySelector("canvas, iframe, img, svg")).toBeNull();
    expect(slot.textContent).toContain("Recorded location updates");
  });

  it("§30: no forbidden claim anywhere in the rendered detail view", () => {
    const { container } = renderDetail({ tracking_mode: "manual" });
    const text = (container.textContent ?? "").toLowerCase();
    for (const claim of [
      "real-time",
      "ai-powered",
      "artificial intelligence",
      "machine learning",
    ]) {
      expect(text, `renders the forbidden claim "${claim}"`).not.toContain(
        claim,
      );
    }
    // "live tracking" specifically — M-73's audit note flagged it on /shippers.
    expect(text).not.toContain("live tracking");
  });

  it("D-6: a library phrase is TRANSLATED and novel prose is labelled `lang=en`", () => {
    const { container } = renderDetail({}, [], {}, "es", esMessages);
    expect(container.textContent).toContain("La carga ha sido recogida.");
    const free = container.querySelector('span.msg[lang="en"]')!;
    expect(free).not.toBeNull();
    expect(free.textContent).toContain(
      "Receiver moved the delivery appointment",
    );
    expect(container.textContent).toContain("Escrito por dispatch, en inglés");
  });

  /* M-77 replaced M-74's honest empty state with the real §16 list. The
     assertion that used to pin the placeholder now pins the list — including
     the part that matters, which is that a signed URL is never an `href`. */
  it("the documents section lists the shipper band and mints URLs via an action", () => {
    const { container } = renderDetail();
    const text = container.textContent ?? "";
    expect(text).toContain("bol-signed.pdf");
    expect(text).toContain("pod-signed.jpg");
    // §16: the carrier's rate confirmation is not in the shipper band, and the
    // fixture CONTAINS one, so this zero is a filter result and not an empty
    // list. Non-vacuity by fixture, the M-70 pattern.
    expect(text).not.toContain("ratecon.pdf");
    // A ≤300s bearer credential is never an href, never a download attribute.
    expect(container.querySelector("a[download]")).toBeNull();
    expect(container.querySelector('a[href*="token"]')).toBeNull();
    // It is a BUTTON, because the URL does not exist until it is asked for.
    expect(screen.getAllByRole("button", { name: "Download" }).length).toBe(2);
  });

  it("invoice status comes from the invoice, and shows nothing when there is none", () => {
    renderDetail();
    expect(screen.getByText("Awaiting payment")).toBeTruthy();
    expect(screen.getByText("$4,321.00")).toBeTruthy();
    cleanup();
    const { container } = renderDetail({}, [], { invoices: [] });
    expect(container.textContent).toContain(
      "No invoice has been raised for this shipment yet.",
    );
  });

  it("a withheld carrier channel says so instead of rendering a blank", () => {
    const { container } = renderDetail();
    expect(container.textContent).toContain("Carrier A LLC");
    expect(container.textContent).toContain("Contact through dispatch");
    expect(container.querySelector('a[href^="tel:4045550100"]')).not.toBeNull();
  });

  it("the support link points at the shipper support surface", () => {
    const { container } = renderDetail();
    const link = container.querySelector('a[href="/portal/shipper/support"]')!;
    expect(link).not.toBeNull();
  });

  it("the update history is an <ol> with an accessible name and <time> stamps", () => {
    const { container } = renderDetail();
    const history = container.querySelector("ol.track-events")!;
    expect(history.getAttribute("aria-label")).toBe("Update history");
    expect(history.querySelectorAll("li")).toHaveLength(EVENTS.length);
    expect(history.querySelectorAll("time[datetime]").length).toBe(
      EVENTS.length,
    );
  });

  it("the truncation notice is only shown when history IS truncated", () => {
    const short = renderDetail();
    expect(short.container.textContent).not.toContain(
      "Showing the most recent updates only.",
    );
    cleanup();
    const long = renderDetail({}, [], {
      historyHasMore: true,
      historyMoreHref: "/portal/shipper/shipments/x?before=2026-08-01",
    });
    expect(long.container.textContent).toContain(
      "Showing the most recent updates only.",
    );
    expect(
      long.container.querySelector('a[rel="next"]')?.getAttribute("href"),
    ).toContain("before=");
  });

  it("no §18 financial value can reach the rendered view", () => {
    const { container } = renderDetail();
    const text = container.textContent ?? "";
    // The DTO does not carry them; this asserts the rendered result too.
    for (const forbidden of ["gross", "margin", "carrier pay"]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------ *
 * §24 — catalogue completeness for the keys M-74 added
 * ------------------------------------------------------------------ */

describe("i18n catalogue (§24)", () => {
  const CATALOGUES: Record<string, Record<string, unknown>> = {
    en: messages,
    es: esMessages,
    fr: frMessages,
    ru: ruMessages,
    ht: htMessages,
  };

  function lookup(dictionary: Record<string, unknown>, key: string): unknown {
    return key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        dictionary,
      );
  }

  it("every §18 party role has a label in all five locales", () => {
    for (const role of SHIPMENT_PARTY_ROLES) {
      for (const [locale, dictionary] of Object.entries(CATALOGUES)) {
        const value = lookup(dictionary, partyRoleKey(role));
        expect(typeof value, `${partyRoleKey(role)} missing in ${locale}`).toBe(
          "string",
        );
        expect(String(value).length).toBeGreaterThan(0);
      }
    }
  });

  it("NON-VACUITY: the walker reports a key that does not exist", () => {
    expect(lookup(messages, "shipment.party.nonexistent_role")).toBeUndefined();
  });

  it("es and fr party labels are AUTHORED, not English", () => {
    expect(lookup(esMessages, partyRoleKey("consignee"))).toBe("Destinatario");
    expect(lookup(frMessages, partyRoleKey("consignee"))).toBe("Destinataire");
  });

  it("ru and ht MIRROR English — flagged, never machine-translated (§24)", () => {
    for (const dictionary of [ruMessages, htMessages]) {
      expect(lookup(dictionary, partyRoleKey("consignee"))).toBe(
        lookup(messages, partyRoleKey("consignee")),
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * M-82 — emit the rendered DOM for the browser lane. See
 * `tests/harness/emit.ts` for why this exists and what it does not claim.
 * ------------------------------------------------------------------ */

describe("M-82 — browser harness fixtures", () => {
  it("emits the §11 list and detail states", () => {
    emitHarness("shipper-list-populated", "portal", renderList().container);
    cleanup();
    emitHarness(
      "shipper-list-empty",
      "portal",
      renderList({ rows: [], total: 0, pageCount: 1, filtered: true }).container,
    );
    cleanup();
    emitHarness(
      "shipper-list-failed",
      "portal",
      renderList({ rows: [], total: 0, pageCount: 1, failed: true }).container,
    );
    cleanup();
    emitHarness("shipper-detail-populated", "portal", renderDetail().container);
    cleanup();
    emitHarness(
      "shipper-detail-exception",
      "portal",
      renderDetail({ status: "delayed", delay_minutes: 180 }, [OPEN_EXCEPTION])
        .container,
    );
    cleanup();
    emitHarness(
      "shipper-detail-degraded",
      "portal",
      renderDetail({}, [], {
        documents: [],
        documentsFailed: true,
        invoices: [],
        invoicesFailed: true,
        contacts: [],
        locationsFailed: true,
      }).container,
    );
    // §11's dashboard summary is a tracking surface too — the tile row is the
    // first thing a shipper sees and the first thing that has to reflow.
    cleanup();
    emitHarness(
      "shipper-tiles",
      "portal",
      wrap(
        <ShipperTiles
          counts={{
            ...EMPTY_TILE_COUNTS,
            booked: 2,
            in_transit: 5,
            delayed: 1,
            completed: 41,
            outstanding_invoices: 3,
          }}
          ids={SHIPPER_TILE_IDS}
        />,
      ).container,
    );
    expect(
      harnessWritten([
        "shipper-tiles",
        "shipper-list-populated",
        "shipper-list-empty",
        "shipper-list-failed",
        "shipper-detail-populated",
        "shipper-detail-exception",
        "shipper-detail-degraded",
      ]),
    ).toBe(true);
  });
});
