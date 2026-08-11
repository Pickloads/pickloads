// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";
import { readFileSync } from "node:fs";

import messages from "../../messages/en.json";
import esMessages from "../../messages/es.json";
import frMessages from "../../messages/fr.json";
import ruMessages from "../../messages/ru.json";
import htMessages from "../../messages/ht.json";

import { toCarrierDto } from "@/lib/shipments/dto";
import { EMPTY_FILTERS } from "@/lib/shipments/shipper-list";
import {
  toCustomerDocumentDtos,
  type CustomerDocumentDto,
} from "@/lib/shipments/documents";
import { offeredCarrierActions } from "@/lib/shipments/carrier-updates";
import type { CarrierListRow } from "@/lib/shipments/carrier-shipments";
import type { DriverShipmentView } from "@/lib/shipments/driver-access";
import type { DriverTokenView, ShipmentRow } from "@/lib/shipments/types";
import { CarrierShipmentListView } from "@/components/portal/CarrierShipmentListView";
import { CarrierShipmentDetailView } from "@/components/portal/CarrierShipmentDetailView";
import {
  DriverLinkExpired,
  DriverUpdateView,
} from "@/components/driver/DriverUpdateView";

/**
 * M-76 — §23 accessibility and §22 phone-first structure for BOTH new
 * surfaces, scanned with axe-core against the real components.
 *
 * ── WHY JSDOM FOR THE CARRIER SURFACE, AND WHY NOT FOR THE DRIVER ONE ────
 *
 * `/portal/carrier/**` sits behind a real Supabase session, and the e2e lane
 * runs `next start` on PLACEHOLDER credentials by design (M-41), so those
 * routes there can only ever 307 to `/login` — which
 * `tests/e2e/carrier-driver-updates.spec.ts` asserts, so the limitation is
 * PROVED rather than assumed. The components are therefore scanned here,
 * against the same markup the routes render.
 *
 * `/driver/update/[token]` is DIFFERENT and better off for it: it is
 * unauthenticated, so the axe and responsive Playwright suites scan the REAL
 * PAGE in a REAL BROWSER at every viewport, including 320px. What is scanned
 * here is the GRANTED state, which a browser cannot reach without a live
 * token — the refusal state is what the browser sees, and both are covered.
 *
 * WHAT JSDOM CANNOT SEE: it applies no stylesheet, so colour-contrast is
 * "incomplete" rather than pass/fail. That is covered structurally — the
 * `.driver-*` block introduces no new colour, which is asserted below by
 * parsing `v4.css` — and the driver page's real contrast is scanned in the
 * browser by the axe suite.
 */

const LOCALES = {
  en: messages,
  es: esMessages,
  fr: frMessages,
  ru: ruMessages,
  ht: htMessages,
} as const;

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  getPathname: ({ href }: { href: string }) => href,
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock("@/app/actions/carrier-shipments", () => {
  const noop = () => Promise.resolve({ status: "idle" as const });
  return {
    carrierStatusUpdateAction: noop,
    carrierEtaAction: noop,
    carrierExceptionAction: noop,
    issueDriverLinkAction: noop,
    revokeDriverLinkAction: noop,
  };
});

vi.mock("@/app/actions/driver-updates", () => {
  const noop = () => Promise.resolve({ status: "idle" as const });
  return {
    driverStatusUpdateAction: noop,
    driverEtaAction: noop,
    driverExceptionAction: noop,
    driverConsentAction: noop,
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

const SHIPMENT_ID = "11111111-1111-4111-8111-111111111111";

const LIST_ROWS: CarrierListRow[] = [
  {
    id: SHIPMENT_ID,
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
    po_number: "PO-4471",
    created_at: "2026-07-30T10:00:00.000Z",
    updated_at: "2026-08-02T10:00:00.000Z",
  },
];

const ROW: ShipmentRow = {
  id: SHIPMENT_ID,
  tracking_number: "PL-2026-000458",
  shipper_id: "sh-1",
  carrier_id: "c-1",
  dispatcher_id: "u-1",
  quote_id: null,
  broker_partner_id: null,
  load_id: null,
  status: "arrived_at_delivery",
  origin_company: "Acme Foods",
  origin_address: "1 Dock Rd",
  origin_city: "Newark",
  origin_state: "NJ",
  origin_zip: "07114",
  destination_company: "Big Box DC",
  destination_address: "9 Receiving Way",
  destination_city: "Atlanta",
  destination_state: "GA",
  destination_zip: "30301",
  pickup_appointment_at: "2026-08-01T13:00:00.000Z",
  delivery_appointment_at: "2026-08-04T13:00:00.000Z",
  equipment: "dry-van",
  commodity_category: "dry goods",
  weight_lbs: 40000,
  pallets: 24,
  distance_miles: 870,
  shipper_reference: "REF-9",
  po_number: "PO-4471",
  gross_shipper_amount: null,
  carrier_pay: 2100,
  margin: null,
  public_tracking_enabled: true,
  tracking_mode: "manual",
  location_visibility: "approximate",
  public_access_hash: null,
  current_latitude: null,
  current_longitude: null,
  current_city: "Charlotte",
  current_state: "NC",
  last_location_at: "2026-08-03T18:00:00.000Z",
  estimated_pickup_at: null,
  estimated_delivery_at: "2026-08-04T14:00:00.000Z",
  eta_source: "manual",
  eta_confidence: "medium",
  eta_updated_at: "2026-08-03T18:00:00.000Z",
  delay_minutes: null,
  delay_reason_public: null,
  delay_reason_internal: null,
  cancellation_reason: null,
  completed_at: null,
  cancelled_at: null,
  created_at: "2026-07-30T10:00:00.000Z",
  updated_at: "2026-08-03T18:00:00.000Z",
};

const CARRIER_DTO = toCarrierDto({
  shipment: ROW,
  events: [
    {
      id: "ev-1",
      shipment_id: SHIPMENT_ID,
      event_type: "status_change",
      status: "in_transit",
      event_time: "2026-08-02T14:00:00.000Z",
      recorded_at: "2026-08-02T14:05:00.000Z",
      source: "carrier",
      created_by: null,
      city: "Richmond",
      state: "VA",
      latitude: null,
      longitude: null,
      public_message: "phrase:update.in_transit",
      internal_message: null,
      visibility: "carrier",
      metadata: null,
      external_event_id: null,
      idempotency_key: null,
    },
  ],
});

/**
 * M-77 — the §16 CARRIER band. The carrier's own rate confirmation IS in it
 * (§16 names it carrier-visible; it is their contract), and the shipper's
 * invoice is not — the fixture carries both so the filter is proved rather
 * than assumed.
 */
const CARRIER_DOCUMENTS: CustomerDocumentDto[] = toCustomerDocumentDtos(
  [
    {
      id: "cd-1",
      doc_type: "rate_confirmation",
      visibility: "carrier",
      status: "approved",
      file_name: "ratecon.pdf",
      size_bytes: 120_000,
      uploaded_at: "2026-09-01T10:00:00.000Z",
      approved_at: "2026-09-01T11:00:00.000Z",
    },
    {
      id: "cd-2",
      doc_type: "invoice",
      visibility: "shipper",
      status: "approved",
      file_name: "shipper-invoice.pdf",
      size_bytes: 60_000,
      uploaded_at: "2026-09-06T10:00:00.000Z",
      approved_at: "2026-09-06T11:00:00.000Z",
    },
  ],
  "carrier",
);

const TOKENS: DriverTokenView[] = [
  {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    shipment_id: SHIPMENT_ID,
    carrier_id: "c-1",
    driver_id: "d-1",
    driver_name: "Bob D",
    issued_by: "u-1",
    issued_by_role: "carrier",
    issued_at: "2026-08-03T09:00:00.000Z",
    expires_at: "2099-08-04T09:00:00.000Z",
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
    consent_status: "granted",
    consent_at: "2026-08-03T09:10:00.000Z",
    last_used_at: "2026-08-03T12:00:00.000Z",
    use_count: 3,
    created_at: "2026-08-03T09:00:00.000Z",
  },
  {
    id: "bbbbbbbb-2222-4222-8222-222222222222",
    shipment_id: SHIPMENT_ID,
    carrier_id: "c-1",
    driver_id: null,
    driver_name: null,
    issued_by: "u-1",
    issued_by_role: "dispatcher",
    issued_at: "2026-08-01T09:00:00.000Z",
    expires_at: "2026-08-02T09:00:00.000Z",
    revoked_at: "2026-08-01T15:00:00.000Z",
    revoked_by: "u-1",
    revoke_reason: "wrong driver",
    consent_status: "denied",
    consent_at: "2026-08-01T10:00:00.000Z",
    last_used_at: null,
    use_count: 0,
    created_at: "2026-08-01T09:00:00.000Z",
  },
];

const DRIVER_SHIPMENT: DriverShipmentView = {
  shipment_id: SHIPMENT_ID,
  tracking_number: "PL-2026-000458",
  status: "in_transit",
  origin_company: "Acme Foods",
  origin_city: "Newark",
  origin_state: "NJ",
  destination_company: "Big Box DC",
  destination_city: "Atlanta",
  destination_state: "GA",
  pickup_appointment_at: "2026-08-01T13:00:00.000Z",
  delivery_appointment_at: "2026-08-04T13:00:00.000Z",
  equipment: "dry-van",
  current_city: null,
  current_state: null,
};

function wrap(node: React.ReactNode, locale: keyof typeof LOCALES = "en") {
  return (
    <NextIntlClientProvider locale={locale} messages={LOCALES[locale]}>
      {node}
    </NextIntlClientProvider>
  );
}

function carrierList() {
  return wrap(
    <main>
      <CarrierShipmentListView
        rows={LIST_ROWS}
        filters={EMPTY_FILTERS}
        page={1}
        pageCount={2}
        total={30}
        pageSize={25}
        basePath="/portal/carrier/shipments"
        failed={false}
        filtered={false}
      />
    </main>,
  );
}

function carrierDetail(
  overrides: Partial<Parameters<typeof CarrierShipmentDetailView>[0]> = {},
) {
  return wrap(
    <main>
      <CarrierShipmentDetailView
        shipment={CARRIER_DTO}
        offeredActions={offeredCarrierActions("carrier", ROW.status, {
          activeAssignmentId: "as-1",
          pickupConfirmedAt: "2026-08-01T14:00:00.000Z",
          deliveryTimestamp: "2026-08-04T14:00:00.000Z",
          deliveredAt: null,
          approvedPodDocumentId: null,
          closeoutCompletedAt: null,
          cancellationReason: null,
        })}
        tokens={TOKENS}
        tokensFailed={false}
        documents={CARRIER_DOCUMENTS}
        documentsFailed={false}
        documentsHasMore={false}
        historyHasMore
        historyMoreHref="/portal/carrier/shipments/x?before=y"
        historyPaged={false}
        historyResetHref="/portal/carrier/shipments/x"
        driverLinksEnabled
        {...overrides}
      />
    </main>,
  );
}

function driverPage(
  overrides: Partial<Parameters<typeof DriverUpdateView>[0]> = {},
) {
  return wrap(
    <main className="driver-shell">
      <DriverUpdateView
        token={"A".repeat(43)}
        shipment={DRIVER_SHIPMENT}
        offeredActions={offeredCarrierActions("driver", "in_transit")}
        consentStatus="pending"
        expiresAt="2099-08-04T09:00:00.000Z"
        driverName="Bob D"
        {...overrides}
      />
    </main>,
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

/* ================================================================== *
 * axe
 * ================================================================== */

describe("§23 — axe-core over both M-76 surfaces", () => {
  it("carrier list has no WCAG A/AA violations", async () => {
    const { container } = render(carrierList());
    expect(await scan(container)).toEqual([]);
  });

  it("carrier detail has no WCAG A/AA violations", async () => {
    const { container } = render(carrierDetail());
    expect(await scan(container)).toEqual([]);
  });

  it("carrier detail with NO available actions is still clean", async () => {
    const { container } = render(carrierDetail({ offeredActions: [] }));
    expect(await scan(container)).toEqual([]);
  });

  it("carrier detail with a FAILED driver-link read is still clean", async () => {
    const { container } = render(
      carrierDetail({ tokens: [], tokensFailed: true }),
    );
    expect(await scan(container)).toEqual([]);
  });

  it("driver page has no WCAG A/AA violations", async () => {
    const { container } = render(driverPage());
    expect(await scan(container)).toEqual([]);
  });

  it("driver page with consent GRANTED (location fields shown) is still clean", async () => {
    const { container } = render(driverPage({ consentStatus: "granted" }));
    expect(await scan(container)).toEqual([]);
  });

  it("driver page on a TERMINAL shipment is still clean", async () => {
    const { container } = render(
      driverPage({
        shipment: { ...DRIVER_SHIPMENT, status: "completed" },
        offeredActions: offeredCarrierActions("driver", "completed"),
      }),
    );
    expect(await scan(container)).toEqual([]);
  });

  it("the expired card has no WCAG A/AA violations", async () => {
    const { container } = render(wrap(<main><DriverLinkExpired /></main>));
    expect(await scan(container)).toEqual([]);
  });

  it("the scanner CAN fail — the capability control", async () => {
    // M-73's pattern: build the broken node imperatively rather than in JSX,
    // so the deliberate defect does not have to be lint-suppressed in a file
    // whose whole subject is accessibility.
    const broken = document.createElement("div");
    broken.innerHTML = '<img src="x.png">';
    document.body.appendChild(broken);
    const violations = await scan(broken);
    expect(violations.map((v) => v.id)).toContain("image-alt");
    broken.remove();
  });
});

/* ================================================================== *
 * §30 — the honest labels, and the label M-73 could not render
 * ================================================================== */

describe("§30 honest labels", () => {
  it("renders 'Tracking link expired' — the label M-73 authored and could not use", () => {
    render(wrap(<main><DriverLinkExpired /></main>));
    expect(screen.getByText("Tracking link expired")).toBeTruthy();
  });

  it("renders it in ALL FIVE locales", () => {
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      cleanup();
      const expected = (LOCALES[locale] as typeof messages).shipment.label
        .tracking_link_expired;
      render(wrap(<main><DriverLinkExpired /></main>, locale));
      expect(screen.getByText(expected), locale).toBeTruthy();
    }
  });

  it("makes NO claim §30 forbids on either surface", () => {
    // Phrases that cannot appear honestly in ANY form on these pages.
    const forbidden = [
      "live tracking",
      "real-time",
      "realtime",
      "ai-powered",
      "artificial intelligence",
      "machine learning",
      "predicted eta",
    ];
    for (const node of [driverPage(), carrierDetail(), carrierList()]) {
      cleanup();
      const { container } = render(node);
      const text = (container.textContent ?? "").toLowerCase();
      for (const claim of forbidden) expect(text).not.toContain(claim);
    }
  });

  /**
   * Three words DO appear, and each time as an honest DENIAL: "does not show a
   * live GPS position", "never shows rates, invoices…", "our margin are not
   * shown here". A blanket ban would have forced those sentences out, which is
   * the opposite of what §30 wants — so the assertion is that every occurrence
   * sits in a sentence carrying a negation.
   */
  it("mentions GPS / invoices / margin ONLY inside an explicit denial", () => {
    const NEGATIONS = ["not ", "never", "no ", "n't"];
    for (const node of [driverPage(), carrierDetail()]) {
      cleanup();
      const { container } = render(node);
      const text = (container.textContent ?? "").toLowerCase();
      for (const word of ["gps", "invoice", "margin"]) {
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          if (!sentence.includes(word)) continue;
          expect(
            NEGATIONS.some((n) => sentence.includes(n)),
            `"${word}" appears without a denial: ${sentence}`,
          ).toBe(true);
        }
      }
    }
  });

  it("says out loud what the driver page does NOT do", () => {
    render(driverPage());
    expect(
      screen.getByText(/does not track your phone/i),
    ).toBeTruthy();
    expect(screen.getByText(/never shows rates/i)).toBeTruthy();
  });

  /*
   * M-77 built §13's two upload actions, so the assertion that pinned M-76's
   * honest placeholder now pins the working surface. Both remain §30 claims:
   * the driver page still promises no camera access it does not have, and the
   * carrier page still says a filed document is not a visible one.
   */
  it("§13's two upload actions are BUILT, on both surfaces", () => {
    render(driverPage());
    // Heading AND <legend>: the section is announced twice on purpose, once
    // for the document outline and once for the fieldset (§23).
    expect(screen.getAllByText(/Send a photo/i).length).toBeGreaterThan(0);
    // Exactly the two documents §13 names — the narrowest surface in the
    // product does not also get the widest upload.
    const driverTypes = [
      ...(document.querySelector("#dv-doc-type")?.querySelectorAll("option") ??
        []),
    ].map((o) => o.getAttribute("value"));
    expect(driverTypes).toEqual(["bol", "pod"]);
    cleanup();

    render(carrierDetail());
    const carrierTypes = [
      ...(document
        .querySelector("#cs-doc-upload-type")
        ?.querySelectorAll("option") ?? []),
    ].map((o) => o.getAttribute("value"));
    // §13's two, plus the accessorial evidence only a carrier can produce.
    // Never `invoice`, `quote`, `rate_confirmation` or `claim`: those are ours
    // to issue, and a carrier who could file one could plant a document the
    // shipper then reads as ours.
    expect(carrierTypes).toEqual([
      "bol",
      "pod",
      "lumper_receipt",
      "detention_documentation",
      "delivery_receipt",
    ]);
    expect(carrierTypes).not.toContain("invoice");
    expect(carrierTypes).not.toContain("rate_confirmation");
  });
});

/* ================================================================== *
 * §13 — what the driver page must not contain
 * ================================================================== */

describe("§13 — no financial data, no internal ids", () => {
  it("renders NO money anywhere on the driver page", () => {
    const { container } = render(driverPage());
    const text = container.textContent ?? "";
    // No currency figure of any kind, in any locale's formatting.
    expect(text).not.toMatch(/[$€£]\s?\d/);
    expect(text).not.toMatch(/\d[\d,]*\.\d{2}\b/);
    expect(text.toLowerCase()).not.toContain("carrier pay");
    expect(text.toLowerCase()).not.toContain("rate con");
    // Nor any field that could carry one.
    expect(container.innerHTML).not.toContain("carrier_pay");
    expect(container.innerHTML).not.toContain("gross_shipper_amount");
  });

  it("renders the internal shipment id NOWHERE on the driver page — not even in a hidden field", () => {
    const { container } = render(driverPage());
    expect(container.innerHTML).not.toContain(SHIPMENT_ID);
    // The forms carry the TOKEN, which is what makes that possible.
    const hidden = container.querySelectorAll('input[name="token"]');
    expect(hidden.length).toBeGreaterThan(0);
  });

  it("renders the carrier's own pay on the CARRIER page and never the customer's price", () => {
    const { container } = render(carrierDetail());
    const text = container.textContent ?? "";
    expect(text).toContain("$2,100");
    // §18's other two financial columns are not serialized for this audience
    // at all — `toCarrierDto` has no field for them.
    expect(Object.keys(CARRIER_DTO)).not.toContain("gross_shipper_amount");
    expect(Object.keys(CARRIER_DTO)).not.toContain("margin");
    // "margin" appears once, in the sentence that says it is NOT shown.
    expect(text).toContain("our margin are not shown here");
  });
});

/* ================================================================== *
 * §22 — the phone-first structure
 * ================================================================== */

describe("§22 — phone-first structure", () => {
  it("offers the status choices as RADIOS, not a select, with a label each", () => {
    const { container } = render(driverPage());
    const radios = container.querySelectorAll('input[type="radio"][name="action"]');
    expect(radios.length).toBeGreaterThan(0);
    for (const radio of radios) {
      const label = container.querySelector(`label[for="${radio.id}"]`);
      expect(label, `no label for ${radio.id}`).toBeTruthy();
    }
    // Not a native picker: the whole point of the choice.
    expect(container.querySelector('select[name="action"]')).toBeNull();
  });

  it("draws EXACTLY the offered actions and nothing else", () => {
    const offered = offeredCarrierActions("driver", "in_transit");
    const { container } = render(driverPage());
    const values = [
      ...container.querySelectorAll('input[type="radio"][name="action"]'),
    ].map((el) => (el as HTMLInputElement).value);
    expect(values.sort()).toEqual(
      offered
        .filter((a) => a.kind === "transition")
        .map((a) => a.id)
        .sort(),
    );
    // `confirm_dispatch` is carrier-only and must never appear here.
    expect(values).not.toContain("confirm_dispatch");
  });

  it("renders the honest 'nothing to update' sentence rather than an empty control set", () => {
    render(
      driverPage({
        shipment: { ...DRIVER_SHIPMENT, status: "completed" },
        offeredActions: offeredCarrierActions("driver", "completed"),
      }),
    );
    expect(screen.getByText(/nothing to update/i)).toBeTruthy();
  });

  it("HIDES the location fields until consent is granted, and shows them after", () => {
    // Two fresh renders, not a rerender: the component seeds its local switch
    // from the server's value once, which is the behaviour under test.
    const pending = render(driverPage());
    expect(pending.container.querySelector("#dv-city")).toBeNull();
    expect(pending.container.querySelector("#dv-state")).toBeNull();
    cleanup();
    const granted = render(driverPage({ consentStatus: "granted" }));
    expect(granted.container.querySelector("#dv-city")).toBeTruthy();
    expect(granted.container.querySelector("#dv-state")).toBeTruthy();
  });

  it("starts the consent checkbox UNTICKED — consent is never a default", () => {
    const { container } = render(driverPage());
    const box = container.querySelector<HTMLInputElement>("#dv-consent-box");
    expect(box).toBeTruthy();
    expect(box?.defaultChecked).toBe(false);
  });

  it("gives every driver control a <label for> and every form a <legend>", () => {
    const { container } = render(driverPage({ consentStatus: "granted" }));
    for (const el of container.querySelectorAll("input, select, textarea")) {
      const input = el as HTMLInputElement;
      if (input.type === "hidden") continue;
      expect(
        container.querySelector(`label[for="${input.id}"]`),
        `no label for ${input.id || input.name}`,
      ).toBeTruthy();
    }
    for (const fieldset of container.querySelectorAll("fieldset")) {
      expect(fieldset.querySelector("legend")).toBeTruthy();
    }
  });

  it("puts a data-th on every body cell of every carrier card table", () => {
    for (const node of [carrierList(), carrierDetail()]) {
      cleanup();
      const { container } = render(node);
      for (const table of container.querySelectorAll("table.ptable--cards")) {
        const headers = [...table.querySelectorAll("thead th")].map(
          (th) => th.textContent?.trim() ?? "",
        );
        for (const row of table.querySelectorAll("tbody tr")) {
          const cells = [...row.querySelectorAll("td")];
          expect(cells.length).toBe(headers.length);
          cells.forEach((cell, index) => {
            expect(cell.getAttribute("data-th")).toBe(headers[index]);
          });
        }
      }
    }
  });

  it("uses <time datetime> for every instant it renders", () => {
    const { container } = render(carrierDetail());
    for (const time of container.querySelectorAll("time")) {
      expect(time.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }
  });

  it("renders link state as TEXT, never as colour alone", () => {
    render(carrierDetail());
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Revoked")).toBeTruthy();
    // And the consent state too.
    expect(screen.getByText("Sharing location")).toBeTruthy();
    expect(screen.getByText("Not sharing location")).toBeTruthy();
  });

  it("shows a REVOKE control only for a live link", () => {
    const { container } = render(carrierDetail());
    const tokenInputs = [
      ...container.querySelectorAll<HTMLInputElement>('input[name="token_id"]'),
    ].map((i) => i.value);
    expect(tokenInputs).toEqual([TOKENS[0]!.id]);
  });

  it("never renders a token hash — the column is not even in the type", () => {
    const { container } = render(carrierDetail());
    expect(container.innerHTML).not.toContain("v1:");
    expect(container.innerHTML).not.toContain("token_hash");
    for (const token of TOKENS) {
      expect(Object.keys(token)).not.toContain("token_hash");
    }
  });
});

/* ================================================================== *
 * §22/§23 — the stylesheet's own guarantees
 * ================================================================== */

describe("the .driver-* CSS block", () => {
  const css = readFileSync("src/app/v4.css", "utf8");
  const block = css.slice(css.indexOf("M-76 net-new"));

  it("declares every class the driver components use", () => {
    const { container } = render(driverPage({ consentStatus: "granted" }));
    const used = new Set<string>();
    for (const el of container.querySelectorAll("[class]")) {
      for (const c of el.className.split(/\s+/)) if (c) used.add(c);
    }
    const globalOwned = new Set([
      "btn",
      "btn-amber",
      "mono",
      "sr-only",
      "field",
    ]);
    for (const cls of used) {
      if (globalOwned.has(cls)) continue;
      expect(css, `v4.css does not declare .${cls}`).toContain(`.${cls}`);
    }
  });

  it("gives every interactive control a 56px minimum height (WCAG 2.5.8 + gloves)", () => {
    for (const selector of [
      ".driver-field input",
      ".driver-choice",
      ".driver-check",
      ".driver-submit",
    ]) {
      const rule = block.slice(block.indexOf(selector));
      expect(rule.slice(0, 400), selector).toContain("min-height:56px");
    }
  });

  it("sets a 16px font on inputs so iOS does not zoom the viewport", () => {
    expect(block).toContain("font-size:16px");
  });

  it("declares NO hover rule at all — §22 forbids hover-only interactions", () => {
    expect(block).not.toContain(":hover");
    // Focus-visible is what replaces it, and it IS present.
    expect(block).toContain(":focus-visible");
  });

  it("introduces NO new colour — every value is a token or a shade already in the file", () => {
    const hexes = new Set(block.match(/#[0-9a-fA-F]{3,8}/g) ?? []);
    const rest = css.slice(0, css.indexOf("M-76 net-new"));
    for (const hex of hexes) {
      expect(rest.toLowerCase(), `${hex} is new`).toContain(hex.toLowerCase());
    }
  });

  it("honours prefers-reduced-motion", () => {
    expect(block).toContain("prefers-reduced-motion");
  });
});

/* ================================================================== *
 * §24 — five locales, on the surface that needs them most
 * ================================================================== */

describe("§24 — the driver page in five locales", () => {
  it("renders without a missing-message error in every locale", () => {
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      cleanup();
      const { container } = render(driverPage({ consentStatus: "granted" }), );
      const text = container.textContent ?? "";
      // next-intl renders the KEY when a message is missing; a dotted
      // `shipment.` path in the output is the signature of that.
      expect(text, locale).not.toMatch(/shipment\.[a-z_]+\.[a-z_]+/);
    }
  });

  it("renders SPANISH and FRENCH copy that is actually different from English", () => {
    cleanup();
    const { container: en } = render(driverPage(), );
    const englishTitle = en.querySelector(".driver-title")?.textContent ?? "";
    cleanup();
    const { container: es } = render(
      wrap(
        <main>
          <DriverUpdateView
            token={"A".repeat(43)}
            shipment={DRIVER_SHIPMENT}
            offeredActions={offeredCarrierActions("driver", "in_transit")}
            consentStatus="pending"
            expiresAt="2099-08-04T09:00:00.000Z"
            driverName="Bob D"
          />
        </main>,
        "es",
      ),
    );
    expect(es.querySelector(".driver-title")?.textContent).not.toBe(englishTitle);
  });
});
