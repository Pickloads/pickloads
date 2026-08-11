// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";

import messages from "../../messages/en.json";
import esMessages from "../../messages/es.json";
import { LocationPanel } from "@/components/tracking/LocationPanel";
import ShipmentMap, { projectPoints } from "@/components/tracking/ShipmentMap";
import type { LocationReading } from "@/components/tracking/LocationPanel";
import {
  SHIPMENT_LOCATION_VISIBILITIES,
  type ShipmentLocationVisibility,
} from "@/lib/shipments/types";

/**
 * M-80 — the location panel and the route diagram, scanned with axe-core
 * against the real components.
 *
 * ── WHY THIS RUNS IN JSDOM AND NOT PLAYWRIGHT ────────────────────────────
 *
 * Same argument M-73 wrote for the tracking result: every surface that
 * renders this panel sits behind either a live shipment lookup or a Supabase
 * session, and the e2e lane runs `next start` on PLACEHOLDER credentials by
 * design. Seeding a shipment with a fabricated GPS fix so a browser could
 * scan the map is precisely what §30 forbids. So the browser lane proves the
 * things only a browser can (the map chunk is never requested; `/track` stays
 * axe-clean and responsive), and the component states are scanned here.
 *
 * WHAT JSDOM CANNOT SEE, stated honestly: no stylesheet is applied, so axe
 * reports colour-contrast as "incomplete". The `.shipmap-*` rules introduce
 * NO new colours — every value is an existing `@theme` token or a shade
 * already in `v4.css` — and the palette they draw from is scanned in a real
 * browser on sixteen routes by the Playwright suite.
 */

const READINGS: LocationReading[] = [
  {
    recorded_at: "2026-08-04T13:05:00.000Z",
    city: "Richmond",
    state: "VA",
    latitude: 37.5407,
    longitude: -77.436,
    speed_mph: 62,
    source: "eld",
  },
  {
    recorded_at: "2026-08-04T09:00:00.000Z",
    city: "Baltimore",
    state: "MD",
    latitude: 39.2904,
    longitude: -76.6122,
    speed_mph: 58,
    source: "eld",
  },
  {
    recorded_at: "2026-08-03T18:00:00.000Z",
    city: "Newark",
    state: "NJ",
    latitude: null,
    longitude: null,
    speed_mph: null,
    source: "dispatcher",
  },
];

function panel(
  overrides: Partial<React.ComponentProps<typeof LocationPanel>> = {},
  locale = "en",
  dictionary: Record<string, unknown> = messages,
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={dictionary}>
      <main>
        <LocationPanel
          headingId="loc-h"
          level="approximate"
          trackingMode="manual"
          currentCity="Richmond"
          currentState="VA"
          currentLatitude={null}
          currentLongitude={null}
          lastLocationAt="2026-08-04T13:05:00.000Z"
          readings={READINGS}
          {...overrides}
        />
      </main>
    </NextIntlClientProvider>,
  );
}

async function scan(): Promise<axe.Result[]> {
  const results = await axe.run(document.body, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
  });
  return results.violations;
}

afterEach(cleanup);

/** Strip `/* … *\/` and `//` comments so a source scan reads CODE, not prose. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ================================================================== *
 * 1 · §23 — axe, in every state
 * ================================================================== */

describe("§23 — axe on the location panel", () => {
  for (const level of SHIPMENT_LOCATION_VISIBILITIES) {
    it(`has no WCAG A/AA violations at level "${level}"`, async () => {
      panel({ level });
      expect(await scan()).toEqual([]);
    });
  }

  it("has no violations with NO readings at all (the honest empty state)", async () => {
    panel({
      readings: [],
      currentCity: null,
      currentState: null,
      lastLocationAt: null,
    });
    expect(await scan()).toEqual([]);
  });

  it("has no violations when the read FAILED", async () => {
    panel({ failed: true });
    expect(await scan()).toEqual([]);
  });

  it("has no violations with the map mounted", async () => {
    // The one state where the SVG renders: a live source plus real
    // coordinates, which is the staff audience today.
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <main>
          <h1>Shipment</h1>
          <section aria-labelledby="m-h">
            <h2 id="m-h">Location</h2>
            <ShipmentMap
              points={[
                {
                  recorded_at: "2026-08-04T13:05:00.000Z",
                  latitude: 37.5407,
                  longitude: -77.436,
                  city: "Richmond",
                  state: "VA",
                },
                {
                  recorded_at: "2026-08-04T09:00:00.000Z",
                  latitude: 39.2904,
                  longitude: -76.6122,
                  city: "Baltimore",
                  state: "MD",
                },
              ]}
              title="Route diagram of recorded positions"
              description="2 location updates on record. Most recent: Richmond, VA."
            />
          </section>
        </main>
      </NextIntlClientProvider>,
    );
    expect(await scan()).toEqual([]);
  });
});

/* ================================================================== *
 * 2 · §23 — the ACCESSIBLE ALTERNATIVE
 * ================================================================== */

describe("§23 — the accessible map alternative", () => {
  it("renders a VISIBLE ordered list of readings, not alt text", () => {
    const { container } = panel();
    const list = container.querySelector("ol.shipmap-list");
    expect(list).not.toBeNull();
    expect(list?.getAttribute("aria-hidden")).toBeNull();
    expect(within(list as HTMLElement).getAllByRole("listitem")).toHaveLength(3);
  });

  it("is present even when the map is NOT — which is every shipment today", () => {
    const { container } = panel({ trackingMode: "manual" });
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("ol.shipmap-list")).not.toBeNull();
  });

  it("gives every reading a machine-readable <time datetime>", () => {
    const { container } = panel();
    const times = Array.from(
      container.querySelectorAll("ol.shipmap-list time"),
    );
    expect(times).toHaveLength(3);
    for (const time of times) {
      expect(time.getAttribute("datetime")).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect((time.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("carries a live-region summary that names the count and the place", () => {
    panel();
    const summary = screen.getByText(/3 location updates on record/);
    expect(summary).toBeTruthy();
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.textContent).toContain("Richmond, VA");
  });

  it("the map's accessible description IS the list's summary — one string", async () => {
    // If they could differ, a screen-reader user and a sighted user would be
    // told different things about the same picture. `findBy…` because the map
    // arrives through `next/dynamic`, which is the §25 proof in its own right:
    // the SVG is genuinely not in the first render.
    const { container } = panel({ level: "exact", trackingMode: "eld" });
    expect(container.querySelector("svg")).toBeNull();
    await screen.findByTestId("shipment-map");
    const desc = container.querySelector("svg desc")?.textContent ?? "";
    const summary =
      container.querySelector(".shipmap-alt p[role='status']")?.textContent ??
      "";
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).toBe(summary);
  });

  it("the section is headed and labelled, so it is a landmark a reader can jump to", () => {
    const { container } = panel();
    const section = container.querySelector("section[aria-labelledby='loc-h']");
    expect(section).not.toBeNull();
    expect(container.querySelector("#loc-h")?.textContent).toBe("Location");
  });
});

/* ================================================================== *
 * 3 · §30 — honesty
 * ================================================================== */

describe("§30 — the panel never overclaims", () => {
  it("says MILESTONE TRACKING in manual mode, and names the missing provider", () => {
    const { container } = panel();
    expect(screen.getByTestId("shipment-map-label").textContent).toBe(
      "Milestone tracking",
    );
    expect(container.textContent).toContain(
      "not connected to a GPS or ELD provider",
    );
  });

  it("says LOCATION TEMPORARILY UNAVAILABLE rather than inventing a place", () => {
    panel({
      readings: [],
      currentCity: null,
      currentState: null,
      lastLocationAt: null,
    });
    expect(screen.getByTestId("shipment-map-label").textContent).toBe(
      "Location temporarily unavailable",
    );
  });

  it("says LIVE LOCATION AVAILABLE only with a live source and a coordinate", () => {
    panel({ level: "exact", trackingMode: "eld" });
    expect(screen.getByTestId("shipment-map-label").textContent).toBe(
      "Live location available",
    );
  });

  it("renders NO map — and no marker of any kind — in manual mode", () => {
    const { container } = panel({ trackingMode: "manual", level: "exact" });
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("canvas, iframe, img")).toBeNull();
  });

  it("hides the panel's position entirely at hidden and milestone_only", () => {
    for (const level of ["hidden", "milestone_only"] as const) {
      cleanup();
      panel({ level, currentCity: "Richmond", currentState: "VA" });
      // Indistinguishable from "no readings yet" — the setting is not a signal.
      expect(screen.getByTestId("shipment-map-label").textContent).toBe(
        "Location temporarily unavailable",
      );
      expect(screen.getByTestId("shipment-map-current").textContent).toBe(
        "Location temporarily unavailable",
      );
    }
  });

  it("makes no forbidden claim in any state", () => {
    for (const level of SHIPMENT_LOCATION_VISIBILITIES) {
      cleanup();
      const { container } = panel({
        level: level as ShipmentLocationVisibility,
        trackingMode: "eld",
      });
      const text = (container.textContent ?? "").toLowerCase();
      for (const claim of [
        "live tracking",
        "real-time",
        "ai-powered",
        "artificial intelligence",
        "machine learning",
        "predictive",
      ]) {
        expect(text, `claims "${claim}" at ${level}`).not.toContain(claim);
      }
    }
  });
});

/* ================================================================== *
 * 4 · §24 — localisation
 * ================================================================== */

describe("§24 — every customer string is translated", () => {
  it("renders Spanish copy from the catalogue, not English fallbacks", () => {
    const { container } = panel({}, "es", esMessages);
    expect(container.textContent).toContain("Seguimiento por hitos");
    expect(container.textContent).toContain(
      "Actualizaciones de ubicación registradas",
    );
    expect(container.textContent).not.toContain("Milestone tracking");
  });

  it("has the whole `shipment.location` namespace in all five locales", () => {
    const locales = ["en", "es", "fr", "ru", "ht"];
    const keys = Object.keys(
      (messages as { shipment: { location: Record<string, string> } }).shipment
        .location,
    );
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const locale of locales) {
      const cat = JSON.parse(
        readFileSync(`messages/${locale}.json`, "utf8"),
      ) as { shipment: { location?: Record<string, string> } };
      expect(cat.shipment.location, `${locale} is missing the namespace`).toBeTruthy();
      for (const key of keys) {
        expect(
          (cat.shipment.location ?? {})[key],
          `${locale} is missing shipment.location.${key}`,
        ).toBeTruthy();
      }
    }
  });
});

/* ================================================================== *
 * 5 · §25 — lazy loading, and the bound
 * ================================================================== */

describe("§25 — the map is lazy-loaded and the list is bounded", () => {
  it("the panel reaches ShipmentMap ONLY through next/dynamic", () => {
    const source = readFileSync(
      "src/components/tracking/LocationPanel.tsx",
      "utf8",
    );
    expect(source).toContain('dynamic(() => import("@/components/tracking/ShipmentMap")');
    expect(source).toContain("ssr: false");
    // A static import would defeat the chunk boundary entirely.
    expect(source).not.toMatch(
      /^import ShipmentMap from/m,
    );
  });

  it("no other module imports ShipmentMap statically", () => {
    // The map must have exactly one entry point, or "lazy-loaded" is a claim
    // about one call site rather than about the bundle.
    for (const file of [
      "src/components/tracking/TrackingResult.tsx",
      "src/components/portal/ShipmentDetailView.tsx",
      "src/components/portal/ShipmentStaffDetailView.tsx",
    ]) {
      expect(readFileSync(file, "utf8")).not.toContain("tracking/ShipmentMap");
    }
  });

  it("shows at most twelve readings and says how many more exist", () => {
    const many: LocationReading[] = Array.from({ length: 20 }, (_, i) => ({
      recorded_at: new Date(Date.UTC(2026, 7, 4, 12 - i)).toISOString(),
      city: `City ${i}`,
      state: "VA",
      latitude: null,
      longitude: null,
      speed_mph: null,
      source: "dispatcher" as const,
    }));
    const { container } = panel({ readings: many });
    expect(container.querySelectorAll("ol.shipmap-list li")).toHaveLength(12);
    expect(container.textContent).toContain(
      "8 older location updates are on record",
    );
  });
});

/* ================================================================== *
 * 6 · The projection
 * ================================================================== */

describe("the route projection", () => {
  it("returns nothing for no points", () => {
    expect(projectPoints([])).toEqual([]);
  });

  it("places a single point without dividing by a zero span", () => {
    const projected = projectPoints([
      {
        recorded_at: "2026-08-04T13:05:00.000Z",
        latitude: 37.5407,
        longitude: -77.436,
        city: null,
        state: null,
      },
    ]);
    expect(projected).toHaveLength(1);
    expect(Number.isFinite(projected[0]?.x ?? NaN)).toBe(true);
    expect(Number.isFinite(projected[0]?.y ?? NaN)).toBe(true);
  });

  it("puts a NORTHERN point ABOVE a southern one (SVG y grows downward)", () => {
    const [north, south] = projectPoints([
      {
        recorded_at: "2026-08-04T13:05:00.000Z",
        latitude: 42,
        longitude: -74,
        city: null,
        state: null,
      },
      {
        recorded_at: "2026-08-04T09:05:00.000Z",
        latitude: 34,
        longitude: -74,
        city: null,
        state: null,
      },
    ]);
    expect((north?.y ?? 0) < (south?.y ?? 0)).toBe(true);
  });

  it("keeps every point inside the viewBox", () => {
    const projected = projectPoints(
      READINGS.filter(
        (r): r is LocationReading & { latitude: number; longitude: number } =>
          r.latitude !== null && r.longitude !== null,
      ).map((r) => ({
        recorded_at: r.recorded_at,
        latitude: r.latitude,
        longitude: r.longitude,
        city: r.city,
        state: r.state,
      })),
    );
    for (const p of projected) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(640);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(320);
    }
  });

  it("makes NO network request — the CSP is untouched for a reason", () => {
    // Comments are stripped first: this file ARGUES at length about tile
    // servers and third-party map scripts, and a naive substring scan would
    // fail on the prose that explains why none of them is used.
    const source = stripComments(
      readFileSync("src/components/tracking/ShipmentMap.tsx", "utf8"),
    ).toLowerCase();
    for (const forbidden of [
      "fetch(",
      "<img",
      "<iframe",
      "<script",
      "https://",
      "tile",
      "mapbox",
      "leaflet",
      "googlemaps",
    ]) {
      expect(source, `ShipmentMap references "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
    const config = readFileSync("next.config.ts", "utf8");
    // No map host was added: nothing needed one.
    expect(config).not.toContain("mapbox");
    expect(config).not.toContain("tile.openstreetmap");
  });
});

/* ================================================================== *
 * 7 · §23 — reduced motion
 * ================================================================== */

describe("§23 — reduced motion", () => {
  it("animates only inside a `prefers-reduced-motion: no-preference` query", () => {
    // Strip comments from the WHOLE file first — slicing into the middle of
    // the M-80 header comment would leave its prose (which discusses
    // animation) looking like code.
    const css = stripComments(readFileSync("src/app/v4.css", "utf8"));
    const block = css.slice(css.indexOf(".psh-mapslot{"));
    // The rule that animates the newest marker must be INSIDE the opt-in
    // query, so "reduce" is the default and cannot be forgotten.
    const query = block.indexOf("@media(prefers-reduced-motion:no-preference)");
    expect(query).toBeGreaterThan(-1);
    expect(block.indexOf("shipmap-pulse")).toBeGreaterThan(query);
    // And nothing outside it animates.
    expect(block.slice(0, query)).not.toContain("animation");
  });
});
