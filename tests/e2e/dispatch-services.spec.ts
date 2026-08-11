import { expect, test } from "@playwright/test";

/**
 * Dispatch Services — the carrier-side conversion hub.
 *
 * The assertions that matter most here are the NEGATIVE ones. §9 of the
 * directive names six claims the page must never make, and a marketing page is
 * exactly where they get added later by someone with a conversion target and
 * good intentions. These tests are what stops that being silent.
 */

const FORBIDDEN_CLAIMS: Array<[label: string, pattern: RegExp]> = [
  ["guaranteed loads", /guarantee[ds]?\s+(loads?|freight|miles)/i],
  ["guaranteed RPM", /guarantee[ds]?\s+(rpm|rate per mile)/i],
  ["guaranteed weekly gross", /guarantee[ds]?\s+(weekly|gross|income|earnings|pay)/i],
  ["guaranteed broker approval", /guarantee[ds]?\s+(broker|approval|acceptance)/i],
  ["a specific weekly figure", /\$\s?[\d,]+\s*(\/|per\s+)?\s*(week|wk)/i],
  ["a promised rate per mile", /\$\s?\d+(\.\d+)?\s*(\/|per\s+)?\s*mile/i],
];

test.describe("Dispatch Services", () => {
  test("renders as the dispatch hub with a real primary action", async ({
    page,
  }) => {
    await page.goto("/dispatch-services");
    await expect(page.locator("h1")).toContainText(/dispatch/i);

    const cta = page.getByRole("link", { name: /start dispatching/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /\/become-a-carrier/);
  });

  test("START DISPATCHING lands on the REAL onboarding, not another advert", async ({
    page,
  }) => {
    await page.goto("/dispatch-services");
    await page.getByRole("link", { name: /start dispatching/i }).first().click();
    await expect(page).toHaveURL(/\/become-a-carrier/);

    // The carrier wizard is the actual application. If this ever stops being
    // a form, the funnel has become a dead end and the CTA is a lie.
    await expect(page.locator("form, [data-wizard], .wizard").first()).toBeVisible();
  });

  test("makes NONE of §9's forbidden claims", async ({ page }) => {
    await page.goto("/dispatch-services");
    const body = (await page.locator("main").textContent()) ?? "";
    for (const [label, pattern] of FORBIDDEN_CLAIMS) {
      expect(body, `page claims ${label}`).not.toMatch(pattern);
    }
    // Non-vacuity: the page really does have substantial content to scan.
    expect(body.length).toBeGreaterThan(600);
  });

  test("NON-VACUITY: the claim patterns catch the wording they are meant to", async () => {
    const wouldBeBad = [
      "guaranteed loads every week",
      "guaranteed RPM of 2.50",
      "guaranteed weekly gross",
      "guaranteed broker approval",
      "$7,000/week",
      "$3.10 per mile",
    ];
    for (const sentence of wouldBeBad) {
      const caught = FORBIDDEN_CLAIMS.some(([, p]) => p.test(sentence));
      expect(caught, `pattern set missed: ${sentence}`).toBe(true);
    }
  });

  test("ships no pricing until Cowork approves it", async ({ page }) => {
    await page.goto("/dispatch-services");
    const body = (await page.locator("main").textContent()) ?? "";
    // No percentage fee, no dollar figure of any kind. The section can be
    // added without restructuring once approved pricing exists.
    expect(body).not.toMatch(/\d+\s?%\s*(dispatch\s*)?fee/i);
    expect(body).not.toMatch(/\$\s?[\d,]+/);
  });

  test("presents only the equipment the application actually supports", async ({
    page,
  }) => {
    await page.goto("/dispatch-services");
    const links = await page
      .locator('a[href*="/dispatch/"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));

    // The eight in EQUIPMENT_SLUGS. Anything else would be advertising a
    // service the platform has no page, content or configuration for.
    const supported = [
      "dry-van",
      "reefer",
      "flatbed",
      "step-deck",
      "power-only",
      "hot-shot",
      "box-truck",
      "sprinter-van",
    ];
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const href of links) {
      const slug = href.split("/dispatch/")[1]?.replace(/\/$/, "") ?? "";
      expect(supported, `unsupported equipment advertised: ${slug}`).toContain(slug);
    }
  });

  test("feeds the existing SEO pages rather than orphaning them", async ({
    page,
  }) => {
    await page.goto("/dispatch-services");
    // Scoped to `main`. Unscoped, the first match is inside the nav's Services
    // dropdown, which is `display:none` until opened — so the assertion failed
    // on a link that is present and correct, just not in the page body. The
    // claim being made is about the PAGE linking onward, not the chrome.
    const main = page.locator("main");
    await expect(main.locator('a[href*="/truck-dispatch"]').first()).toBeVisible();
    await expect(
      main.locator('a[href*="/start-your-trucking-company"]').first(),
    ).toBeVisible();
    await expect(main.locator('a[href*="/faq"]').first()).toBeVisible();
  });

  test("carries Service and BreadcrumbList structured data, with NO price", async ({
    page,
  }) => {
    await page.goto("/dispatch-services");
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    const parsed = blocks.flatMap((b) => JSON.parse(b) as unknown[]);
    const types = parsed.map((n) => (n as { "@type": string })["@type"]);
    expect(types).toContain("Service");
    expect(types).toContain("BreadcrumbList");

    // An `offers` node would assert a price that has not been approved —
    // the same fabrication as printing it, only harder to spot.
    expect(JSON.stringify(parsed)).not.toContain("offers");
    expect(JSON.stringify(parsed)).not.toContain("priceCurrency");
  });

  test("is reachable from the Services group and is in the sitemap", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const trigger = page.locator("nav.sitenav .navgroup > a").first();
    await expect(trigger).toHaveAttribute("href", /\/dispatch-services/);

    const res = await request.get("/sitemap.xml");
    expect(await res.text()).toContain("/dispatch-services");
  });

  test("keeps the referral promise gated, like every other surface", async ({
    page,
  }) => {
    await page.goto("/dispatch-services");
    const body = (await page.locator("main").textContent()) ?? "";
    // referral_program_active is false (M-69/P-2). This page must not become
    // the one place that promises a bonus nobody can pay.
    expect(body).not.toMatch(/referral bonus/i);
  });
});
