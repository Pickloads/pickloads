import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * M-59 — automated WCAG 2.2 AA scans (axe-core) over the major public +
 * auth surfaces, plus the pre-auth /portal selection page.
 *
 * Portal-internal pages (carrier/shipper/admin) sit behind a real Supabase
 * session and cannot be scanned in the secretless e2e lane; their markup
 * shares the same audited vocabulary (portal.css + the components scanned
 * here) and the manual audit is documented in docs/modules/M-59.
 *
 * Scope: wcag2a/wcag2aa/wcag21a/wcag21aa/wcag22aa tags. The V4 palette's
 * two known AA contrast exceptions are token-level decisions (Q7,
 * docs/modules/M-00) — anything newly reported fails the build.
 */

const PAGES = [
  "/",
  "/about",
  "/contact",
  "/faq",
  /* M-73: the public tracking LOOKUP page. The RESULT view cannot be scanned
   * here — a live result needs a shipment in a database and this lane runs on
   * placeholder credentials by design — so it is scanned with the same
   * axe-core engine against the same component in
   * tests/unit/tracking-result-a11y.test.tsx, which explains the split. */
  "/track",
  /* M-76: the DRIVER update link. Unlike every other tracking surface this is
   * unauthenticated, so the real page is scanned in a real browser — which is
   * what makes its colour contrast (jsdom cannot see it) covered. What renders
   * here is the honest refusal card, because a token cannot be redeemed
   * without a database; the GRANTED state is scanned with the same axe-core
   * engine in tests/unit/carrier-driver-a11y.test.tsx. 43 "A"s is the exact
   * shape of a real token. */
  `/driver/update/${"A".repeat(43)}`,
  "/request-a-quote",
  "/dispatch-services",
  "/knowledge-base",
  "/downloads",
  "/carrier-resources",
  "/careers",
  "/partners",
  "/login-center",
  "/search",
  "/shippers",
  "/become-a-carrier",
  "/start-your-trucking-company",
  "/truck-dispatch",
  "/dispatch/dry-van",
  "/blog",
  "/login",
  "/create-account",
  "/create-account/carrier",
  "/create-account/shipper",
  "/forgot-password",
  "/portal",
];

/*
 * M-74 — `/portal/shipper/shipments` and its `[shipmentId]` detail are NOT in
 * the list above, for the same reason the note at the top of this file gives:
 * they sit behind a Supabase session this lane cannot mint. They are scanned
 * with the SAME axe-core engine, in nine states and three locales, against the
 * same components the routes render, in
 * `tests/unit/shipper-shipments-a11y.test.tsx` — and
 * `tests/e2e/shipper-shipments.spec.ts` asserts the session gate, so the
 * split is proved rather than assumed.
 *
 * M-75 — `/portal/admin/shipments`, its `new` and `[shipmentId]` routes are
 * absent for the same reason and are covered the same way: they sit behind a
 * staff session AND the M-61 MFA step-up, they are axe-scanned in seven states
 * in `tests/unit/dispatcher-shipments-a11y.test.tsx` (board, scoped board,
 * expanded column, failed column, full detail, dispatcher detail, terminal
 * detail), and `tests/e2e/dispatcher-shipments.spec.ts` asserts the gate.
 *
 * M-76 — `/portal/carrier/shipments` and its `[shipmentId]` detail are absent
 * for the same reason (a carrier session this lane cannot mint) and are
 * covered the same way: eight axe states in
 * `tests/unit/carrier-driver-a11y.test.tsx`, with the session gate asserted in
 * `tests/e2e/carrier-driver-updates.spec.ts`. The DRIVER page is in the list
 * above precisely because it needs no session — that is the point of it.
 */

for (const path of PAGES) {
  test(`axe: ${path} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}

/* ==========================================================================
 * M-82 — the tracking routes in the STATES that matter, not only at rest.
 *
 * The list above scans `/track` and `/driver/update/[token]` as they first
 * paint. §23 is not a property of a first paint: an error message, an empty
 * result and an expired token are the moments a customer most needs the page
 * to be readable, and each renders markup the resting page does not have.
 *
 * ── WHAT IS SCANNED WHERE, AND WHY THE SPLIT ─────────────────────────────
 *
 *   * HERE, in a real browser: every state a route can reach with no session
 *     and no database — the lookup form in five locales, its ERROR state
 *     (driven by a real submit, not simulated), and the driver link's
 *     EXPIRED-TOKEN refusal, which is what a token that cannot be redeemed
 *     honestly produces in this lane.
 *   * In `tests/e2e/tracking-responsive-a11y.spec.ts`: the 27 session-gated
 *     surface states (populated, empty, filtered-empty, failed, exception,
 *     cancelled, delayed, degraded, terminal, no-actions, map-mounted,
 *     text-only …), scanned with the same axe engine at 320/768/1440 against
 *     the real compiled stylesheets, from the DOM the real components emit.
 *
 * Neither half is a claim about the other. `responsive.spec.ts` asserts the
 * session gate that makes the split necessary.
 * ======================================================================== */

const LOCALES = ["en", "es", "fr", "ht", "ru"] as const;

for (const locale of LOCALES) {
  const path = locale === "en" ? "/track" : `/${locale}/track`;
  test(`axe: ${path} (§24 locale) has no WCAG A/AA violations`, async ({
    page,
  }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}

test("axe: /track ERROR state (§23 accessible error states)", async ({
  page,
}) => {
  await page.goto("/track");
  await page.fill("#tk-number", "PL-2026-000000");
  await page.fill("#tk-secondary", "00000");
  await page.click('#track-form button[type="submit"]');
  // The alert region is always in the DOM (M-73 built it that way on purpose);
  // `.show` is what makes it visible. Requiring VISIBILITY is what stops this
  // test from passing on a submit that silently did nothing.
  const err = page.locator("#tk-err.show");
  await expect(err, "the lookup produced no error state to scan").toBeVisible();
  await expect(err).not.toBeEmpty();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
});

test("axe: expired driver token, in five locales (§13 refusal card)", async ({
  page,
}) => {
  for (const locale of LOCALES) {
    const prefix = locale === "en" ? "" : `/${locale}`;
    await page.goto(`${prefix}/driver/update/${"A".repeat(43)}`);
    // A token that cannot be redeemed renders the refusal, and the refusal is
    // an ALERT — a driver at a dock must be told, not left to notice.
    await expect(page.locator('[role="alert"]').first()).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
    expect(summary, `${locale}: ${JSON.stringify(summary, null, 2)}`).toEqual(
      [],
    );
  }
});

test("skip link is the first focusable element and targets #main", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const active = page.locator(":focus");
  await expect(active).toHaveClass("skip-link");
  await expect(active).toHaveAttribute("href", "#main");
  await expect(page.locator("main#main")).toHaveCount(1);
});

test("no horizontal overflow at 320px on key public pages", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 800 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  for (const path of ["/", "/about", "/contact", "/shippers", "/login", "/track"]) {
    await page.goto(path);
    const over = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(over, `${path} overflows horizontally by ${over}px`).toBeLessThanOrEqual(1);
  }
  await ctx.close();
});

/**
 * The homepage at 320px, with the intrinsic sizing measured rather than the
 * symptom.
 *
 * ── WHY THIS EXISTS ALONGSIDE THE SCAN ABOVE ─────────────────────────────
 *
 * A `scrollWidth > clientWidth` assertion only fires once the page is ALREADY
 * broken, and it took three separate investigations to attribute the last
 * failure because the symptom is 7px on `<html>` and says nothing about which
 * element caused it.
 *
 * The cause was a grid track that could not shrink: `.stats` is a 2x2 tile
 * grid down to the smallest supported width, a grid track cannot go below its
 * content's min-content width, and the owner-decision copy pass replaced
 * "Flat dispatch fee" with "Owner-operator dispatch fee". One long word set a
 * floor of 284.6px against 272px of available space.
 *
 * So this measures the thing that actually has to hold — the track fits the
 * space — and it fails with a number that points straight at the component.
 */
test("homepage @320: no page overflow, and the stat grid still fits its track", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 568 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.evaluate(() => document.fonts?.ready);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const grid = document.querySelector(".why-grid") as HTMLElement | null;
    const stats = document.querySelector(".stats") as HTMLElement | null;

    // min-content width, measured the way the grid algorithm sees it.
    const minContent = (el: HTMLElement) => {
      const host = document.createElement("div");
      host.style.cssText =
        "position:absolute;left:-99999px;top:0;width:min-content;";
      host.appendChild(el.cloneNode(true));
      document.body.appendChild(host);
      const w = host.getBoundingClientRect().width;
      host.remove();
      return w;
    };

    const cs = grid ? getComputedStyle(grid) : null;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      available: cs
        ? de.clientWidth -
          parseFloat(cs.paddingLeft) -
          parseFloat(cs.paddingRight)
        : null,
      statsMinContent: stats ? minContent(stats) : null,
    };
  });

  // The property the directive names, stated exactly.
  expect(
    m.scrollWidth,
    `homepage @320 overflows by ${m.scrollWidth - m.clientWidth}px`,
  ).toBeLessThanOrEqual(m.clientWidth);

  // And the cause, so a regression is named rather than hunted.
  expect(m.statsMinContent, ".stats min-content not measurable").not.toBeNull();
  expect(
    m.statsMinContent!,
    `.stats needs ${Math.round(m.statsMinContent!)}px but the .why-grid track ` +
      `only has ${m.available}px at 320px — a long word in a stat tile is ` +
      `setting the floor. Let it wrap (overflow-wrap:anywhere) rather than ` +
      `widening the page or shortening approved copy.`,
  ).toBeLessThanOrEqual(m.available!);

  await ctx.close();
});
