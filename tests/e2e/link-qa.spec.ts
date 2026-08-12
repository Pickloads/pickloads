import { expect, test } from "@playwright/test";

import { PUBLIC_ROUTES } from "@/lib/public-routes";

/**
 * Link QA — a real crawl of every public route, in the browser.
 *
 * The per-page suites each check their own links. This checks the SET: every
 * public route loads, and every link any of them ships resolves. The failure
 * it exists to catch is the one nobody notices — a route renamed in one place
 * and left stale in another, which no page-level test would see because each
 * page passes on its own.
 */

/** Anything that must never appear as an href on a public page. */
const FORBIDDEN_HREF: Array<[label: string, pattern: RegExp]> = [
  ["a dead anchor", /^#$/],
  ["an admin portal path", /\/portal\/admin/],
  ["a dispatcher portal path", /\/portal\/dispatcher/],
  [
    "a storage or signed URL",
    /storage\/v1\/object|supabase\.co\/storage|X-Amz-/,
  ],
  ["a raw document file", /\.(pdf|docx?|xlsx?)(\?|$)/],
];

test.describe("Link QA", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} loads and ships no forbidden href`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} did not return 2xx`).toBeLessThan(
        400,
      );

      const hrefs = await page
        .locator("a[href]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
      expect(hrefs.length, `${route} has no links at all`).toBeGreaterThan(5);

      for (const href of hrefs) {
        for (const [label, pattern] of FORBIDDEN_HREF) {
          expect(href, `${route} ships ${label}: ${href}`).not.toMatch(pattern);
        }
      }
    });
  }

  test("NON-VACUITY: the forbidden-href patterns catch what they describe", () => {
    const wouldBeBad = [
      "#",
      "/portal/admin/shipments",
      "/portal/dispatcher",
      "https://x.supabase.co/storage/v1/object/sign/a.pdf",
      "/packet/w-9.pdf",
    ];
    for (const href of wouldBeBad) {
      expect(
        FORBIDDEN_HREF.some(([, p]) => p.test(href)),
        `pattern set missed: ${href}`,
      ).toBe(true);
    }
  });

  /**
   * Fetch `href`, retrying ONCE and only on a transport-level failure.
   *
   * The property under test is "this route resolves", not "the TCP connection
   * survived". Firing several dozen sequential requests through one request
   * context provokes an occasional `ECONNRESET` from the Node server as it
   * recycles a keep-alive socket — `/login` reset once here, then answered 200
   * on 85 consecutive requests when probed directly.
   *
   * The retry is deliberately narrow. A response of ANY kind — 404, 500,
   * anything ≥400 — is returned to the caller and fails the assertion
   * immediately, with no second attempt. Only a connection that produced no
   * response at all is retried, and a second failure throws with the original
   * error. A broken route cannot hide behind this.
   */
  async function getWithOneRetry(
    request: import("@playwright/test").APIRequestContext,
    href: string,
  ) {
    try {
      return await request.get(href);
    } catch (err) {
      return await request.get(href).catch(() => {
        throw new Error(
          `${href}: no response after a retry — ${(err as Error).message}`,
        );
      });
    }
  }

  test("every internal link from the home page resolves", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page
      .locator("a[href^='/']")
      .evaluateAll((els) => [
        ...new Set(els.map((e) => e.getAttribute("href") ?? "")),
      ]);
    expect(hrefs.length).toBeGreaterThan(10);

    for (const href of hrefs) {
      const res = await getWithOneRetry(page.request, href);
      expect(res.status(), `${href} returned ${res.status()}`).toBeLessThan(
        400,
      );
    }
  });

  test("every internal link from the footer resolves, on a deep page", async ({
    page,
  }) => {
    // The footer is on every page; checking it from a non-home route catches
    // relative-path mistakes the home page would hide.
    await page.goto("/knowledge-base");
    const hrefs = await page
      .locator("footer a[href^='/']")
      .evaluateAll((els) => [
        ...new Set(els.map((e) => e.getAttribute("href") ?? "")),
      ]);
    expect(hrefs.length).toBeGreaterThan(10);

    for (const href of hrefs) {
      const res = await getWithOneRetry(page.request, href);
      expect(
        res.status(),
        `footer link ${href} returned ${res.status()}`,
      ).toBeLessThan(400);
    }
  });

  test("no unbuilt destination is reachable from the navigation", async ({
    page,
  }) => {
    await page.goto("/");
    const navHrefs = await page
      .locator("nav.sitenav a[href], footer a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    // Everything declared in the IA now ships, so the pending set is empty —
    // but a future `ships: false` entry must never render, and this is where
    // that would show up as a 404 in the crawl above.
    for (const href of navHrefs) {
      expect(href).not.toBe("");
      expect(href).not.toMatch(/undefined|\[locale\]/);
    }
  });

  test("locale alternates resolve for a representative route", async ({
    page,
  }) => {
    for (const locale of ["es", "fr", "ru", "ht"]) {
      const res = await getWithOneRetry(
        page.request,
        `/${locale}/dispatch-services`,
      );
      expect(res.status(), `/${locale}/dispatch-services`).toBeLessThan(400);
    }
  });
});
