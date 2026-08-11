import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * M-80 — §9's map slot, §25's lazy loading and §23's accessible alternative,
 * in a real browser against the production build.
 *
 * ── WHAT THIS LANE CAN AND CANNOT REACH, STATED UP FRONT ─────────────────
 *
 * The location panel renders on three surfaces: `/track` (after a real
 * two-factor lookup), the shipper shipment detail page and the dispatcher
 * one. All three need either a shipment in a database or a Supabase session,
 * and this lane runs `next start` on PLACEHOLDER credentials by design
 * (M-41). Seeding a shipment carrying a fabricated GPS fix so a browser could
 * screenshot the map is precisely what §30 forbids, in the same sentence as
 * fake ETAs.
 *
 * So the split is:
 *
 *   * HERE — the things only a browser and a build can show: the map is a
 *     SEPARATE CHUNK that no page pulls in; no page requests a third-party
 *     map script or a map tile; the shipped CSP names no map host; the
 *     surfaces that host the panel are session-gated; and `/track` stays
 *     axe-clean and overflow-free at 320 / 768 / 1280.
 *   * `tests/unit/shipment-map-a11y.test.tsx` — the panel itself, rendered
 *     and axe-scanned in all four privacy levels, the empty state, the failed
 *     state and the map-mounted state.
 *   * `tests/integration/shipment-locations.test.ts` — the data those states
 *     are built from, against a real PostgreSQL 16.
 *
 * Writing that down is the point: a green e2e file that quietly skipped the
 * middle would be the vacuous kind of green.
 */

const CHUNK_DIR = ".next/static/chunks";

/** Every built client chunk, as `[relative path, contents]`. */
function allChunks(dir = CHUNK_DIR, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...allChunks(full, rel));
    else if (entry.name.endsWith(".js")) out.push([rel, readFileSync(full, "utf8")]);
  }
  return out;
}

/* ================================================================== *
 * 1 · §25 — "map scripts lazy-loaded"
 * ================================================================== */

test("the map is its OWN chunk, and no page chunk contains it", () => {
  const chunks = allChunks();
  // `.shipmap-path` is the map's polyline class and appears nowhere else in
  // the product — a reliable fingerprint for "the map component is in here".
  const mapChunks = chunks.filter(([, body]) => body.includes("shipmap-path"));
  expect(
    mapChunks.length,
    "the map must be compiled into at least one chunk",
  ).toBeGreaterThan(0);

  for (const [name] of mapChunks) {
    // Not a route entry point, and not one of the shared first-load chunks.
    expect(
      name.startsWith("app/"),
      `the map is inside the ROUTE chunk ${name} — next/dynamic did not split it`,
    ).toBe(false);
    expect(name).not.toContain("main-app");
    expect(name).not.toContain("webpack");
  }

  // NON-VACUITY: the PANEL (which is eagerly rendered) IS in route chunks, so
  // the assertion above is about the dynamic boundary and not about a
  // fingerprint that never matches anything.
  const panelChunks = chunks.filter(([, body]) => body.includes("shipmap-alt"));
  expect(panelChunks.some(([name]) => name.startsWith("app/"))).toBe(true);
});

test("no public page requests a map script, a tile or any third-party map host", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  test.setTimeout(60_000);
  for (const path of ["/", "/track", "/shippers", "/faq"]) {
    await page.goto(path, { waitUntil: "networkidle" });
  }

  const forbidden = [
    "maps.googleapis.com",
    "maps.gstatic.com",
    "api.mapbox.com",
    "tile.openstreetmap.org",
    "unpkg.com/leaflet",
    "cdn.jsdelivr.net/npm/leaflet",
  ];
  for (const host of forbidden) {
    expect(
      requested.filter((url) => url.includes(host)),
      `a public page requested ${host}`,
    ).toEqual([]);
  }

  // And the map chunk itself is never fetched: no public page has a shipment
  // with a disclosed coordinate, so `mapMayMount` is false everywhere.
  const mapChunkNames = allChunks()
    .filter(([, body]) => body.includes("shipmap-path"))
    .map(([name]) => name.split("/").pop() ?? "");
  for (const chunk of mapChunkNames) {
    expect(
      requested.filter((url) => url.endsWith(chunk)),
      `the lazy map chunk ${chunk} was fetched on a public page`,
    ).toEqual([]);
  }
});

/* ================================================================== *
 * 2 · The CSP was updated for exactly what was needed: nothing
 * ================================================================== */

test("the shipped CSP names no map vendor — because the map makes no request", async ({
  request,
}) => {
  const response = await request.get("/track");
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp.length).toBeGreaterThan(50);
  expect(csp).toContain("default-src 'self'");
  for (const host of [
    "api.mapbox.com",
    "tile.openstreetmap.org",
    "unpkg.com",
    "*.tile.",
  ]) {
    expect(csp, `the CSP was widened for ${host}`).not.toContain(host);
  }
  // NON-VACUITY: the CSP DOES name the third parties the product actually
  // uses, so the absences above are decisions rather than an empty header.
  expect(csp).toContain("challenges.cloudflare.com");
});

/* ================================================================== *
 * 3 · The surfaces that host the panel are session-gated
 * ================================================================== */

test("the two portal surfaces hosting the location panel are session-gated", async ({
  page,
}) => {
  for (const path of [
    "/portal/shipper/shipments/11111111-1111-1111-1111-111111111111",
    "/portal/admin/shipments/11111111-1111-1111-1111-111111111111",
  ]) {
    await page.goto(path);
    await expect(page, `${path} must bounce to /login`).toHaveURL(
      /\/login\?next=/,
    );
  }
});

/* ================================================================== *
 * 4 · §23 / §22 on the one public surface that hosts it
 * ================================================================== */

test("/track has no axe violations and no horizontal overflow at 320, 768 and 1280", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  // Three full scans in one test; `networkidle` would spend the budget waiting
  // on the Turnstile iframe rather than on anything this test measures.
  test.setTimeout(60_000);

  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/track");
    await expect(page.locator("main#main h1")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.help}`),
      `axe violations at ${width}px`,
    ).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});

/* ================================================================== *
 * 5 · §30 — the public surface still makes no live-tracking claim
 * ================================================================== */

test("/track claims no live tracking, no AI and no real-time prediction", async ({
  page,
}) => {
  await page.goto("/track");
  const text = ((await page.locator("main#main").textContent()) ?? "")
    .toLowerCase();
  for (const claim of [
    "live tracking",
    "real-time",
    "ai-powered",
    "artificial intelligence",
    "machine learning",
    "gps tracking",
  ]) {
    expect(text, `/track claims "${claim}"`).not.toContain(claim);
  }
});
