import { expect, test } from "@playwright/test";

/**
 * PWA — installability, and the caching that deliberately does not exist.
 *
 * ── WHY THE SERVER STRATEGY MATTERS TO THIS FILE ─────────────────────────
 *
 * These tests were written twice. The first attempt failed for hours against a
 * stale dev server that Playwright silently attached to (`reuseExistingServer`
 * was `true`), which made correct code look broken and led to a revert. The
 * config now sets `reuseExistingServer: false`, so an occupied port fails the
 * run loudly instead of testing yesterday's build. If this file ever fails in a
 * way that makes no sense, check that first.
 */

test.describe("PWA — manifest", () => {
  test("serves at the ROOT url with the right content type", async ({
    request,
  }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    // Not application/json: the manifest MIME type is what tells the browser
    // this is installable metadata.
    expect(res.headers()["content-type"]).toContain("manifest+json");
  });

  test("is referenced at the ROOT path, with no locale segment", async ({
    page,
  }) => {
    // The next-intl middleware rewrites unmatched paths to /[locale]/… . The
    // manifest is excluded from that matcher alongside robots.txt and
    // sitemap.xml; without the exclusion the root URL 404s and installation
    // fails silently while every page still renders fine.
    //
    // What matters is that the href every page ships is the root one — an
    // installed app has ONE identity, not five. (A locale-prefixed URL also
    // resolving is harmless and is not asserted either way: that is a Next
    // routing detail, not a requirement.)
    await page.goto("/es");
    const href = await page
      .locator('link[rel="manifest"]')
      .getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");
    expect(href).not.toMatch(/^\/(en|es|fr|ru|ht)\//);
  });

  test("carries the PickLoads identity", async ({ request }) => {
    const m = (await (await request.get("/manifest.webmanifest")).json()) as
      Record<string, unknown>;
    expect(m.name).toBe("PickLoads Logistics Group");
    expect(m.short_name).toBe("PickLoads");
    expect(m.display).toBe("standalone");
    expect(m.theme_color).toBe("#12161a");
    expect(m.background_color).toBe("#12161a");
    expect(m.scope).toBe("/");
  });

  test("start_url is PUBLIC — an installed app must not open on the auth wall", async ({
    request,
  }) => {
    const m = (await (await request.get("/manifest.webmanifest")).json()) as {
      start_url: string;
    };
    expect(m.start_url).toBe("/");
    expect(m.start_url).not.toMatch(/\/portal|\/login|\/driver/);
  });

  test("declares no icon it cannot serve", async ({ request }) => {
    const m = (await (await request.get("/manifest.webmanifest")).json()) as {
      icons?: Array<{ src: string }>;
    };
    // No approved PickLoads raster artwork exists yet, so no icons array is
    // declared. If one is ever added, every entry must resolve — a manifest
    // pointing at 404s fails installation and shows a broken tile.
    for (const icon of m.icons ?? []) {
      const res = await request.get(icon.src);
      expect(res.status(), `manifest icon ${icon.src} is missing`).toBe(200);
    }
  });

  test("every page links it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  });
});

test.describe("PWA — no offline store for freight data", () => {
  test("registers NO service worker", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(800);
    const count = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return 0;
      return (await navigator.serviceWorker.getRegistrations()).length;
    });
    // Every screen worth caching on this platform is one that must not be
    // cached. If this ever becomes non-zero, audit the allow-list before
    // anything else ships.
    expect(count).toBe(0);
  });

  test("serves no service-worker file at the usual paths", async ({
    request,
  }) => {
    for (const path of ["/sw.js", "/service-worker.js", "/workbox-sw.js"]) {
      const res = await request.get(path);
      expect(res.status(), `${path} is being served`).toBeGreaterThanOrEqual(400);
    }
  });

  test("no cache storage is populated on a public visit", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);
    const keys = await page.evaluate(async () =>
      "caches" in window ? await caches.keys() : [],
    );
    expect(keys).toEqual([]);
  });
});

test.describe("PWA — no metadata regression", () => {
  test("the noindex on a credential URL stays in <head>", async ({ page }) => {
    // Adding `manifest` to the layout metadata is exactly the kind of change
    // that can push page metadata out of <head> into <body> in the streamed
    // HTML. A noindex that arrives in the body is a noindex a crawler may
    // never honour — and this page's whole purpose is that a token URL is
    // never a search result.
    await page.goto(
      "/notifications/unsubscribe?token=8b2e6f14-1111-4222-8333-444455556666",
    );
    const placement = await page.evaluate(() => ({
      head: [...document.head.querySelectorAll("meta")].map((m) =>
        m.getAttribute("name"),
      ),
      body: [...document.body.querySelectorAll("meta")].map((m) =>
        m.getAttribute("name"),
      ),
    }));
    expect(placement.head).toContain("robots");
    expect(placement.body).not.toContain("robots");
  });

  test("robots.txt and sitemap.xml still resolve at the root", async ({
    request,
  }) => {
    // They share the middleware exclusion the manifest just joined.
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain("Disallow: /portal");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<urlset");
  });
});
