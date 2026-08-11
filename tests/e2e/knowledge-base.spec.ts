import { expect, test } from "@playwright/test";

/**
 * Knowledge Base.
 *
 * The assertion that matters most is the structured-data one: the directive
 * requires FAQ structured data to represent **actual visible content**, and a
 * filtered view is exactly where that quietly stops being true — the page
 * shows four answers and the markup claims twelve.
 */

test.describe("Knowledge Base", () => {
  test("renders every category, and every answer, unfiltered", async ({
    page,
  }) => {
    await page.goto("/knowledge-base");
    await expect(page.locator("h1")).toBeVisible();

    // Eight declared categories, each a real section with a heading.
    const headings = page.locator("main section[id] > h2");
    expect(await headings.count()).toBeGreaterThanOrEqual(8);

    // Twelve answers from the FAQ source arrays.
    const answers = page.locator("main details");
    expect(await answers.count()).toBe(12);
  });

  test("the category filter is a real URL that works without JavaScript", async ({
    page,
  }) => {
    await page.goto("/knowledge-base?category=tracking");
    const details = page.locator("main details");
    expect(await details.count()).toBe(1);
    await expect(details.first()).toContainText(/track/i);

    // Marked as the current page for assistive technology.
    await expect(
      page.locator('nav a[aria-current="page"]').first(),
    ).toBeVisible();
  });

  test("an unknown category falls back to everything, never an error", async ({
    page,
  }) => {
    const res = await page.goto("/knowledge-base?category=nonsense");
    expect(res?.status()).toBe(200);
    expect(await page.locator("main details").count()).toBe(12);
  });

  test("FAQ STRUCTURED DATA matches what is on screen", async ({ page }) => {
    // Unfiltered: twelve visible, twelve in the markup.
    await page.goto("/knowledge-base");
    const all = await readFaqJsonLd(page);
    expect(all).toBe(12);

    // Filtered: ONE visible, and the markup must say one. Emitting the full
    // set here would describe content the visitor cannot see.
    await page.goto("/knowledge-base?category=tracking");
    const filtered = await readFaqJsonLd(page);
    expect(filtered).toBe(1);
  });

  test("a category with no answers emits NO FAQPage node at all", async ({
    page,
  }) => {
    await page.goto("/knowledge-base?category=documents");
    expect(await readFaqJsonLd(page)).toBe(0);
    // ...and says so honestly rather than rendering an empty accordion.
    await expect(page.locator("main .state--empty").first()).toBeVisible();
  });

  test("filtered views do not compete with the canonical page", async ({
    page,
  }) => {
    await page.goto("/knowledge-base?category=dispatch");
    const robots = page.locator('meta[name="robots"]');
    if ((await robots.count()) > 0) {
      await expect(robots.first()).toHaveAttribute("content", /noindex/);
    }
  });

  test("carries breadcrumbs and is in the sitemap", async ({ page, request }) => {
    await page.goto("/knowledge-base");
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(blocks.join(" ")).toContain("BreadcrumbList");

    const res = await request.get("/sitemap.xml");
    expect(await res.text()).toContain("/knowledge-base");
  });

  test("is now reachable from the Resources group in the nav", async ({
    page,
  }) => {
    await page.goto("/");
    const links = await page
      .locator("nav.sitenav a")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(links.some((h) => h.includes("/knowledge-base"))).toBe(true);
  });

  test("links onward instead of dead-ending", async ({ page }) => {
    await page.goto("/knowledge-base");
    const main = page.locator("main");
    await expect(main.locator('a[href*="/faq"]').first()).toBeVisible();
    await expect(main.locator('a[href*="/contact"]').first()).toBeVisible();
  });
});

/** Count the questions declared across every FAQPage block on the page. */
async function readFaqJsonLd(page: import("@playwright/test").Page) {
  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  let count = 0;
  for (const block of blocks) {
    const parsed = JSON.parse(block) as
      | { "@type"?: string; mainEntity?: unknown[] }
      | Array<{ "@type"?: string; mainEntity?: unknown[] }>;
    for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
      if (node["@type"] === "FAQPage") count += node.mainEntity?.length ?? 0;
    }
  }
  return count;
}
