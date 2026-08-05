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
  { name: "375x812", width: 375, height: 812 }, // iPhone X/11/12 mini class
  { name: "390x844", width: 390, height: 844 }, // iPhone 12/13/14 class
  { name: "768x1024", width: 768, height: 1024 }, // tablet portrait
  { name: "1024x768", width: 1024, height: 768 }, // tablet landscape / small laptop
  { name: "1440x900", width: 1440, height: 900 }, // desktop
] as const;

/** Width at which v4.css swaps `.navlinks` for the `.menu-btn` drawer. */
const NAV_COLLAPSE_MAX = 960;

const HEX64 = "ab".repeat(32);

const ROUTES: { path: string; slug: string; group: string }[] = [
  // ── public site ──────────────────────────────────────────────────────────
  { path: "/", slug: "home", group: "public" },
  { path: "/about", slug: "about", group: "public" },
  { path: "/contact", slug: "contact", group: "public" },
  // M-73: §22's mobile tracking page — the timeline is the widest thing on
  // the public site and the most likely source of a reflow failure.
  { path: "/track", slug: "track", group: "public" },
  { path: "/faq", slug: "faq", group: "public" },
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
  "/portal/admin",
  "/portal/admin/users",
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
          expect(nav.items.length).toBeGreaterThanOrEqual(8);
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
