// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";

import messages from "../../messages/en.json";
import esMessages from "../../messages/es.json";
import frMessages from "../../messages/fr.json";
import { toBrokerDto } from "@/lib/shipments/dto";
import { toCustomerDocumentDtos } from "@/lib/shipments/documents";
import {
  EMPTY_FILTERS,
  type ShipmentListFilters,
} from "@/lib/shipments/shipper-list";
import type { BrokerListRow } from "@/lib/shipments/broker-access";
import type {
  ShipmentDocumentRow,
  ShipmentEventRow,
  ShipmentRow,
} from "@/lib/shipments/types";
import type { ShipmentContactView } from "@/lib/shipments/shipper-detail";
import { BrokerShipmentListView } from "@/components/portal/BrokerShipmentListView";
import { BrokerShipmentDetailView } from "@/components/portal/BrokerShipmentDetailView";

/*
 * The document block binds to a server action, and that module pulls
 * `server-only` transitively through the whole document write path. Stubbing
 * the ACTIONS keeps the real markup — which is what axe scans and what the
 * §12 assertions read. M-74/M-76's a11y suites do the same.
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
 * M-81 — the §12 partner portal, scanned and structurally asserted.
 *
 * §22 (twelve breakpoints, mobile priority order), §23 (WCAG AA) and §24
 * (five locales) apply to this surface exactly as they do to the shipper and
 * carrier ones, so this suite is the M-74/M-76 pattern: axe over every state
 * the component can be in, plus DOM assertions for the things axe cannot see
 * — the `.ptable--cards` mobile transform, state rendered as TEXT rather than
 * colour, and the §12 deny-list copy actually being present.
 *
 * The DTO under test is the REAL `toBrokerDto`, so the rendered payload is
 * the shipped one and a widening of the serializer would show up here as well
 * as in the matrix suite.
 */

afterEach(cleanup);

const SHIPMENT: ShipmentRow = {
  id: "3f6d1c4e-2b7a-4c9d-8e5f-0a1b2c3d4e5f",
  tracking_number: "PL-2026-000481",
  shipper_id: "shipper-1",
  carrier_id: "carrier-1",
  dispatcher_id: "dispatcher-1",
  quote_id: null,
  broker_partner_id: "bp-1",
  load_id: null,
  status: "in_transit",
  origin_company: "Origin Co",
  origin_address: "1 Dock Rd",
  origin_city: "Newark",
  origin_state: "NJ",
  origin_zip: "07114",
  destination_company: "Dest Co",
  destination_address: "9 Bay St",
  destination_city: "Atlanta",
  destination_state: "GA",
  destination_zip: "30301",
  pickup_appointment_at: "2026-09-01T12:00:00.000Z",
  delivery_appointment_at: "2026-09-03T12:00:00.000Z",
  equipment: "dry-van",
  commodity_category: "general",
  weight_lbs: 41000,
  pallets: 24,
  distance_miles: 870,
  gross_shipper_amount: 987654,
  carrier_pay: 876543,
  margin: 111000,
  shipper_reference: "REF-9",
  po_number: "PO-9",
  public_tracking_enabled: true,
  tracking_mode: "manual",
  location_visibility: "approximate",
  public_access_hash: "secret-hash",
  current_latitude: null,
  current_longitude: null,
  current_city: "Philadelphia",
  current_state: "PA",
  last_location_at: "2026-09-02T09:00:00.000Z",
  estimated_pickup_at: "2026-09-01T11:00:00.000Z",
  estimated_delivery_at: "2026-09-03T11:00:00.000Z",
  eta_source: "calculated",
  eta_confidence: "medium",
  eta_updated_at: "2026-09-02T09:05:00.000Z",
  delay_minutes: null,
  delay_reason_public: null,
  delay_reason_internal: "internal only",
  created_at: "2026-08-30T08:00:00.000Z",
  updated_at: "2026-09-02T09:05:00.000Z",
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
};

const EVENTS: ShipmentEventRow[] = [
  {
    id: "ev-1",
    shipment_id: SHIPMENT.id,
    event_type: "status_change",
    status: "in_transit",
    event_time: "2026-09-02T09:00:00.000Z",
    recorded_at: "2026-09-02T09:00:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: "Philadelphia",
    state: "PA",
    latitude: null,
    longitude: null,
    public_message: "shipment.phrase.in_transit_on_schedule",
    internal_message: null,
    visibility: "public",
    metadata: null,
    external_event_id: null,
    idempotency_key: null,
  },
  {
    id: "ev-2",
    shipment_id: SHIPMENT.id,
    event_type: "document_uploaded",
    status: null,
    event_time: "2026-09-02T10:00:00.000Z",
    recorded_at: "2026-09-02T10:00:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: null,
    state: null,
    latitude: null,
    longitude: null,
    public_message: "BOL released to the partner",
    internal_message: null,
    visibility: "broker",
    metadata: null,
    external_event_id: null,
    idempotency_key: null,
  },
];

const DOCUMENT_ROWS: ShipmentDocumentRow[] = [
  {
    id: "doc-1",
    shipment_id: SHIPMENT.id,
    doc_type: "bol",
    visibility: "shipper",
    status: "approved",
    storage_path: `shipments/${SHIPMENT.id}/bol.pdf`,
    file_name: "bol.pdf",
    mime_type: "application/pdf",
    size_bytes: 204800,
    uploaded_by: null,
    uploaded_at: "2026-09-02T10:00:00.000Z",
    reviewed_by: null,
    reviewed_at: "2026-09-02T10:05:00.000Z",
    approved_by: null,
    approved_at: "2026-09-02T10:05:00.000Z",
    review_note: null,
  },
];

const CONTACTS: ShipmentContactView[] = [
  {
    id: "party-1",
    party_role: "consignee",
    company_name: "Atlanta DC",
    contact_name: "Receiving Desk",
    phone: "(404) 555-0100",
    email: "dock@atlanta-dc.test",
    channels_withheld: false,
  },
  {
    id: "party-2",
    party_role: "carrier",
    company_name: "Carrier Co",
    contact_name: null,
    phone: null,
    email: null,
    channels_withheld: true,
  },
];

const LIST_ROWS: BrokerListRow[] = [
  {
    id: SHIPMENT.id,
    tracking_number: "PL-2026-000481",
    status: "in_transit",
    origin_city: "Newark",
    origin_state: "NJ",
    destination_city: "Atlanta",
    destination_state: "GA",
    pickup_appointment_at: "2026-09-01T12:00:00.000Z",
    delivery_appointment_at: "2026-09-03T12:00:00.000Z",
    estimated_delivery_at: "2026-09-03T11:00:00.000Z",
    delay_minutes: null,
    equipment: "dry-van",
    shipper_reference: "REF-9",
    po_number: "PO-9",
    created_at: "2026-08-30T08:00:00.000Z",
    updated_at: "2026-09-02T09:05:00.000Z",
  },
];

function renderWith(
  node: React.ReactElement,
  locale = "en",
  dictionary: typeof messages = messages,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={dictionary}>
      {node}
    </NextIntlClientProvider>,
  );
}

function renderList(
  overrides: Partial<React.ComponentProps<typeof BrokerShipmentListView>> = {},
  locale = "en",
  dictionary: typeof messages = messages,
) {
  const filters: ShipmentListFilters = { ...EMPTY_FILTERS };
  return renderWith(
    <BrokerShipmentListView
      rows={LIST_ROWS}
      filters={filters}
      page={1}
      pageCount={2}
      total={30}
      pageSize={25}
      basePath="/portal/broker"
      detailBase="/portal/broker/shipments"
      failed={false}
      filtered={false}
      truncated={false}
      {...overrides}
    />,
    locale,
    dictionary,
  );
}

function renderDetail(
  overrides: Partial<React.ComponentProps<typeof BrokerShipmentDetailView>> = {},
  locale = "en",
  dictionary: typeof messages = messages,
) {
  const shipment = toBrokerDto({ shipment: SHIPMENT, events: EVENTS });
  return renderWith(
    <BrokerShipmentDetailView
      shipment={shipment}
      contacts={CONTACTS}
      contactsFailed={false}
      documents={toCustomerDocumentDtos(DOCUMENT_ROWS, "broker")}
      documentsFailed={false}
      documentsHasMore={false}
      basis={{
        kind: "grant",
        since: "2026-09-01T00:00:00.000Z",
        reference: "Shared for the Acme lane",
      }}
      historyHasMore
      historyMoreHref="/portal/broker/shipments/x?before=2026-09-02T09:00:00.000Z"
      historyPaged={false}
      historyResetHref="/portal/broker/shipments/x"
      {...overrides}
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

describe("broker list — axe (§23)", () => {
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

  it("no violations in the TRUNCATED state", async () => {
    const violations = await scan(renderList({ truncated: true }).container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations rendered in Spanish", async () => {
    const violations = await scan(renderList({}, "es", esMessages).container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

describe("broker detail — axe (§23)", () => {
  it("no violations in the ordinary in-transit state", async () => {
    const violations = await scan(renderDetail().container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations with no contacts and no documents", async () => {
    const violations = await scan(
      renderDetail({ contacts: [], documents: [] }).container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations when both reads FAILED", async () => {
    const violations = await scan(
      renderDetail({
        contacts: [],
        contactsFailed: true,
        documents: [],
        documentsFailed: true,
      }).container,
    );
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations with no access basis (link-only shipment)", async () => {
    const violations = await scan(renderDetail({ basis: null }).container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("no violations rendered in French", async () => {
    const violations = await scan(renderDetail({}, "fr", frMessages).container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * §22 — the mobile transform, and structure axe cannot see
 * ------------------------------------------------------------------ */

describe("broker list structure (§22, §23)", () => {
  it("gives every body cell a data-th matching its column header", () => {
    const { container } = renderList();
    const table = container.querySelector("table.ptable--cards");
    expect(table).not.toBeNull();
    const headers = [...(table?.querySelectorAll("thead th") ?? [])].map((th) =>
      (th.textContent ?? "").trim(),
    );
    for (const row of table?.querySelectorAll("tbody tr") ?? []) {
      const cells = [...row.querySelectorAll("td")];
      expect(cells).toHaveLength(headers.length);
      cells.forEach((cell, index) => {
        expect(cell.getAttribute("data-th")).toBe(headers[index]);
      });
    }
  });

  it("announces the result count in a live region", () => {
    renderList();
    expect(screen.getByRole("status").textContent).toMatch(/Showing 1–1 of 30/);
  });

  it("renders status as TEXT, never colour alone", () => {
    renderList();
    expect(screen.getAllByText("In transit").length).toBeGreaterThan(0);
  });

  it("shows no money column at all (§12)", () => {
    const { container } = renderList();
    expect(container.textContent).not.toMatch(/\$/);
    expect(container.textContent).not.toContain("876543");
    expect(container.textContent).not.toContain("987654");
  });

  it("uses a plain GET form so the URL is the state (§23)", () => {
    const { container } = renderList();
    const form = container.querySelector("form[role='search']");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/portal/broker");
    // Every control is labelled.
    for (const control of form?.querySelectorAll("input, select") ?? []) {
      const id = control.getAttribute("id");
      if (control.getAttribute("type") === "hidden") continue;
      expect(id, `unlabelled control ${control.outerHTML}`).toBeTruthy();
      expect(form?.querySelector(`label[for='${id}']`)).not.toBeNull();
    }
  });
});

describe("broker detail structure (§12, §22, §30)", () => {
  it("renders no form and no submit control — the surface is read-only (§19)", () => {
    const { container } = renderDetail();
    // The document download button is a <button> inside its own form-less
    // control; what must NOT exist is any form posting to a shipment action.
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });

  it("shows no financial value anywhere in the DOM (§12)", () => {
    const { container } = renderDetail();
    const text = container.textContent ?? "";
    for (const leak of ["876543", "987654", "111000", "internal only", "secret-hash"]) {
      expect(text, `${leak} leaked into the DOM`).not.toContain(leak);
    }
  });

  it("states §12's deny list to the partner (§30 honest states)", () => {
    renderDetail();
    const note = screen.getByText(/never shows/i, { selector: "h2" });
    expect(note).not.toBeNull();
    expect(
      screen.getByRole("note").textContent?.toLowerCase(),
    ).toContain("margin");
  });

  it("names the grant that produced the access", () => {
    renderDetail();
    expect(screen.getByText(/was shared with your organization/i)).toBeTruthy();
    expect(screen.getByText(/Shared for the Acme lane/)).toBeTruthy();
  });

  it("reports the carrier as a boolean, never an identity (§12)", () => {
    const { container } = renderDetail();
    expect(container.textContent).toContain("A carrier is assigned");
    expect(container.textContent).not.toContain("carrier-1");
  });

  it("says when a contact channel was withheld rather than showing a blank", () => {
    renderDetail();
    expect(screen.getByText(/Some contact details are not shared/i)).toBeTruthy();
  });

  it("puts status and ETA before the timeline in DOM order (§22 priority)", () => {
    const { container } = renderDetail();
    const headings = [...container.querySelectorAll("h2")].map((h) =>
      (h.textContent ?? "").trim(),
    );
    expect(headings[0]).toBe("Shipment details");
    expect(headings.indexOf("Progress")).toBeGreaterThan(0);
    expect(headings.indexOf("Approved contacts")).toBeGreaterThan(
      headings.indexOf("Progress"),
    );
  });

  it("renders the timeline through the shared semantic component", () => {
    const { container } = renderDetail();
    // The shared TrackingTimeline emits its own text-equivalent list.
    expect(container.querySelector("ol, ul")).not.toBeNull();
    expect(container.querySelector(".track-events")).not.toBeNull();
  });
});
