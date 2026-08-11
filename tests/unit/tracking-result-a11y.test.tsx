// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";

import messages from "../../messages/en.json";
import { emitHarness, harnessWritten } from "../harness/emit";
import esMessages from "../../messages/es.json";
import { toPublicTrackingDto } from "@/lib/shipments/dto";
import { TrackingResult } from "@/components/tracking/TrackingResult";
import type {
  ShipmentEventRow,
  ShipmentExceptionRow,
  ShipmentRow,
} from "@/lib/shipments/types";

/**
 * M-73 — the RESULT PAGE's accessibility (§23) and honesty (§30), scanned with
 * axe-core against the real component.
 *
 * ── WHY THIS RUNS IN JSDOM AND NOT PLAYWRIGHT, STATED PLAINLY ─────────────
 *
 * A live tracking result requires a shipment in a database. The e2e lane runs
 * `next start` on PLACEHOLDER credentials by design (M-41) — no Supabase, no
 * service-role key — so `/track` there can only ever render the form and an
 * honest "temporarily unavailable". Seeding a shipment for the scan would mean
 * shipping a fabricated shipment fixture into the product, which §30 forbids
 * in the same breath as fake GPS and fake ETAs.
 *
 * So the result page is scanned HERE, against the same component the route
 * renders, with the same five-locale catalogue, using the same axe-core
 * version `tests/e2e/axe.spec.ts` uses (4.12.x — it is `@axe-core/playwright`'s
 * own engine, now an explicit devDependency rather than a transitive one).
 *
 * WHAT THIS CANNOT SEE, honestly: jsdom applies no stylesheet, so axe's
 * colour-contrast rule reports "incomplete" rather than pass or fail. That
 * check is covered structurally instead — `src/app/v4.css`'s `.track-*` rules
 * introduce NO new colours (every value is an existing `@theme` token, a shade
 * already present in the file, or white), and the palette they draw from is
 * scanned in the browser on `/track` and fifteen other routes by the Playwright
 * suite. The rules that DO run here — landmarks, headings, list semantics,
 * labels, names, roles, ARIA validity — are the ones a timeline gets wrong.
 */

const ZIP_SHIPMENT: ShipmentRow = {
  id: "s-1",
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
  gross_shipper_amount: 4321,
  carrier_pay: 3210,
  margin: 1111,
  shipper_reference: "REF-9",
  po_number: "PO-9",
  public_tracking_enabled: true,
  tracking_mode: "manual",
  location_visibility: "approximate",
  public_access_hash: "v1:" + "a".repeat(64),
  current_latitude: 35.1,
  current_longitude: -84.2,
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
  delay_reason_internal: "INTERNAL-ONLY",
  created_at: "2026-07-30T09:00:00.000Z",
  updated_at: "2026-08-03T15:00:00.000Z",
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
};

const EVENTS: ShipmentEventRow[] = [
  {
    id: "e-1",
    shipment_id: "s-1",
    event_type: "public_update",
    status: "picked_up",
    event_time: "2026-08-01T14:00:00.000Z",
    recorded_at: "2026-08-01T14:05:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: "Newark",
    state: "NJ",
    latitude: null,
    longitude: null,
    public_message: "phrase:update.picked_up",
    internal_message: null,
    visibility: "public",
    metadata: {},
    external_event_id: null,
    idempotency_key: null,
  },
  {
    id: "e-2",
    shipment_id: "s-1",
    event_type: "public_update",
    status: "in_transit",
    event_time: "2026-08-02T09:00:00.000Z",
    recorded_at: "2026-08-02T09:02:00.000Z",
    source: "dispatcher",
    created_by: null,
    city: "Knoxville",
    state: "TN",
    latitude: null,
    longitude: null,
    // D-6's fallback branch: genuinely novel dispatcher prose.
    public_message:
      "Receiver moved the delivery appointment to Thursday 6am after a plant shutdown.",
    internal_message: null,
    visibility: "public",
    metadata: {},
    external_event_id: null,
    idempotency_key: null,
  },
];

const OPEN_EXCEPTION: ShipmentExceptionRow = {
  id: "x-1",
  shipment_id: "s-1",
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

function renderResult(
  overrides: Partial<ShipmentRow> = {},
  exceptions: ShipmentExceptionRow[] = [],
  locale = "en",
  dictionary: Record<string, unknown> = messages,
) {
  const tracking = toPublicTrackingDto({
    shipment: { ...ZIP_SHIPMENT, ...overrides },
    events: EVENTS,
    exceptions,
  });
  return render(
    <NextIntlClientProvider locale={locale} messages={dictionary}>
      <main id="main">
        <h1>Track a shipment</h1>
        <TrackingResult tracking={tracking} timelineTruncated={false} />
      </main>
    </NextIntlClientProvider>,
  );
}

// `globals: false` in vitest.config.ts means Testing Library's automatic
// cleanup never registers, so every render would accumulate in `document.body`
// and `screen` queries would find each element N times. Explicit is fine.
afterEach(() => {
  cleanup();
});

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

describe("tracking result — axe (§23)", () => {
  it("has no WCAG A/AA violations in the ordinary in-transit state", async () => {
    const { container } = renderResult();
    const violations = await scan(container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("has no violations in the EXCEPTION state (§8's warning style)", async () => {
    const { container } = renderResult({ status: "delayed", delay_minutes: 90 }, [
      OPEN_EXCEPTION,
    ]);
    const violations = await scan(container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("has no violations in the CANCELLED state", async () => {
    const { container } = renderResult({
      status: "cancelled",
      cancelled_at: "2026-08-03T12:00:00.000Z",
    });
    const violations = await scan(container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("has no violations rendered in Spanish", async () => {
    const { container } = renderResult({}, [], "es", esMessages);
    const violations = await scan(container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("NON-VACUITY: the scanner reports a violation it is given one", async () => {
    const broken = document.createElement("div");
    broken.innerHTML = '<img src="x.png">';
    document.body.appendChild(broken);
    const violations = await scan(broken);
    expect(violations.map((v) => v.id)).toContain("image-alt");
    broken.remove();
  });
});

describe("tracking result — §23 semantics", () => {
  it("renders the timeline as an ORDERED LIST with an accessible name", () => {
    renderResult();
    const list = screen.getByRole("list", { name: "Shipment progress" });
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(9);
  });

  it("carries the §23 TEXT EQUIVALENT as a live status region", () => {
    renderResult();
    const status = screen.getByText(
      "5 of 9 steps complete. Current step: In transit.",
    );
    expect(status.getAttribute("role")).toBe("status");
    // Visually hidden, but present in the accessibility tree — the point of a
    // text equivalent is that it is READ, not that it is seen.
    expect(status.className).toContain("sr-only");
  });

  it("states every step's state in TEXT, not only in colour", () => {
    renderResult();
    const list = screen.getByRole("list", { name: "Shipment progress" });
    const items = within(list).getAllByRole("listitem");
    // Five complete, one current, three not started — asserted as words that
    // appear in the DOM, which is what survives a stylesheet being disabled.
    expect(items.filter((li) => li.textContent?.includes("Completed"))).toHaveLength(5);
    expect(items.filter((li) => li.textContent?.includes("Current step"))).toHaveLength(1);
    expect(items.filter((li) => li.textContent?.includes("Not started"))).toHaveLength(3);
  });

  it("uses <time datetime> so timestamps are machine-readable too", () => {
    const { container } = renderResult();
    const times = container.querySelectorAll("time[datetime]");
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (const el of times) {
      expect(el.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("announces the exception state in text, not by colour alone", () => {
    renderResult({ status: "delayed", delay_minutes: 90 }, [OPEN_EXCEPTION]);
    expect(screen.getByText("This shipment is running late")).toBeTruthy();
    expect(
      screen.getByText("There is an issue with this shipment"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "5 of 9 steps complete. Current step: In transit, which needs attention.",
      ),
    ).toBeTruthy();
  });

  it("keeps the support message reachable without JavaScript or a modal", () => {
    const { container } = renderResult();
    const details = container.querySelector("details.track-support");
    expect(details).not.toBeNull();
    expect(details?.querySelector("summary")?.textContent).toBe(
      "Message support about this shipment",
    );
    // A <details> cannot become a full-screen mobile modal (§22) and needs no
    // focus trap — the two things a hand-rolled dialog gets wrong.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("tracking result — §30 honesty and §4 exposure", () => {
  it("labels the update source and the ETA provenance", () => {
    renderResult();
    expect(screen.getByText(/Last updated by dispatch/)).toBeTruthy();
    expect(screen.getByText("ETA provided by dispatcher")).toBeTruthy();
    expect(
      screen.getByText(/Updates are entered by our dispatch team/),
    ).toBeTruthy();
  });

  it("says milestone tracking — never live tracking — in manual mode", () => {
    const { container } = renderResult();
    // M-80 — the label now appears TWICE: the header note M-73 shipped, and
    // the location panel's badge. `getAllByText` rather than `getByText`, and
    // the count is asserted so a future third copy is a visible decision.
    expect(screen.getAllByText("Milestone tracking")).toHaveLength(2);
    const text = (container.textContent ?? "").toLowerCase();
    for (const claim of [
      "live tracking",
      "real-time",
      "ai-powered",
      "artificial intelligence",
    ]) {
      expect(text.includes(claim), `result page claims "${claim}"`).toBe(false);
    }
  });

  it("says the location is unavailable rather than inventing one", () => {
    renderResult({ current_city: null, current_state: null, last_location_at: null });
    // M-80: the header note and the location panel both say it — the badge,
    // and the panel's current-position line. Neither invents a place.
    expect(
      screen.getAllByText("Location temporarily unavailable").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("D-6: translates a library phrase and LABELS novel free text", () => {
    const { container } = renderResult();
    // The token resolved into the reader's language…
    expect(screen.getByText("The freight has been picked up.")).toBeTruthy();
    // …and the novel sentence rendered verbatim, marked lang="en", under the
    // honest label. §24: never machine-translated.
    const free = screen.getByText(/Receiver moved the delivery appointment/);
    expect(free.getAttribute("lang")).toBe("en");
    expect(screen.getByText("Written by dispatch, in English")).toBeTruthy();
    expect(container.textContent).not.toContain("phrase:update.picked_up");
  });

  it("renders NONE of §4's forbidden values", () => {
    const { container } = renderResult({ status: "delayed" }, [OPEN_EXCEPTION]);
    const text = container.textContent ?? "";
    for (const forbidden of [
      "4321",
      "3210",
      "1111",
      "INTERNAL-ONLY",
      "INTERNAL-EXCEPTION-DETAIL",
      "INTERNAL-RESOLUTION",
      "1 Dock St",
      "500 Dock Rd",
      ZIP_SHIPMENT.public_access_hash ?? "",
    ]) {
      expect(text.includes(forbidden), `result page shows ${forbidden}`).toBe(
        false,
      );
    }
    // Non-vacuous: the things it SHOULD show are there.
    expect(text).toContain("PL-2026-000458");
    expect(text).toContain("Newark");
  });

  it("emits a noindex robots meta while a result is on screen", () => {
    renderResult();
    const meta = document.head.querySelector('meta[name="robots"]');
    expect(meta?.getAttribute("content")).toBe("noindex, nofollow");
  });
});

/* ------------------------------------------------------------------ *
 * M-82 — emit the rendered DOM for the browser lane
 *
 * §22 and §23's layout requirements (twelve widths, overflow, clipping, touch
 * targets, real colour contrast) are not observable in jsdom, which applies no
 * stylesheet. These five states are written to disk and re-measured in
 * Chromium behind the real compiled CSS by
 * `tests/e2e/tracking-responsive-a11y.spec.ts`. Same components, same
 * fixtures, same catalogue — only the renderer changes.
 * ------------------------------------------------------------------ */

describe("M-82 — browser harness fixtures", () => {
  it("emits the public result states", () => {
    emitHarness("track-result-populated", "site", renderResult().container);
    cleanup();
    emitHarness(
      "track-result-exception",
      "site",
      renderResult({}, [OPEN_EXCEPTION]).container,
    );
    cleanup();
    emitHarness(
      "track-result-cancelled",
      "site",
      renderResult({ status: "cancelled", cancelled_at: "2026-08-03T10:00:00.000Z" })
        .container,
    );
    cleanup();
    emitHarness(
      "track-result-delayed",
      "site",
      renderResult({
        status: "delayed",
        delay_minutes: 120,
        delay_reason_public: "phrase:delay.weather",
      }).container,
    );
    cleanup();
    const empty = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <main id="main">
          <h1>Track a shipment</h1>
          <TrackingResult
            tracking={toPublicTrackingDto({
              shipment: { ...ZIP_SHIPMENT, status: "quote_requested" },
              events: [],
              exceptions: [],
            })}
            timelineTruncated={false}
          />
        </main>
      </NextIntlClientProvider>,
    );
    emitHarness("track-result-empty", "site", empty.container);
    expect(
      harnessWritten([
        "track-result-populated",
        "track-result-exception",
        "track-result-cancelled",
        "track-result-delayed",
        "track-result-empty",
      ]),
    ).toBe(true);
  });
});
