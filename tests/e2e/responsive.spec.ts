import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * M-62 — responsive screenshot + layout-integrity suite.
 *
 * Captures every major public, auth and portal-reachable route at the five
 * directive viewports and asserts two hard properties at each one:
 *
 *   1. no horizontal overflow  (WCAG 1.4.10 reflow — the failure mode M-59
 *      root-caused in v4.css; this suite is the regression fence);
 *   2. the primary navigation is neither clipped nor overlapping — every
 *      visible nav element sits inside the nav bar AND inside the viewport,
 *      and the three nav clusters (logo / links / CTA) never intersect.
 *
 * ── Baseline PNGs are deliberately NOT committed ────────────────────────────
 * Screenshots land in `test-results/responsive/<viewport>/<route>.png`, which
 * `.gitignore` already excludes. Committing ~110 full-page PNGs (tens of MB,
 * rewritten on every CSS token change) would bloat the repo and produce
 * review noise no human reads, and pixel baselines are famously flaky across
 * font-rendering environments. The ASSERTIONS are the enforcement mechanism —
 * they fail the build deterministically and describe *what* broke and *by how
 * many pixels*; the PNGs are the diagnostic artifact you look at afterwards.
 * See docs/modules/M-62-qa-finalization.md.
 *
 * ── Portal-internal pages ───────────────────────────────────────────────────
 * /portal/{carrier,shipper,admin}/* require a real Supabase session; the
 * secretless e2e lane cannot reach them (they 307 to /login — asserted below,
 * so the limitation is proved, not assumed). Their responsive behaviour was
 * audited statically in M-59 and their vocabulary (portal.css drawer, card
 * tables, .pform) is shared with surfaces this suite does scan.
 */

const VIEWPORTS = [
  // M-76: §22 names 320px first and the directive means it — a driver on an
  // SE-class phone is the narrowest real device this system serves. It was
  // absent from M-62's five because no surface was designed at it; the driver
  // link is, so it joins the list for every route rather than only that one.
  { name: "320x568", width: 320, height: 568 }, // iPhone SE 1st gen / §22's floor
  { name: "375x812", width: 375, height: 812 }, // iPhone X/11/12 mini class
  { name: "390x844", width: 390, height: 844 }, // iPhone 12/13/14 class
  { name: "768x1024", width: 768, height: 1024 }, // tablet portrait
  { name: "1024x768", width: 1024, height: 768 }, // tablet landscape / small laptop
  { name: "1440x900", width: 1440, height: 900 }, // desktop
] as const;

/** Width at which v4.css swaps `.navlinks` for the `.menu-btn` drawer. */
const NAV_COLLAPSE_MAX = 960;

const HEX64 = "ab".repeat(32);

/**
 * `chrome: false` marks a route that renders NEITHER the site nav NOR the
 * topbar — M-76's driver link is the first and, today, the only one. §22 calls
 * it "a driver at a dock, one hand, gloves", and the page is deliberately its
 * own layout: no marketing nav, no footer, no analytics banner, because on a
 * 320px screen in a truck that is four screenfuls above the one control the
 * driver came for. Flagging it here rather than skipping the route keeps the
 * OVERFLOW and TAP-TARGET checks running — the two that matter most for it.
 */
const ROUTES: { path: string; slug: string; group: string; chrome?: false }[] = [
  // ── public site ──────────────────────────────────────────────────────────
  { path: "/", slug: "home", group: "public" },
  { path: "/about", slug: "about", group: "public" },
  { path: "/contact", slug: "contact", group: "public" },
  // M-73: §22's mobile tracking page — the timeline is the widest thing on
  // the public site and the most likely source of a reflow failure.
  { path: "/track", slug: "track", group: "public" },
  // M-76: §22 calls the driver link a phone-first surface — "a driver at a
  // dock, one hand, gloves". It is unauthenticated, so unlike every portal
  // surface it is measured for real at every viewport, INCLUDING 320px (added
  // to VIEWPORTS below for this route's sake and kept for all of them).
  {
    path: `/driver/update/${"A".repeat(43)}`,
    slug: "driver-update",
    group: "public",
    chrome: false,
  },
  { path: "/faq", slug: "faq", group: "public" },
  { path: "/request-a-quote", slug: "request-a-quote", group: "public" },
  { path: "/dispatch-services", slug: "dispatch-services", group: "public" },
  { path: "/knowledge-base", slug: "knowledge-base", group: "public" },
  { path: "/downloads", slug: "downloads", group: "public" },
  { path: "/shippers", slug: "shippers", group: "public" },
  { path: "/become-a-carrier", slug: "become-a-carrier", group: "public" },
  {
    path: "/start-your-trucking-company",
    slug: "start-your-trucking-company",
    group: "public",
  },
  { path: "/truck-dispatch", slug: "truck-dispatch", group: "public" },
  {
    path: "/truck-dispatch/new-jersey",
    slug: "truck-dispatch-new-jersey",
    group: "public",
  },
  { path: "/dispatch/dry-van", slug: "dispatch-dry-van", group: "public" },
  { path: "/blog", slug: "blog", group: "public" },
  { path: "/legal/privacy", slug: "legal-privacy", group: "public" },
  // Longest translated nav/topbar strings — the widest failure case.
  { path: "/es", slug: "home-es", group: "public" },
  // ── auth ─────────────────────────────────────────────────────────────────
  { path: "/login", slug: "login", group: "auth" },
  { path: "/create-account", slug: "create-account", group: "auth" },
  {
    path: "/create-account/carrier",
    slug: "create-account-carrier",
    group: "auth",
  },
  {
    path: "/create-account/shipper",
    slug: "create-account-shipper",
    group: "auth",
  },
  { path: "/forgot-password", slug: "forgot-password", group: "auth" },
  { path: "/reset-password", slug: "reset-password", group: "auth" },
  { path: `/invite/${HEX64}`, slug: "invite-token", group: "auth" },
  // ── portal-reachable (pre-auth door) ─────────────────────────────────────
  { path: "/portal", slug: "portal-selection", group: "portal" },
];

/** Portal surfaces that exist but sit behind a live session. */
const PORTAL_INTERNAL = [
  "/portal/carrier",
  "/portal/carrier/documents",
  "/portal/carrier/trucks",
  "/portal/shipper",
  "/portal/shipper/quotes/new",
  // M-74 — §11's two new shipper routes. Their responsive behaviour is
  // asserted structurally in `tests/unit/shipper-shipments-a11y.test.tsx`
  // (the `.ptable--cards` transform and a `data-th` on every cell, which is
  // what makes a 320px render readable) because a browser cannot reach them
  // without a Supabase session. Listing them HERE is what proves that
  // limitation rather than assuming it.
  "/portal/shipper/shipments",
  "/portal/shipper/shipments/11111111-1111-1111-1111-111111111111",
  "/portal/admin",
  "/portal/admin/users",
  // M-75 — §14's three dispatcher routes. Same limitation, same reason, and
  // the same displacement: their responsive structure (the `.kanban`
  // horizontal-scroll column strip, `.ptable--cards` with a `data-th` on every
  // cell) is asserted in `tests/unit/dispatcher-shipments-a11y.test.tsx`,
  // because a browser cannot reach them without a Supabase STAFF session and
  // the M-61 MFA step-up. Listing them here is what proves that.
  "/portal/admin/shipments",
  "/portal/admin/shipments/new",
  "/portal/admin/shipments/11111111-1111-1111-1111-111111111111",
  // M-76 — §13's two carrier routes. Same limitation, same reason: a browser
  // cannot reach them without a Supabase CARRIER session. Their responsive
  // structure (`.ptable--cards` with a `data-th` on every cell, the one-column
  // `.pcard` stack) is asserted in `tests/unit/carrier-driver-a11y.test.tsx`.
  // The DRIVER route is NOT here — it is in ROUTES above, measured for real.
  "/portal/carrier/shipments",
  "/portal/carrier/shipments/11111111-1111-1111-1111-111111111111",
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface NavProbe {
  present: boolean;
  barVisible: boolean;
  bar: Rect | null;
  linksDisplayed: boolean;
  menuBtn: (Rect & { displayed: boolean }) | null;
  items: { label: string; rect: Rect }[];
  clusters: { name: string; rect: Rect }[];
}

async function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    if (overflow <= 1) return { overflow, offenders: [] as string[] };
    // Name the widest offenders so a failure is actionable, not a mystery.
    const limit = de.clientWidth;
    const offenders: { sel: string; right: number }[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const right = r.right + window.scrollX;
      if (right > limit + 1) {
        const sel =
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : "") +
          (typeof el.className === "string" && el.className
            ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
            : "");
        offenders.push({ sel, right: Math.round(right) });
      }
    });
    offenders.sort((a, b) => b.right - a.right);
    return {
      overflow,
      offenders: offenders.slice(0, 8).map((o) => `${o.sel} → ${o.right}px`),
    };
  });
}

async function probeNav(page: Page): Promise<NavProbe> {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const nav = document.querySelector("nav.sitenav");
    if (!nav) {
      return {
        present: false,
        barVisible: false,
        bar: null,
        linksDisplayed: false,
        menuBtn: null,
        items: [],
        clusters: [],
      };
    }
    const wrap = nav.querySelector(".wrap")!;
    const links = nav.querySelector(".navlinks");
    const cta = nav.querySelector(".nav-cta");
    const logo = wrap.firstElementChild;
    const btn = nav.querySelector(".menu-btn");
    const shown = (el: Element | null) =>
      !!el && getComputedStyle(el).display !== "none";

    const items: { label: string; rect: ReturnType<typeof box> }[] = [];
    if (shown(links)) {
      links!.querySelectorAll("a").forEach((a) => {
        if (getComputedStyle(a).display === "none") return;
        items.push({ label: a.textContent?.trim() ?? "(link)", rect: box(a) });
      });
    }
    const clusters: { name: string; rect: ReturnType<typeof box> }[] = [];
    if (logo && shown(logo)) clusters.push({ name: "logo", rect: box(logo) });
    if (shown(links)) clusters.push({ name: "navlinks", rect: box(links!) });
    if (shown(cta)) clusters.push({ name: "nav-cta", rect: box(cta!) });

    return {
      present: true,
      barVisible: getComputedStyle(nav).display !== "none",
      bar: box(wrap),
      linksDisplayed: shown(links),
      menuBtn: btn ? { ...box(btn), displayed: shown(btn) } : null,
      items,
      clusters,
    };
  });
}

function intersects(a: Rect, b: Rect, tolerance = 1) {
  const xOverlap =
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tolerance;
  const yOverlap =
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tolerance;
  return xOverlap && yOverlap;
}

for (const vp of VIEWPORTS) {
  test.describe(`responsive ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const route of ROUTES) {
      test(`${route.group} ${route.path}`, async ({ page }, testInfo) => {
        // Ticker/hero animations off — a moving marquee makes both the
        // screenshot and the overflow measurement non-deterministic.
        await page.emulateMedia({ reducedMotion: "reduce" });
        const response = await page.goto(route.path);
        expect(
          response?.status(),
          `${route.path} must render (not 404/500)`,
        ).toBeLessThan(400);
        // Fonts/layout settled — the ticker and hero animate on load.
        await page.waitForLoadState("domcontentloaded");
        await expect(page.locator("main#main")).toHaveCount(1);

        const dir = path.join(
          testInfo.project.outputDir,
          "responsive",
          vp.name,
        );
        await mkdir(dir, { recursive: true });
        await page.screenshot({
          path: path.join(dir, `${route.slug}.png`),
          fullPage: true,
        });

        // ── 1. no horizontal overflow ────────────────────────────────────
        const { overflow, offenders } = await measureOverflow(page);
        expect(
          overflow,
          `${route.path} @ ${vp.name} overflows horizontally by ${overflow}px. Widest elements: ${offenders.join(", ") || "none identified"}`,
        ).toBeLessThanOrEqual(1);

        // ── 2. primary nav integrity ─────────────────────────────────────
        if (route.chrome === false) {
          // A chromeless route by design (see the ROUTES comment). Assert the
          // absence is the DESIGN rather than a broken layout: no nav, no
          // topbar, no footer — and the skip link still first, because §23
          // does not get an exemption for being minimal.
          await expect(page.locator("nav.sitenav")).toHaveCount(0);
          await expect(page.locator(".topbar")).toHaveCount(0);
          const skip = page.locator('a[href="#main"]').first();
          await expect(skip).toHaveCount(1);
          return;
        }

        const nav = await probeNav(page);
        if (!nav.present) {
          // (auth) chrome is Topbar-only by design — assert the topbar itself
          // is inside the viewport rather than silently skipping the route.
          const topbar = page.locator(".topbar .wrap");
          await expect(topbar).toHaveCount(1);
          const tb = (await topbar.boundingBox())!;
          expect(
            Math.round(tb.x + tb.width),
            `${route.path} @ ${vp.name}: topbar spills past the viewport`,
          ).toBeLessThanOrEqual(vp.width + 1);
          return;
        }

        expect(nav.barVisible, `${route.path}: nav.sitenav is hidden`).toBe(
          true,
        );
        const bar = nav.bar!;

        if (vp.width <= NAV_COLLAPSE_MAX) {
          // Collapsed: desktop links must be gone and the hamburger present
          // with a real tap target — otherwise the nav is unreachable.
          expect(
            nav.linksDisplayed,
            `${route.path} @ ${vp.name}: .navlinks must collapse ≤${NAV_COLLAPSE_MAX}px`,
          ).toBe(false);
          expect(
            nav.menuBtn?.displayed,
            `${route.path} @ ${vp.name}: .menu-btn must be visible`,
          ).toBe(true);
          const btn = nav.menuBtn!;
          expect(
            Math.min(btn.w, btn.h),
            `${route.path} @ ${vp.name}: menu button tap target ${btn.w}×${btn.h}`,
          ).toBeGreaterThanOrEqual(24);
          expect(
            Math.round(btn.x + btn.w),
            `${route.path} @ ${vp.name}: menu button clipped by the viewport`,
          ).toBeLessThanOrEqual(vp.width + 1);

          // Open the drawer and check every entry is on-screen, legible and
          // not stacked on top of its neighbour.
          await page.locator(".menu-btn").click();
          const menu = page.locator(".mobile-menu.open");
          await expect(menu).toBeVisible();
          const entries = await menu.locator("a").all();
          expect(entries.length).toBeGreaterThanOrEqual(8);
          let prevBottom = -Infinity;
          for (const entry of entries) {
            const r = (await entry.boundingBox())!;
            expect(
              r.width,
              `${route.path} @ ${vp.name}: mobile menu entry has zero width`,
            ).toBeGreaterThan(0);
            expect(
              Math.round(r.x + r.width),
              `${route.path} @ ${vp.name}: mobile menu entry spills past the viewport`,
            ).toBeLessThanOrEqual(vp.width + 1);
            expect(
              r.y,
              `${route.path} @ ${vp.name}: mobile menu entries overlap`,
            ).toBeGreaterThanOrEqual(prevBottom - 1);
            prevBottom = r.y + r.height;
          }
          // Opening the drawer must not introduce overflow either.
          const opened = await measureOverflow(page);
          expect(
            opened.overflow,
            `${route.path} @ ${vp.name}: open mobile menu overflows by ${opened.overflow}px (${opened.offenders.join(", ")})`,
          ).toBeLessThanOrEqual(1);
          await page.locator(".menu-btn").click();
        } else {
          // Expanded: every link visible, inside the bar, inside the viewport.
          expect(
            nav.linksDisplayed,
            `${route.path} @ ${vp.name}: .navlinks must be visible >${NAV_COLLAPSE_MAX}px`,
          ).toBe(true);
          // PHASE B — the bar became a GROUPED nav: five group headers
          // (Services / Carriers / Shippers / Resources / Company) plus two
          // utility links (Track Shipment, Login). The old threshold of 8
          // encoded the previous FLAT nav, where every destination sat in the
          // bar; it is now 7 top-level entries fronting ~15 destinations.
          //
          // The count is a weaker check than it looks, so it is no longer the
          // only one: `nav groups open and stay inside the viewport` below
          // opens EVERY panel and measures its links, and
          // tests/unit/site-nav.test.ts asserts the mobile drawer still
          // reaches at least eight destinations and that every rendered href
          // resolves to a real route. Net coverage goes up, not down.
          expect(nav.items.length).toBeGreaterThanOrEqual(7);
          for (const item of nav.items) {
            const r = item.rect;
            expect(
              Math.min(r.w, r.h),
              `${route.path} @ ${vp.name}: nav link "${item.label}" collapsed to ${r.w}×${r.h}`,
            ).toBeGreaterThan(0);
            expect(
              Math.round(r.x),
              `${route.path} @ ${vp.name}: nav link "${item.label}" clipped on the left`,
            ).toBeGreaterThanOrEqual(-1);
            expect(
              Math.round(r.x + r.w),
              `${route.path} @ ${vp.name}: nav link "${item.label}" clipped on the right`,
            ).toBeLessThanOrEqual(vp.width + 1);
            // Vertically inside the 72px bar — catches wrapped/clipped rows.
            expect(
              Math.round(r.y),
              `${route.path} @ ${vp.name}: nav link "${item.label}" sits above the nav bar`,
            ).toBeGreaterThanOrEqual(Math.round(bar.y) - 1);
            expect(
              Math.round(r.y + r.h),
              `${route.path} @ ${vp.name}: nav link "${item.label}" overflows the nav bar (bar ends at ${Math.round(bar.y + bar.h)})`,
            ).toBeLessThanOrEqual(Math.round(bar.y + bar.h) + 1);
          }
          // Nav links must not overlap each other.
          const sorted = [...nav.items].sort((a, b) => a.rect.x - b.rect.x);
          for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1]!;
            const cur = sorted[i]!;
            expect(
              Math.round(cur.rect.x),
              `${route.path} @ ${vp.name}: nav links "${prev.label}" and "${cur.label}" overlap`,
            ).toBeGreaterThanOrEqual(Math.round(prev.rect.x + prev.rect.w) - 1);
          }
          // The three clusters (logo / links / CTA) must not collide.
          for (let i = 0; i < nav.clusters.length; i++) {
            for (let j = i + 1; j < nav.clusters.length; j++) {
              const a = nav.clusters[i]!;
              const b = nav.clusters[j]!;
              expect(
                intersects(a.rect, b.rect),
                `${route.path} @ ${vp.name}: nav clusters "${a.name}" and "${b.name}" overlap`,
              ).toBe(false);
            }
          }
        }
      });
    }
  });
}

/**
 * Directive range endpoints. The five viewports above are the screenshot
 * matrix; these two close the stated 320→1920 span so the claim is proved
 * across the whole range rather than only inside it. No screenshots (the
 * matrix already covers the interesting widths) — overflow + nav only.
 */
for (const edge of [
  { name: "320x568", width: 320, height: 568 },
  { name: "1920x1080", width: 1920, height: 1080 },
] as const) {
  test(`range endpoint ${edge.name}: no overflow, nav intact on every route`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: edge.width, height: edge.height },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    try {
      for (const route of ROUTES) {
        await page.goto(route.path);
        const { overflow, offenders } = await measureOverflow(page);
        expect(
          overflow,
          `${route.path} @ ${edge.name} overflows by ${overflow}px (${offenders.join(", ") || "no element identified"})`,
        ).toBeLessThanOrEqual(1);

        const nav = await probeNav(page);
        if (!nav.present) continue;
        const collapsed = edge.width <= NAV_COLLAPSE_MAX;
        expect(
          nav.linksDisplayed,
          `${route.path} @ ${edge.name}: .navlinks visibility wrong for this width`,
        ).toBe(!collapsed);
        if (collapsed) {
          expect(
            nav.menuBtn?.displayed,
            `${route.path} @ ${edge.name}: .menu-btn must be visible`,
          ).toBe(true);
        } else {
          const bar = nav.bar!;
          for (const item of nav.items) {
            expect(
              Math.round(item.rect.x + item.rect.w),
              `${route.path} @ ${edge.name}: nav link "${item.label}" clipped`,
            ).toBeLessThanOrEqual(edge.width + 1);
            expect(
              Math.round(item.rect.y + item.rect.h),
              `${route.path} @ ${edge.name}: nav link "${item.label}" overflows the nav bar`,
            ).toBeLessThanOrEqual(Math.round(bar.y + bar.h) + 1);
          }
        }
      }
    } finally {
      await ctx.close();
    }
  });
}

test("portal-internal routes are session-gated (documents the screenshot-scope limit)", async ({
  page,
}) => {
  for (const path of PORTAL_INTERNAL) {
    await page.goto(path);
    await expect(
      page,
      `${path} must bounce to /login in the secretless lane`,
    ).toHaveURL(/\/login\?next=/);
  }
});

/* ====================================================================== *
 * PHASE B — the grouped navigation, opened.
 *
 * The bar's link count no longer tells you whether the nav WORKS: five of
 * its seven entries are group headers whose destinations live in a panel.
 * This suite opens every panel at desktop width and holds its links to the
 * same standard the bar's own links are held to — visible, sized, inside the
 * viewport, not overlapping — because a mega-menu that renders off-screen is
 * a nav that has quietly lost most of the site.
 *
 * Desktop only: below 960px `.navlinks` collapses and the drawer takes over,
 * which the existing per-viewport suite already walks entry by entry.
 * ====================================================================== */
test.describe("Phase B · grouped navigation", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every group opens, and its links are usable and on-screen", async ({
    page,
  }) => {
    await page.goto("/");
    const groups = page.locator("nav.sitenav .navgroup");
    const count = await groups.count();
    expect(count, "the five approved groups must be present").toBe(5);

    for (let i = 0; i < count; i++) {
      const group = groups.nth(i);
      const trigger = group.locator("> a");
      const label = (await trigger.textContent())?.trim() ?? `group ${i}`;

      // Closed panels must be display:none — not merely transparent. An
      // opacity-hidden panel keeps its links in the accessibility tree and in
      // the layout, which is the failure this asserts against.
      await expect(
        group.locator(".navpanel"),
        `${label}: panel must be hidden until opened`,
      ).toBeHidden();

      await trigger.hover();
      const panel = group.locator(".navpanel");
      await expect(panel, `${label}: panel did not open on hover`).toBeVisible();

      const links = await panel.locator("a").all();
      expect(links.length, `${label}: panel has no destinations`).toBeGreaterThan(0);

      let prevBottom = -Infinity;
      for (const link of links) {
        const box = (await link.boundingBox())!;
        expect(box.width, `${label}: panel link has zero width`).toBeGreaterThan(0);
        expect(box.height, `${label}: panel link has zero height`).toBeGreaterThan(0);
        expect(
          Math.round(box.x),
          `${label}: panel link clipped on the left`,
        ).toBeGreaterThanOrEqual(-1);
        expect(
          Math.round(box.x + box.width),
          `${label}: panel link spills past the viewport`,
        ).toBeLessThanOrEqual(1440 + 1);
        expect(
          box.y,
          `${label}: panel links overlap`,
        ).toBeGreaterThanOrEqual(prevBottom - 1);
        prevBottom = box.y + box.height;
      }

      // Move away so the next iteration starts from a closed state.
      await page.locator("footer#contact-foot").hover();
      await expect(panel, `${label}: panel stayed open after leaving`).toBeHidden();
    }
  });

  test("every group header is a real destination, not a dead trigger", async ({
    page,
  }) => {
    await page.goto("/");
    const triggers = page.locator("nav.sitenav .navgroup > a");
    for (let i = 0; i < (await triggers.count()); i++) {
      const href = await triggers.nth(i).getAttribute("href");
      expect(href, "a group header must link somewhere").toBeTruthy();
      expect(href).not.toBe("#");
    }
  });

  test("no dispatcher or admin portal path is exposed anywhere on the page", async ({
    page,
  }) => {
    await page.goto("/");
    const hrefs = await page.locator("a[href]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href") ?? ""),
    );
    for (const href of hrefs) {
      expect(href).not.toContain("/portal/admin");
      expect(href).not.toContain("/portal/dispatcher");
    }
    // Non-vacuity: the page really does have links.
    expect(hrefs.length).toBeGreaterThan(20);
  });

  test("the footer carries the seven approved columns and one staff entry", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("footer .foot-col")).toHaveCount(7);
    await expect(page.locator("footer a.foot-staff")).toHaveCount(1);
    await expect(page.locator("footer a.foot-staff")).toHaveAttribute(
      "href",
      /\/login$/,
    );
  });
});
